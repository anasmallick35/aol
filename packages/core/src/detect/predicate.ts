import type { ExtractedItem } from '../extract/types.js'
import { normalizeFilePath, normalizeCommand } from '../extract/artifacts.js'

/**
 * Compiling a constraint into a mechanical predicate.
 *
 * D5 is the headline metric — not "a rule went missing" but "and here is the
 * action that broke it". For that to mean anything, the check has to be
 * mechanical and auditable: a predicate is plain data you can print and argue
 * with, never an LLM judgement and never an opaque closure.
 *
 * THE HONEST LIMIT, and it is a large one: most constraints cannot be compiled.
 * Of the constraints found in real transcripts —
 *
 *   "dont push dev-tools fix"        → compiles (forbidden path/command)
 *   "dont add comments in code"      → compiles (forbidden content)
 *   "dont use random emoji like 💸"  → compiles (forbidden content)
 *   "you should destructure it"      → DOES NOT compile
 *   "you need to confirm with me"    → DOES NOT compile
 *   "dont mention the db spike"      → DOES NOT compile
 *
 * So `compileConstraints` reports how many it could compile. That ratio is
 * published in the report rather than hidden, because a violation count means
 * nothing without knowing what fraction of the rules were even checkable.
 */

export type PredicateKind = 'forbidden_path' | 'forbidden_command' | 'forbidden_content'

export interface Predicate {
  kind: PredicateKind
  /**
   * What must not appear.
   *
   * For `forbidden_command` this is a list and EVERY token must be present.
   * Matching a single token was tried first and produced 15 false positives on
   * real data: "dont need to run full recruit test" compiled to "must not run a
   * command mentioning 'recruit'", which then fired on
   * `cd .../modules/recruit && git fetch`. A gate that cries wolf is worse than
   * no gate, so the bar is now all-tokens-present.
   */
  needles: string[]
  /** Convenience view of `needles` for single-token kinds. */
  needle: string
  /** Tool names this applies to. Empty means any tool. */
  tools: string[]
  /** Tool input fields to inspect. */
  fields: string[]
  /** Plain-English statement of what is being checked, for the report. */
  explanation: string
  /** The constraint it came from. */
  source: ExtractedItem
}

/** Verbs that mean "modify a file". */
const WRITE_VERBS = 'edit|touch|modify|change|update|remove|delete|push|commit'
/** Verbs that mean "execute something". */
const RUN_VERBS = 'run|rerun|re-run|execute|start|launch|deploy|publish'

const NEGATION = String.raw`(?:never|do\s?n[o']?t|don't|do not|avoid|no need to|dont need to|dont)`

/** "dont edit prod.ts" / "never touch src/legacy" */
const FORBIDDEN_PATH = new RegExp(
  String.raw`${NEGATION}\s+(?:${WRITE_VERBS})\s+(?:the\s+|a\s+)?([\w@]*[/.-][\w./@-]+)`,
  'i',
)

/** "dont run the full suite" / "dont rerun pr2 actions" */
const FORBIDDEN_COMMAND = new RegExp(
  String.raw`${NEGATION}\s+(?:${RUN_VERBS})\s+(?:the\s+|a\s+|full\s+)*([\w\s.-]{3,40})`,
  'i',
)

/** "dont add comments in code" / "dont use random emoji" */
const FORBIDDEN_CONTENT = new RegExp(
  // Tense and typo variants matter: real users write "dont used data-test-id".
  String.raw`${NEGATION}\s+(?:add|adds|added|put|puts|use|used|using|include|includes|insert|write|writes)\s+(?:any\s+|random\s+|the\s+)?([\w\s-]{3,30})`,
  'i',
)

/** Words too generic to narrow a command match. */
const COMMAND_STOPWORDS = new Set(['the', 'full', 'all', 'and', 'for', 'that', 'this', 'now', 'again', 'any'])

