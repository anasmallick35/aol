import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeHooks, initHooks, buildHookEntry, HOOK_EVENTS } from '../src/init.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aol-init-'))
  mkdirSync(join(dir, '.claude'), { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const settingsFile = () => join(dir, '.claude', 'settings.json')

describe('mergeHooks', () => {
  it('registers every event on empty settings', () => {
    const { settings, added } = mergeHooks({}, 'aol hook')
    expect(added).toEqual([...HOOK_EVENTS])
    expect(Object.keys(settings.hooks!)).toEqual([...HOOK_EVENTS])
  })

  it('registers only compaction and session events, not per-tool hooks', () => {
    // Per-tool hooks cost ~157ms per invocation and fire on every tool call.
    // They are added in M4/M5 when the data is actually consumed.
    expect([...HOOK_EVENTS]).toEqual(['PreCompact', 'PostCompact', 'SessionStart', 'SessionEnd'])
    expect(HOOK_EVENTS as readonly string[]).not.toContain('PreToolUse')
    expect(HOOK_EVENTS as readonly string[]).not.toContain('PostToolUse')
  })

  it("preserves the user's existing hooks", () => {
    // These are the user's settings, not ours. Clobbering somebody's existing
    // tooling to install our own would be indefensible.
    const existing = {
      model: 'opus',
      hooks: {
        PreCompact: [{ hooks: [{ type: 'command', command: 'my-notifier' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-linter' }] }],
      },
    }
    const { settings } = mergeHooks(existing, 'aol hook')
    expect(settings.model).toBe('opus')
    // Ours is appended alongside theirs, never in place of it.
    const preCompact = settings.hooks!.PreCompact!
    expect(preCompact[0]!.hooks[0]!.command).toBe('my-notifier')
    expect(preCompact).toHaveLength(2)
    // An event we do not register is left completely untouched.
    expect(settings.hooks!.PreToolUse).toEqual(existing.hooks.PreToolUse)
  })

  it('is idempotent — running twice does not duplicate our hook', () => {
    const first = mergeHooks({}, 'aol hook')
    const second = mergeHooks(first.settings, 'aol hook')
    expect(second.added).toEqual([])
    expect(second.skipped).toEqual([...HOOK_EVENTS])
    expect(second.settings.hooks!.PreCompact).toHaveLength(1)
  })

  it.each([
    ['npx default', 'npx -y @aol/cli hook'],
    ['global bin', 'aol hook'],
    ['absolute path', '/usr/local/bin/node /opt/aol/cli.js hook --verbose'],
    ['pnpm dlx', 'pnpm dlx @aol/cli hook'],
  ])('stays idempotent for the %s command form', (_label, command) => {
    // Regression: the marker was once a literal 'aol hook' substring, which the
    // DEFAULT command does not contain — so init duplicated every hook on a
    // second run.
    const first = mergeHooks({}, command)
    const second = mergeHooks(first.settings, command)
    expect(second.added).toEqual([])
    expect(second.settings.hooks!.PreCompact).toHaveLength(1)
  })

  it('recognises our hook across differing command forms', () => {
    const withCustom = mergeHooks({}, '/usr/local/bin/node /opt/aol/cli.js hook --verbose')
    const again = mergeHooks(withCustom.settings, 'npx -y @aol/cli hook')
    expect(again.added).toEqual([])
  })

  it('gives each hook a timeout so a wedged daemon cannot stall a session', () => {
    expect(buildHookEntry('aol hook').hooks[0]!.timeout).toBe(10)
  })
})

describe('initHooks', () => {
  it('writes settings and reports what changed', () => {
    const r = initHooks({ scope: 'project', cwd: dir })
    expect(r.dryRun).toBe(false)
    expect(r.added).toEqual([...HOOK_EVENTS])
    const written = JSON.parse(readFileSync(settingsFile(), 'utf8'))
    expect(written.hooks.PreCompact[0].hooks[0].command).toBe('npx -y @aol/cli hook')
  })

  it('backs up existing settings before writing', () => {
    writeFileSync(settingsFile(), JSON.stringify({ model: 'sonnet' }))
    const r = initHooks({ scope: 'project', cwd: dir })
    expect(r.backup).toBeDefined()
    expect(existsSync(r.backup!)).toBe(true)
    expect(JSON.parse(readFileSync(r.backup!, 'utf8')).model).toBe('sonnet')
  })

  it('writes nothing on a dry run', () => {
    const r = initHooks({ scope: 'project', cwd: dir, dryRun: true })
    expect(r.dryRun).toBe(true)
    expect(r.added).toEqual([...HOOK_EVENTS])
    expect(existsSync(settingsFile())).toBe(false)
  })

  it('refuses to overwrite settings it cannot parse', () => {
    // Silently replacing a file we failed to read would destroy the user's
    // configuration. Refuse and say why.
    writeFileSync(settingsFile(), '{ this is not json ')
    expect(() => initHooks({ scope: 'project', cwd: dir })).toThrow(/not valid JSON/)
  })

  it('honours a custom command', () => {
    initHooks({ scope: 'project', cwd: dir, command: '/opt/aol hook' })
    const written = JSON.parse(readFileSync(settingsFile(), 'utf8'))
    expect(written.hooks.PreCompact[0].hooks[0].command).toBe('/opt/aol hook')
  })
})
