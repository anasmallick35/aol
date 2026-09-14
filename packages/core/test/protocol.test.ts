import { describe, it, expect } from 'vitest'
import { encodeFrame, FrameDecoder, FrameTooLargeError, MAX_FRAME_BYTES, HEADER_BYTES } from '../src/protocol.js'

describe('frame protocol', () => {
  it('round-trips a value', () => {
    const d = new FrameDecoder()
    d.push(encodeFrame({ hello: 'world' }))
    expect([...d.drain()]).toEqual([{ hello: 'world' }])
  })

  it('decodes several frames arriving in one chunk', () => {
    const d = new FrameDecoder()
    d.push(Buffer.concat([encodeFrame({ n: 1 }), encodeFrame({ n: 2 }), encodeFrame({ n: 3 })]))
    expect([...d.drain()]).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
  })

  it('reassembles one frame split across chunks', () => {
    // The case a naive newline-delimited reader gets wrong: sockets give no
    // message boundaries, so a frame can arrive in arbitrary pieces.
    const frame = encodeFrame({ text: 'a'.repeat(5000) })
    const d = new FrameDecoder()
    for (let i = 0; i < frame.length; i += 137) {
      d.push(frame.subarray(i, Math.min(i + 137, frame.length)))
    }
    expect([...d.drain()]).toEqual([{ text: 'a'.repeat(5000) }])
  })

  it('yields nothing while a frame is incomplete', () => {
    const frame = encodeFrame({ a: 1 })
    const d = new FrameDecoder()
    d.push(frame.subarray(0, frame.length - 1))
    expect([...d.drain()]).toEqual([])
    expect(d.pending).toBeGreaterThan(0)
    d.push(frame.subarray(frame.length - 1))
    expect([...d.drain()]).toEqual([{ a: 1 }])
    expect(d.pending).toBe(0)
  })

  it('survives payloads containing newlines', () => {
    const value = { prompt: 'line one\nline two\r\nline three' }
    const d = new FrameDecoder()
    d.push(encodeFrame(value))
    expect([...d.drain()]).toEqual([value])
  })

  it('preserves non-ASCII content byte-exactly', () => {
    const value = { text: 'café 日本語 🚀 naïve' }
    const d = new FrameDecoder()
    d.push(encodeFrame(value))
    expect([...d.drain()]).toEqual([value])
  })

  it('rejects an oversized declared length without allocating', () => {
    const header = Buffer.allocUnsafe(HEADER_BYTES)
    header.writeUInt32BE(MAX_FRAME_BYTES + 1, 0)
    const d = new FrameDecoder()
    d.push(header)
    expect(() => [...d.drain()]).toThrow(FrameTooLargeError)
  })
})
