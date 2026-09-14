#!/usr/bin/env node
import { Command } from 'commander'
import { AolServer, openDb, Repo, aolHome, dbPath, socketPath, decide, PROTOCOL_VERSION } from '@aol/core'

const program = new Command()
program.name('aol').description('Context integrity for AI agents').version('0.0.0')

program
  .command('daemon')
  .description('Run the decision daemon')
  .option('--socket <path>', 'socket path')
  .option('--failure-mode <mode>', "'observe' (default) or 'enforce'", 'observe')
  .action(async (opts: { socket?: string; failureMode: 'observe' | 'enforce' }) => {
    const server = new AolServer({
      ...(opts.socket ? { socketPath: opts.socket } : {}),
      failureMode: opts.failureMode,
    })
    const addr = await server.listen()
    process.stdout.write(`aol daemon listening on ${addr} (failure-mode: ${opts.failureMode})\n`)
    const shutdown = async () => {
      await server.close()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })

program
  .command('doctor')
  .description('Check the local install')
  .action(async () => {
    const lines: string[] = []
    lines.push(`protocol version : ${PROTOCOL_VERSION}`)
    lines.push(`node             : ${process.version}`)
    lines.push(`home             : ${aolHome()}`)
    lines.push(`database         : ${dbPath()}`)
    lines.push(`socket           : ${socketPath()}`)
    try {
      const db = openDb()
      const n = db.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as { n: number }
      lines.push(`migrations       : ${n.n} applied`)
      db.close()
    } catch (err) {
      lines.push(`database         : ERROR ${String(err)}`)
    }
    const v = await decide(
      {
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 'doctor',
        adapter: 'doctor',
        point: 'pre_tool',
        ts: Date.now(),
      },
      { timeoutMs: 800 },
    )
    lines.push(
      v.reason === 'unreachable'
        ? 'daemon           : not running (start with `aol daemon`)'
        : `daemon           : reachable, verdict=${v.decision} in ${v.elapsedMs?.toFixed(2)}ms`,
    )
    process.stdout.write(lines.join('\n') + '\n')
  })

program
  .command('report')
  .description('Summarise recorded activity')
  .option('--session <id>', 'restrict to one session')
  .action((opts: { session?: string }) => {
    const db = openDb()
    const repo = new Repo(db)
    if (opts.session) {
      const n = repo.countInterceptions(opts.session)
      const events = repo.listMutationEvents(opts.session)
      process.stdout.write(`session ${opts.session}: ${n} interceptions, ${events.length} mutation events\n`)
    } else {
      const rows = db
        .prepare(
          `SELECT s.id, s.adapter, COUNT(i.id) AS n
           FROM sessions s LEFT JOIN interceptions i ON i.session_id = s.id
           GROUP BY s.id ORDER BY s.last_seen DESC LIMIT 20`,
        )
        .all() as Array<{ id: string; adapter: string; n: number }>
      if (rows.length === 0) {
        process.stdout.write('no sessions recorded yet\n')
      } else {
        for (const r of rows) process.stdout.write(`${r.id}  ${r.adapter}  ${r.n} interceptions\n`)
      }
    }
    db.close()
    // Detection rates land in M4, once detectors and the control window exist.
  })

program.parseAsync(process.argv)
