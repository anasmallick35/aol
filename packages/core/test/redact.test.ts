import { describe, it, expect } from 'vitest'
import { redactString, redactForStorage, REDACTED, MAX_STORED_CHARS } from '../src/redact.js'

describe('redactString', () => {
  it('redacts the example from review: a bearer token in a curl command', () => {
    const out = redactString("curl -H 'Authorization: Bearer sk-live-9a8b7c6d5e4f3g2h1i' https://api.stripe.com/v1/charges")
    expect(out).not.toContain('sk-live-9a8b7c6d5e4f3g2h1i')
    expect(out).toContain(REDACTED)
    // The useful part survives, which is the whole point of redacting rather
    // than hashing: you can still see what the agent was trying to do.
    expect(out).toContain('curl')
    expect(out).toContain('api.stripe.com')
  })

  it.each([
    ['openai key', 'my key is sk-proj-abcdefghijklmnopqrstuvwxyz123456', 'sk-proj-abcdefghijklmnopqrstuvwxyz123456'],
    ['anthropic key', 'ANTHROPIC=sk-ant-api03-abcdefghijklmnop', 'sk-ant-api03-abcdefghijklmnop'],
    ['github pat', 'token github_pat_11ABCDEFG0abcdefghijklmnop', 'github_pat_11ABCDEFG0abcdefghijklmnop'],
    ['github classic', 'use ghp_abcdefghijklmnopqrstuvwxyz0123', 'ghp_abcdefghijklmnopqrstuvwxyz0123'],
    ['aws access key', 'AKIAIOSFODNN7EXAMPLE is the id', 'AKIAIOSFODNN7EXAMPLE'],
    ['slack token', 'xoxb-123456789012-abcdefghijkl', 'xoxb-123456789012-abcdefghijkl'],
    ['google api key', 'AIzaSyA1234567890abcdefghijklmnopqrstuv', 'AIzaSyA1234567890abcdefghijklmnopqrstuv'],
  ])('redacts a %s', (_label, input, secret) => {
    expect(redactString(input)).not.toContain(secret)
  })

  it('redacts a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    expect(redactString(`token=${jwt}`)).not.toContain('dozjgNryP4J3jVmNHl0w5N')
  })

  it('redacts credentials embedded in a URL but keeps the host', () => {
    const out = redactString('git clone https://anas:hunter2@github.com/org/repo.git')
    expect(out).not.toContain('hunter2')
    expect(out).toContain('github.com/org/repo.git')
    expect(out).toContain('anas')
  })

  it('redacts a private key block including its body', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234\nabcd\n-----END RSA PRIVATE KEY-----'
    const out = redactString(pem)
    expect(out).not.toContain('MIIEowIBAAKCAQEA1234')
  })

  it('redacts .env style assignments', () => {
    const out = redactString('STRIPE_SECRET_KEY=rk_live_abcdef\nDATABASE_PASSWORD="p@ssw0rd"\nPORT=3000')
    expect(out).not.toContain('rk_live_abcdef')
    expect(out).not.toContain('p@ssw0rd')
    // Non-secret config is preserved — over-redaction would make reports useless.
    expect(out).toContain('PORT=3000')
  })

  it('redacts secrets passed as CLI flags', () => {
    expect(redactString('gh auth login --token ghp_realtokenvalue123456')).not.toContain('ghp_realtokenvalue123456')
    expect(redactString('psql --password=supersecret')).not.toContain('supersecret')
  })

  it('leaves ordinary content untouched', () => {
    const ordinary = 'npm run build && git commit -m "fix: handle empty transcript"'
    expect(redactString(ordinary)).toBe(ordinary)
  })
})

describe('redactForStorage', () => {
  it('drops values of secret-named fields regardless of their shape', () => {
    const out = redactForStorage({ url: 'https://api.example.com', api_key: 'totally-ordinary-looking', retries: 3 })!
    expect(out).not.toContain('totally-ordinary-looking')
    expect(out).toContain('https://api.example.com')
    expect(out).toContain('3')
  })

  it('redacts nested structures', () => {
    const out = redactForStorage({ request: { headers: { Authorization: 'Bearer abcdef123456789' } } })!
    expect(out).not.toContain('abcdef123456789')
  })

  it('redacts inside arrays', () => {
    const out = redactForStorage({ cmds: ['ls -la', 'export TOKEN=ghp_abcdefghijklmnopqrstuvwxyz01'] })!
    expect(out).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz01')
    expect(out).toContain('ls -la')
  })

  it('returns null for undefined so the column stays NULL', () => {
    expect(redactForStorage(undefined)).toBeNull()
  })

  it('truncates oversized input', () => {
    const out = redactForStorage('x'.repeat(MAX_STORED_CHARS + 500))!
    expect(out.length).toBeLessThan(MAX_STORED_CHARS + 100)
    expect(out).toContain('truncated')
  })

  it('survives circular structures rather than throwing', () => {
    // Recording a violation must never be the thing that breaks the daemon.
    // The depth guard cuts the cycle before JSON.stringify can throw, so we
    // get a bounded, truncated structure rather than a bail-out — which is
    // more useful than losing the input entirely.
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular
    const out = redactForStorage(circular)!
    expect(out).toBeTypeOf('string')
    expect(out).toContain('loop')
    expect(out).toContain(REDACTED)
    expect(out.length).toBeLessThan(MAX_STORED_CHARS)
  })

  it('handles a realistic Bash tool input end-to-end', () => {
    const out = redactForStorage({
      command: "curl -X POST -H 'Authorization: Bearer sk-live-9a8b7c6d5e4f3g2h' https://api.stripe.com/v1/refunds",
      description: 'Issue a refund',
    })!
    expect(out).not.toContain('sk-live-9a8b7c6d5e4f3g2h')
    expect(out).toContain('Issue a refund')
    expect(out).toContain('api.stripe.com')
  })
})
