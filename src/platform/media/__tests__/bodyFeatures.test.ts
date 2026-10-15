import { describe, expect, it } from 'vitest'
import { faceWidth, p95, poseFeatures, poseSlot, wristTravel } from '../bodyFeatures'

type L = { x: number; y: number; z: number; visibility: number }
const hidden: L = { x: 0.5, y: 0.5, z: 0, visibility: 0 }
const at = (x: number, y: number): L => ({ x, y, z: 0, visibility: 0.9 })

function pose(points: Record<number, L>): L[] {
  return Array.from({ length: 33 }, (_, i) => points[i] ?? hidden)
}

// The person's left shoulder (11) appears on the image's right in an unmirrored camera frame.
const LEVEL = { 11: at(0.6, 0.6), 12: at(0.4, 0.6) }

describe('body numbers from one pose', () => {
  it('measures level shoulders, the head above them and wrists relative to them', () => {
    const f = poseFeatures(pose({ 0: at(0.5, 0.4), ...LEVEL, 15: at(0.6, 0.9), 16: at(0.4, 0.9) }), 1)!
    expect(f.tilt).toBeCloseTo(0)
    expect(f.shoulderW).toBeCloseTo(0.2)
    expect(f.sx).toBeCloseTo(0.5)
    expect(f.neck).toBeCloseTo(1)
    expect(f.lw![0]).toBeCloseTo(0.5)
    expect(f.lw![1]).toBeCloseTo(1.5)
    expect(f.rw![0]).toBeCloseTo(-0.5)
  })

  it('reads a lower left shoulder as a positive tilt, mirrored or not', () => {
    const tilted = { 11: at(0.6, 0.65), 12: at(0.4, 0.6) }
    const mirrored = { 11: at(0.4, 0.65), 12: at(0.6, 0.6) }
    const a = poseFeatures(pose(tilted), 1)!
    const b = poseFeatures(pose(mirrored), 1)!
    expect(a.tilt).toBeGreaterThan(10)
    expect(b.tilt).toBeCloseTo(a.tilt)
  })

  it('measures square on a wide image', () => {
    // 16:9: the same shoulders are wider in image-height units, and the tilt flatter.
    const f = poseFeatures(pose({ 11: at(0.6, 0.65), 12: at(0.4, 0.6) }), 16 / 9)!
    expect(f.shoulderW).toBeCloseTo(Math.hypot(0.2 * (16 / 9), 0.05))
    expect(f.tilt).toBeLessThan(poseFeatures(pose({ 11: at(0.6, 0.65), 12: at(0.4, 0.6) }), 1)!.tilt)
  })

  it('gives nothing without both shoulders, and no wrist or head it cannot see', () => {
    expect(poseFeatures(pose({ 11: at(0.6, 0.6) }), 1)).toBeNull()
    const f = poseFeatures(pose(LEVEL), 1)!
    expect(f.neck).toBeNull()
    expect(f.lw).toBeNull()
  })

  it('drops what the server would refuse: a body too far away, a wrist far outside its reach', () => {
    expect(poseFeatures(pose({ 11: at(0.51, 0.5), 12: at(0.5, 0.5) }), 1)).toBeNull()
    // Shoulders at the top edge, a wrist at the bottom: 24 shoulder widths away, past the API's bound.
    const f = poseFeatures(pose({ 11: at(0.52, 0.02), 12: at(0.48, 0.02), 15: at(0.5, 1) }), 1)!
    expect(f.lw).toBeNull()
  })

  it('adds up wrist travel only for wrists seen in both samples', () => {
    const a = poseFeatures(pose({ ...LEVEL, 15: at(0.6, 0.9), 16: at(0.4, 0.9) }), 1)!
    const b = poseFeatures(pose({ ...LEVEL, 15: at(0.6, 0.8) }), 1)!
    expect(wristTravel(a, b)).toBeCloseTo(0.5)
    expect(wristTravel(null, b)).toBe(0)
  })

  it('measures the face cheek to cheek', () => {
    const face: L[] = []
    face[234] = at(0.4, 0.3)
    face[454] = at(0.55, 0.3)
    expect(faceWidth(face, 1)).toBeCloseTo(0.15)
    expect(faceWidth(undefined, 1)).toBeNull()
  })

  it('puts each sample in its slot of the second', () => {
    expect([0, 249, 250, 999, 1000, 1999].map((ms) => poseSlot(ms, 4))).toEqual([0, 0, 1, 3, 0, 3])
    expect(poseSlot(600, 2)).toBe(1)
  })

  it('takes a 95th percentile', () => {
    expect(p95([])).toBe(0)
    expect(p95(Array.from({ length: 20 }, (_, i) => i + 1))).toBe(20)
    expect(p95([...Array(19).fill(10), 100])).toBe(100)
  })
})
