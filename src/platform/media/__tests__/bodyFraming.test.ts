import { describe, expect, it } from 'vitest'
import { framingOf, readPose, type BodySample } from '../faceMetrics'

type L = { x: number; y: number; z: number; visibility: number }
const hidden: L = { x: 0.5, y: 0.5, z: 0, visibility: 0 }
const at = (x: number, y: number): L => ({ x, y, z: 0, visibility: 0.9 })

/** A pose with the given landmarks set and the rest out of sight. */
function pose(points: Record<number, L>): L[] {
  return Array.from({ length: 33 }, (_, i) => points[i] ?? hidden)
}

const NOSE = 0
const SHOULDERS = { 11: at(0.4, 0.6), 12: at(0.6, 0.6) }

describe('reading a pose for body language', () => {
  it('sees hands resting low as hands in frame, not at the face', () => {
    const seen = readPose(pose({ [NOSE]: at(0.5, 0.35), ...SHOULDERS, 15: at(0.42, 0.95), 16: at(0.58, 0.95) }), 16 / 9)
    expect(seen).toEqual({ body: true, hands: true, handsFace: false, full: false })
  })

  it('sees hands on the head', () => {
    // The interview that prompted this: both hands up at the head, "calm" all the same.
    const seen = readPose(pose({ [NOSE]: at(0.5, 0.35), ...SHOULDERS, 15: at(0.45, 0.25), 16: at(0.55, 0.26) }), 16 / 9)
    expect(seen.handsFace).toBe(true)
  })

  it('knows when only the face is in frame', () => {
    const seen = readPose(pose({ [NOSE]: at(0.5, 0.5) }), 16 / 9)
    expect(seen.body).toBe(false)
  })

  it('sees the whole body when hips and feet are in frame', () => {
    const seen = readPose(
      pose({ [NOSE]: at(0.5, 0.1), ...SHOULDERS, 23: at(0.45, 0.6), 24: at(0.55, 0.6), 27: at(0.46, 0.95) }),
      9 / 16,
    )
    expect(seen.full).toBe(true)
  })

  it('does not count a landmark placed outside the image', () => {
    const seen = readPose(pose({ 11: at(0.4, 0.6), 12: at(0.6, 1.2) }), 16 / 9)
    expect(seen.body).toBe(false)
  })
})

const sample = (over: Partial<BodySample> = {}): BodySample => ({
  body: true, hands: true, handsFace: false, full: false, ...over,
})

describe('the framing warning', () => {
  it('says nothing when the upper body is in frame for a seated interview', () => {
    expect(framingOf([true, true, true, true], [sample(), sample(), sample()], false)).toBeNull()
  })

  it('asks to sit back when only the face shows', () => {
    const face = sample({ body: false, hands: false })
    expect(framingOf([true, true, true, true], [face, face, face], false)).toBe('too_close')
  })

  it('asks to step back for a full-body setting', () => {
    expect(framingOf([true, true, true, true], [sample(), sample(), sample()], true)).toBe('step_back')
    const whole = sample({ full: true })
    expect(framingOf([true, true, true, true], [whole, whole, whole], true)).toBeNull()
  })

  it('asks for the face first when it is missing', () => {
    expect(framingOf([false, false, false, true], [], false)).toBe('no_face')
  })

  it('waits for enough samples before warning', () => {
    const face = sample({ body: false })
    expect(framingOf([true], [face], false)).toBeNull()
  })
})
