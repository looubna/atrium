import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

/**
 * The numbers the body-language checks are built on (`backend/app/platform/media/body.py`), read
 * from one frame's landmarks. Only these numbers leave the device — never the landmarks or the frame.
 *
 * Distances are in image-height units (x scaled by the aspect ratio, so they are measured square), and
 * body positions are in shoulder widths, so they read the same near the camera or far from it.
 */

/** A landmark counts above this visibility, and inside the image (as in `readPose`). */
const VISIBLE = 0.5
const DEG = 180 / Math.PI
/** Shoulders narrower than this (image heights) are too far away to measure the body against. */
const MIN_SHOULDER_W = 0.03
/**
 * Mirrors the API's bounds (`backend/app/platform/media/face_metrics.py`): a value outside them is
 * dropped here, because one out-of-range number makes the server refuse the whole upload.
 */
export const MAX_SPAN = 20
export const MAX_HAND_PATH = 100

const inSpan = (value: number) => Math.abs(value) <= MAX_SPAN

const NOSE = 0
const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12
const LEFT_WRIST = 15
const RIGHT_WRIST = 16
/** The face's outer cheek points, for its width. */
const FACE_LEFT = 234
const FACE_RIGHT = 454

export type Point = [number, number]

export interface PoseFeatures {
  /** The shoulder line's tilt in degrees; positive when the person's left shoulder is lower. */
  tilt: number
  shoulderW: number
  /** The shoulder midpoint's x. */
  sx: number
  /** How high the nose sits above the shoulder line, in shoulder widths; null when the nose is not seen. */
  neck: number | null
  /** Wrists relative to the shoulder midpoint, in shoulder widths; null when not seen. */
  lw: Point | null
  rw: Point | null
}

const seen = (l: NormalizedLandmark | undefined): l is NormalizedLandmark =>
  Boolean(l) && (l!.visibility ?? 0) > VISIBLE && l!.x >= 0 && l!.x <= 1 && l!.y >= 0 && l!.y <= 1

/** Body numbers for one pose, or null when the shoulders are not both in frame. */
export function poseFeatures(landmarks: NormalizedLandmark[], aspect: number): PoseFeatures | null {
  const left = landmarks[LEFT_SHOULDER]
  const right = landmarks[RIGHT_SHOULDER]
  if (!seen(left) || !seen(right)) return null
  const dx = (left.x - right.x) * aspect
  const dy = left.y - right.y
  const shoulderW = Math.hypot(dx, dy)
  if (shoulderW < MIN_SHOULDER_W) return null
  const mx = ((left.x + right.x) / 2) * aspect
  const my = (left.y + right.y) / 2
  const relative = (i: number): Point | null => {
    const l = landmarks[i]
    if (!seen(l)) return null
    const point: Point = [(l.x * aspect - mx) / shoulderW, (l.y - my) / shoulderW]
    return inSpan(point[0]) && inSpan(point[1]) ? point : null
  }
  const nose = landmarks[NOSE]
  const neck = seen(nose) ? (my - nose.y) / shoulderW : null
  return {
    // |dx|: the same sign whether or not the image is mirrored. Image y grows downward.
    tilt: Math.atan2(dy, Math.abs(dx)) * DEG,
    shoulderW,
    sx: mx,
    neck: neck !== null && inSpan(neck) ? neck : null,
    lw: relative(LEFT_WRIST),
    rw: relative(RIGHT_WRIST),
  }
}

/** The face's width, cheek to cheek, or null when the face mesh is incomplete. */
export function faceWidth(face: NormalizedLandmark[] | undefined, aspect: number): number | null {
  const a = face?.[FACE_LEFT]
  const b = face?.[FACE_RIGHT]
  return a && b ? Math.hypot((a.x - b.x) * aspect, a.y - b.y) : null
}

/** How far the wrists moved between two samples, in shoulder widths (wrists seen in both only). */
export function wristTravel(before: PoseFeatures | null, after: PoseFeatures): number {
  if (!before) return 0
  let travel = 0
  for (const key of ['lw', 'rw'] as const) {
    const a = before[key]
    const b = after[key]
    if (a && b) travel += Math.hypot(a[0] - b[0], a[1] - b[1])
  }
  return travel
}

/** Which of a second's `hz` pose slots a moment falls in, so every second has the same number of samples. */
export const poseSlot = (mediaMs: number, hz: number) => Math.min(hz - 1, Math.floor(((mediaMs % 1000) / 1000) * hz))

/** The 95th percentile of recent timings, for deciding when body tracking is too slow for this device. */
export function p95(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
}

/** The tiny grey copy of the frame the camera-motion check compares (columns × rows). */
export const MOTION_W = 32
export const MOTION_H = 18

/** Grey levels (0-255) from an RGBA image, row by row. */
export function grey(rgba: ArrayLike<number>): Float32Array {
  const out = new Float32Array(rgba.length / 4)
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
  return out
}

/**
 * How much the background changed between two grey thumbnails: the mean absolute difference over the
 * columns outside the person (`personX0..personX1`, 0..1 of the width), so a person moving in front of a
 * still camera barely changes it and a moving camera changes all of it. Null when too little background
 * is left to judge.
 */
export function backgroundChange(
  before: Float32Array,
  after: Float32Array,
  width: number,
  personX0: number,
  personX1: number,
): number | null {
  const height = after.length / width
  const x0 = Math.floor(Math.max(0, personX0) * width)
  const x1 = Math.ceil(Math.min(1, personX1) * width)
  let sum = 0
  let count = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= x0 && x < x1) continue
      const i = y * width + x
      sum += Math.abs(after[i] - before[i])
      count++
    }
  }
  return count >= (width * height) / 5 ? sum / count : null
}

/** The person's horizontal extent (0..1) from the landmarks seen, widened a little; null with none seen. */
export function personSpan(landmarks: NormalizedLandmark[], pad = 0.08): [number, number] | null {
  const xs = landmarks.filter(seen).map((l) => l.x)
  return xs.length ? [Math.min(...xs) - pad, Math.max(...xs) + pad] : null
}
