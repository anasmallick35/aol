# contextkeep

Your agent forgets things when it compacts its context, and nobody notices until something breaks. ContextKeep notices, and puts them back.

```bash
npx contextkeep init      # register hooks in Claude Code
npx contextkeep daemon    # start the decision daemon
```

## What it does

```
snapshot → agent compacts → diff → repair or block → report
```

1. **Snapshot** what matters before a context mutation — stated rules, files touched, errors hit, open tasks.
2. **The agent compacts** using its own mechanism. ContextKeep never performs it and never blocks it.
3. **Diff** what survived against what mattered, measured against a matched control window.
4. **Repair** by re-injecting critical dropped items — or, where repair is impossible, **block** the later action that would violate a rule the agent forgot.
5. **Report** what was dropped, restored, blocked, and what it cost.

The goal is not compaction that removes nothing — that is a contradiction, since compaction exists because the context is full. The goal is **nothing important removed, and proof of it**.

## Commands

| Command | What it does |
| --- | --- |
| `contextkeep init` | Register hooks in Claude Code settings (backs up first, never removes yours) |
| `contextkeep daemon` | Run the decision daemon |
| `contextkeep report --transcript <path>` | Analyse a transcript's compactions |
| `contextkeep doctor` | Check the local install |

`ck` works as a short alias.

### Modes

```bash
contextkeep daemon --mode observe   # silent
contextkeep daemon --mode warn      # surface findings (default)
contextkeep daemon --mode block     # deny actions that break forgotten rules
```

`warn` is the default deliberately: blocking is opt-in because a wrong block costs you real work.

## Privacy

**Nothing leaves your machine.** No network calls, no accounts, no telemetry. State lives in `~/.contextkeep/`, a single SQLite file you can inspect or delete.

Tool inputs recorded alongside violations are redacted for secrets first — though that is pattern matching, not a guarantee, so treat the database as sensitive.

## Reading the report

```
█ survived   ▒ uncertain (likely paraphrased)   ░ lost

constraints      7 items  ██████████▒▒▒▒▒▒▒▒▒▒▒▒▒▒
survived    3   uncertain    4   lost    0
control: lost 12.0% of 41   →   indistinguishable from baseline
```

**Always read a loss figure against its control.** Agents drop threads and re-read files normally; a rate matching the control is ordinary behaviour, not compaction damage. `uncertain` is a real answer — a summary paraphrases, so a rule can survive in meaning while vanishing in wording.

MIT licensed.
