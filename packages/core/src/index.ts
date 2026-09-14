export * from './events.js'
export * from './verdict.js'
export * from './protocol.js'
export * from './paths.js'
export { AolServer, type ServerOptions, type FailureMode } from './server.js'
export { decide, type DecideOptions } from './client.js'
export { openDb, migrate, type DB } from './store/db.js'
export { Repo } from './store/repo.js'
export { MIGRATIONS } from './store/schema.js'
export {
  streamTranscript,
  findCompactBoundaries,
  boundaryKey,
  extractText,
  isConversational,
  COMPACT_BOUNDARY_SUBTYPE,
  type TranscriptEntry,
  type CompactBoundary,
} from './capture/transcript.js'
export {
  sliceWindows,
  windowText,
  survivingText,
  DEFAULT_CONTROL_SIZE,
  type MutationWindows,
  type WindowOptions,
} from './capture/window.js'
export * from './extract/index.js'
export * from './detect/index.js'
export * from './gate/index.js'
export { renderReport, type RenderOptions } from './report/render.js'
export { redactString, redactForStorage, REDACTED, MAX_STORED_CHARS } from './redact.js'
export { logger } from './log.js'
