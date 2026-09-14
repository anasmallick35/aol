/**
 * Wire protocol: 4-byte big-endian unsigned length, then UTF-8 JSON.
 *
 * Chosen over gRPC because a protobuf toolchain across five shim languages buys
 * nothing at this scale, and over newline-delimited JSON because interception
 * payloads legitimately contain newlines and we refuse to escape our way around
 * that. See docs/07-stack-and-architecture-decisions.md §S5.
 */

export const HEADER_BYTES = 4

/** Hard ceiling per frame. A payload larger than this is a bug or an attack. */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024

export class FrameTooLargeError extends Error {
  constructor(size: number) {
    super(`frame of ${size} bytes exceeds maximum ${MAX_FRAME_BYTES}`)
    this.name = 'FrameTooLargeError'
  }
}

export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  if (body.length > MAX_FRAME_BYTES) throw new FrameTooLargeError(body.length)
  const header = Buffer.allocUnsafe(HEADER_BYTES)
  header.writeUInt32BE(body.length, 0)
  return Buffer.concat([header, body])
}

/**
 * Incremental decoder.
 *
 * TCP and Unix sockets give no message boundaries: a frame may arrive split
 * across chunks, and several frames may arrive in one. Callers push whatever
 * they receive and drain whatever is complete.
 */
export class FrameDecoder {
  #buf: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): void {
    this.#buf = this.#buf.length === 0 ? chunk : Buffer.concat([this.#buf, chunk])
  }

  /** Yields each complete frame's parsed JSON. Throws if a frame exceeds the cap. */
  *drain(): Generator<unknown> {
    for (;;) {
      if (this.#buf.length < HEADER_BYTES) return
      const size = this.#buf.readUInt32BE(0)
      if (size > MAX_FRAME_BYTES) throw new FrameTooLargeError(size)
      if (this.#buf.length < HEADER_BYTES + size) return
      const body = this.#buf.subarray(HEADER_BYTES, HEADER_BYTES + size)
      this.#buf = this.#buf.subarray(HEADER_BYTES + size)
      yield JSON.parse(body.toString('utf8'))
    }
  }

  /** Bytes held pending a complete frame. Exposed for tests and diagnostics. */
  get pending(): number {
    return this.#buf.length
  }
}