/** Content needles we know how to look for inside a file edit. */
const CONTENT_MATCHERS: ReadonlyArray<readonly [RegExp, RegExp, string]> = [
  [/\bcomments?\b/i, /(^|\s)(\/\/|#|\/\*|\*\s)/m, 'a code comment'],
  [/\bemoji\b/i, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'an emoji'],
  [/\bconsole\.?log\b|\bconsole\b/i, /console\.\w+\(/, 'a console call'],
  [/\bdata-test-?id\b/i, /data-test-?id/i, 'a data-test-id attribute'],
  [/\bany\b.*\btype\b|\btype\s+any\b/i, /:\s*any\b/, 'an `any` type'],
]

/** Compile one constraint, or return null when it cannot be checked mechanically. */
export function compileConstraint(item: ExtractedItem): Predicate | null {
  const text = item.value

  const pathMatch = FORBIDDEN_PATH.exec(text)
  if (pathMatch?.[1]) {
    const needle = normalizeFilePath(pathMatch[1])
    // Length floor so "dont push it" cannot compile into a predicate that
    // matches almost every tool call.
    if (needle.length >= 4) {
      return {
        kind: 'forbidden_path',
        needles: [needle],
        needle,
        tools: ['Edit', 'Write', 'NotebookEdit', 'Bash'],
        fields: ['file_path', 'path', 'notebook_path', 'command'],
        explanation: `must not modify anything matching "${needle}"`,
        source: item,
      }
    }
  }

  const contentMatch = FORBIDDEN_CONTENT.exec(text)
  if (contentMatch?.[1]) {
    const phrase = contentMatch[1].trim()
    const matcher = CONTENT_MATCHERS.find(([label]) => label.test(phrase))
    if (matcher) {
      return {
        kind: 'forbidden_content',
        needles: [matcher[1].source],
        needle: matcher[1].source,
        tools: ['Edit', 'Write', 'NotebookEdit'],
        fields: ['new_string', 'content'],
        explanation: `written content must not contain ${matcher[2]}`,
        source: item,
      }
    }
  }

  const cmdMatch = FORBIDDEN_COMMAND.exec(text)
  if (cmdMatch?.[1]) {
    const tokens = normalizeCommand(cmdMatch[1])
      .split(/\s+/)
      .filter((w) => w.length > 2 && !COMMAND_STOPWORDS.has(w))
    // A single token is far too loose (see the note on `needles`). Require at
    // least two distinctive words, all of which must appear in the command.
    if (tokens.length >= 2) {
      return {
        kind: 'forbidden_command',
        needles: tokens,
        needle: tokens.join(' '),
        tools: ['Bash'],
        fields: ['command'],
        explanation: `must not run a command mentioning all of: ${tokens.map((t) => `"${t}"`).join(', ')}`,
        source: item,
      }
    }
  }

  return null
}

export interface CompileOptions {
  /**
   * Enable `forbidden_command` predicates. **Off by default, and that default
   * is a deliberate product decision.**
   *
   * Matching keywords inside a shell command is not precise enough to accuse
   * anyone of anything. On real data "dont need to run full recruit test"
   * matched `git log origin/wft-5339-recruit-pull-enabled … test` — the words
   * appear, in a branch name, in a command that runs no tests at all.
   * Requiring every token cut the false positives from 15 to 3; it did not
   * reach zero, and three wrong accusations is still three too many for a
   * product whose entire premise is not crying wolf.
   *
   * `forbidden_path` and `forbidden_content` stay on: both are exact, and both
   * produced zero false positives on the same data.
   *
   * Kept behind a flag rather than deleted because the approach becomes viable
   * with better command parsing — knowing the invoked binary rather than
   * grepping the string.
   */
  includeCommandPredicates?: boolean
}

export interface CompileResult {
  predicates: Predicate[]
  /** Constraints we could not turn into a mechanical check. */
  uncompilable: ExtractedItem[]
  /** predicates / total. Published, never hidden. */
  coverage: number
}

export function compileConstraints(items: ExtractedItem[], opts: CompileOptions = {}): CompileResult {
  const predicates: Predicate[] = []
  const uncompilable: ExtractedItem[] = []
  for (const item of items) {
    if (item.kind !== 'constraint') continue
    const p = compileConstraint(item)
    if (p && (p.kind !== 'forbidden_command' || opts.includeCommandPredicates)) predicates.push(p)
    else uncompilable.push(item)
  }
  const total = predicates.length + uncompilable.length
  return { predicates, uncompilable, coverage: total ? predicates.length / total : 0 }
}
