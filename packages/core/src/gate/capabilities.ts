/**
 * What each adapter can actually do.
 *
 * Published rather than assumed, because overclaiming here would be the worst
 * kind of dishonesty in this product: telling someone their agent is protected
 * when the adapter physically cannot repair or block.
 *
 * Claude Code is the clearest case — `PreCompact` and `PostCompact` cannot
 * modify anything, so there is no inline repair. It detects, blocks at the tool
 * call, and reports. That is also why it is the proving ground rather than the
 * product.
 */

export interface AdapterCapabilities {
  /** Can inject preservation instructions before the mutation happens. */
  prevent: boolean
  /** Can observe the mutation and diff it. Every adapter can. */
  detect: boolean
  /** Can re-inject dropped content into the compacted context. */
  repair: boolean
  /** Can stop a consequent action. */
  block: boolean
  /** Always true. Reporting is unconditional. */
  report: boolean
}

export const CAPABILITIES: Record<string, AdapterCapabilities> = {
  'claude-code': { prevent: false, detect: true, repair: false, block: true, report: true },
  'agent-hooks': { prevent: false, detect: true, repair: true, block: true, report: true },
  'anthropic-api': { prevent: true, detect: true, repair: true, block: true, report: true },
  'openai-api': { prevent: false, detect: true, repair: false, block: true, report: true },
  synthetic: { prevent: true, detect: true, repair: true, block: true, report: true },
}

/** Unknown adapters get the safe floor: observe and report, nothing else. */
export const UNKNOWN_CAPABILITIES: AdapterCapabilities = {
  prevent: false,
  detect: true,
  repair: false,
  block: false,
  report: true,
}

export function capabilitiesFor(adapter: string): AdapterCapabilities {
  return CAPABILITIES[adapter] ?? UNKNOWN_CAPABILITIES
}
