/**
 * Best-effort secret redaction for anything we persist.
 *
 * A violation report is only actionable if it shows what the agent tried to do,
 * but tool inputs routinely carry live credentials — an `Authorization` header,
 * an API key in a URL, the contents of a `.env`. Writing those verbatim would
 * turn ~/.contextkeep/contextkeep.db into a credential store, which is an indefensible artifact
 * for a product whose pitch is trust.
 *
 * HONEST LIMIT: this is pattern matching, not a guarantee. It catches the
 * common shapes — provider key prefixes, bearer tokens, secret-looking field
 * names, private key blocks, basic-auth URLs. A bespoke internal token format
 * will pass straight through. Treat the database as sensitive regardless; this
 * reduces exposure, it does not eliminate it.
 */

export const REDACTED = '[redacted]'

/** Truncation guard: a single tool input should never bloat the database. */
export const MAX_STORED_CHARS = 4000

/** Field names whose VALUE is always dropped, whatever it looks like. */
const SECRET_KEY_PATTERN =
  /^(.*_)?(password|passwd|pwd|secret|token|api[-_]?key|apikey|access[-_]?key|secret[-_]?key|private[-_]?key|client[-_]?secret|auth|authorization|credential|session[-_]?id|cookie)(_.*)?$/i

const VALUE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // PEM private key blocks, including the body.
  [/-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, `-----BEGIN PRIVATE KEY-----${REDACTED}-----END PRIVATE KEY-----`],
  // Authorization headers of any scheme.
  [/\b(Authorization\s*[:=]\s*)(Bearer|Basic|Token)?\s*\S+/gi, `$1$2 ${REDACTED}`],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/g, `Bearer ${REDACTED}`],
  // Credentials embedded in a URL: https://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, `$1$2:${REDACTED}@`],
  // Known provider key prefixes.
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, REDACTED],
  [/\b(AKIA|ASIA)[A-Z0-9]{12,}/g, REDACTED],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bAIza[A-Za-z0-9_-]{30,}/g, REDACTED],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  // Shell/env assignments to secret-looking names.
  [/\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL)[A-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|\S+)/g, `$1=${REDACTED}`],
  // CLI flags carrying secrets.
  [/(--(?:password|token|secret|api[-_]?key|auth)[= ])(\S+)/gi, `$1${REDACTED}`],
]

/** Redact a standalone string. */
export function redactString(input: string): string {
  let out = input
  for (const [pattern, replacement] of VALUE_PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 8) return REDACTED
  if (typeof value === 'string') return redactString(value)
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    // Key-based redaction runs first: a field literally named `password` is
    // dropped whether or not its value looks like a secret.
    out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactValue(v, depth + 1)
  }
  return out
}

/**
 * Serialise a tool input for storage, redacting secrets and capping length.
 * Returns null for undefined input so the column stays NULL rather than "undefined".
 */
export function redactForStorage(value: unknown): string | null {
  if (value === undefined) return null
  let text: string
  try {
    const cleaned = redactValue(value, 0)
    text = typeof cleaned === 'string' ? cleaned : JSON.stringify(cleaned)
  } catch {
    // Circular structures and exotic objects must not break recording.
    return REDACTED
  }
  if (text === undefined) return null
  return text.length > MAX_STORED_CHARS
    ? `${text.slice(0, MAX_STORED_CHARS)}…[truncated ${text.length - MAX_STORED_CHARS} chars]`
    : text
}
