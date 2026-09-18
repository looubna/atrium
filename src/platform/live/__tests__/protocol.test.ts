import { describe, expect, it } from 'vitest'
import { FrameRingBuffer, backoffMs } from '../liveClient'
import { FATAL_CLOSE_CODES, decodeServerAudio, encodeAudioFrame, parseServerMessage } from '../protocol'
import { BoxDownsampler, int16ToFloat32, toInt16 } from '../../media/downsample'

describe('audio frames', () => {
  it('encodes little-endian headers the gateway can parse', () => {
    const pcm = new Int16Array([1, -2, 32767, -32768])
    const buffer = encodeAudioFrame(7, 1234.4, pcm)
    const view = new DataView(buffer)
    expect(view.getUint32(0, true)).toBe(7)
    expect(view.getUint32(4, true)).toBe(1234)
    expect(view.getInt16(8, true)).toBe(1)
    expect(view.getInt16(14, true)).toBe(-32768)
    expect(buffer.byteLength).toBe(16)
  })

  it('decodes server audio frames', () => {
    const buffer = new ArrayBuffer(12)
    const view = new DataView(buffer)
    view.setUint32(0, 3, true)
    view.setUint32(4, 9, true)
    view.setInt16(8, -5, true)
    view.setInt16(10, 6, true)
    expect(decodeServerAudio(buffer)).toEqual({ turnSeq: 3, chunk: 9, pcm: new Int16Array([-5, 6]) })
    expect(() => decodeServerAudio(new ArrayBuffer(9))).toThrow(RangeError)
  })

  it('ignores malformed control messages', () => {
    expect(parseServerMessage('{"type":"ended","reason":"time_limit"}')).toEqual({ type: 'ended', reason: 'time_limit' })
    expect(parseServerMessage('not json')).toBeNull()
    expect(parseServerMessage('{"hello":1}')).toBeNull()
  })

  it('treats authorization, missing and conflicting sessions as fatal', () => {
    for (const code of [4400, 4403, 4404, 4409, 4429]) expect(FATAL_CLOSE_CODES.has(code)).toBe(true)
    for (const code of [1006, 4401, 4408, 4503]) expect(FATAL_CLOSE_CODES.has(code)).toBe(false)
  })
})

describe('reconnect support', () => {
  it('resends only frames the server has not acknowledged', () => {
    const ring = new FrameRingBuffer(3)
    for (let seq = 0; seq < 5; seq++) ring.push(seq, seq * 100, new Int16Array(1))
    expect(ring.after(2).map((f) => f.seq)).toEqual([3, 4])
    expect(ring.after(-1).map((f) => f.seq)).toEqual([2, 3, 4])
  })

  it('backs off exponentially up to eight seconds', () => {
    expect([0, 1, 2, 3, 4, 5].map(backoffMs)).toEqual([500, 1000, 2000, 4000, 8000, 8000])
  })
})

describe('downsampling', () => {
  it('turns 48 kHz into 16 kHz by averaging windows of three', () => {
    const down = new BoxDownsampler(3)
    const out: number[] = []
    down.push(new Float32Array([0.3, 0.3, 0.3, 0.6, 0.6, 0.6, 0.9]), (s) => out.push(s))
    expect(out).toHaveLength(2)
    expect(out[0]).toBeCloseTo(0.3)
    expect(out[1]).toBeCloseTo(0.6)
    down.push(new Float32Array([0.9, 0.9]), (s) => out.push(s))
    expect(out[2]).toBeCloseTo(0.9)
  })

  it('handles fractional ratios without drifting', () => {
    const down = new BoxDownsampler(44_100 / 16_000)
    let count = 0
    down.push(new Float32Array(44_100), () => count++)
    expect(Math.abs(count - 16_000)).toBeLessThanOrEqual(1)
  })

  it('converts between float and PCM16 with clamping', () => {
    expect(toInt16(2)).toBe(32767)
    expect(toInt16(-2)).toBe(-32767)
    expect(int16ToFloat32(new Int16Array([-32768, 0]))[0]).toBe(-1)
    expect(() => new BoxDownsampler(0.5)).toThrow(RangeError)
  })
})
