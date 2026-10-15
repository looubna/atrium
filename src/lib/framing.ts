import { Vector3 } from 'three'
import type { Location } from '@/data/types'

export interface CameraPose {
  /** Where the camera sits. */
  position: Vector3
  /** Where it looks — also the orbit pivot once the move finishes. */
  target: Vector3
}

/**
 * Framing maths.
 *
 * Every pose is computed from the live viewport rather than authored for one
 * screen. A pose tuned on a 16:9 desktop crops most of the city away on a
 * portrait phone, because the horizontal field of view collapses with the
 * aspect ratio — so distance has to be solved, not guessed.
 */

const DEG = Math.PI / 360

/** Half-angle tangents: vertical is fov-only, horizontal also scales with aspect. */
const tans = (fov: number, aspect: number) => {
  const v = Math.tan(fov * DEG)
  return { v, h: v * aspect }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * A wider lens on narrow screens. Portrait phones cannot afford a 42° lens —
 * the horizontal view would be under 30° — and a room shot wide reads normally.
 */
export const viewFov = (aspect: number) => (aspect < 1.25 ? lerp(52, 42, clamp((aspect - 0.5) / 0.75, 0, 1)) : 42)

/** Azimuth of the opening shot, measured from +Z: from the south-west,
 *  looking north-east up the bay. At this angle the Company tower sits inside
 *  the left of the frame and the bridge runs away from the city on the right. */
const CITY_AZIMUTH = -35 * (Math.PI / 180)
/** Centre of the landmark cluster, nudged toward downtown so the Company tower
 *  sits inside the left of a portrait frame rather than on its edge. */
const CITY_PIVOT = new Vector3(4, 0, 6.5)

/**
 * How far the opening shot reaches along its view axis, in world units from
 * the pivot. The top edge of the screen lands out on the bay, past both
 * bridge towers but short of the far shore; the bottom edge lands just below
 * the Practice Center, so the woods are a margin rather than half the screen.
 */
const REACH_TOWARD_BAY = 200
const REACH_TOWARD_WOODS = 85

/** Steepest the bottom edge of the frame may look — straight down misbehaves. */
const MAX_BOTTOM_RAY = 85 * (Math.PI / 180)

/**
 * The opening shot: from the south-west, looking up the avenue toward the bay,
 * framed between two edges of the world rather than around the horizon — the
 * water at the top of the screen, the woods at the bottom. No far shore, no
 * sky, no bare island rim, on any viewport.
 *
 * Choose a pitch, and the camera's distance behind the pivot `d` and height `H`
 * follow from the top and bottom frustum rays meeting the ground at those two
 * reaches:
 *
 *   H = (d + bay)·tan(pitch − fov/2) = (d − woods)·tan(pitch + fov/2)
 *
 * Only the pitch differs by aspect: a portrait phone looks more steeply down,
 * which makes the band of ground between the edges fill a tall screen.
 */
export const cityPose = (fov: number, aspect: number): CameraPose => {
  const wide = clamp((aspect - 0.6) / 1.0, 0, 1)
  const half = (fov / 2) * (Math.PI / 180)
  const pitch = Math.min(lerp(55, 50, wide) * (Math.PI / 180), MAX_BOTTOM_RAY - half)

  const tanTop = Math.tan(pitch - half)
  const tanBottom = Math.tan(pitch + half)
  const d = (REACH_TOWARD_WOODS * tanBottom + REACH_TOWARD_BAY * tanTop) / (tanBottom - tanTop)
  const height = (d + REACH_TOWARD_BAY) * tanTop

  // Unit vector from the pivot back toward the camera.
  const back = new Vector3(Math.sin(CITY_AZIMUTH), 0, Math.cos(CITY_AZIMUTH))
  const position = CITY_PIVOT.clone().addScaledVector(back, d).setY(height)

  // Orbit around where the centre of the view meets the ground.
  const ahead = height / Math.tan(pitch) - d
  const target = CITY_PIVOT.clone().addScaledVector(back, -ahead)

  // The island is narrower than a wide screen: framed by its top and bottom edges alone, a landscape
  // viewport shows water past both sides and the island's rim, a floating slab. Wider than
  // CITY_FIT_ASPECT, the camera moves in along its view until the land fills the width.
  if (aspect > CITY_FIT_ASPECT) {
    const k = Math.max(CITY_MIN_ZOOM, CITY_FIT_ASPECT / aspect)
    position.sub(target).multiplyScalar(k).add(target)
  }

  return { position, target }
}

/** Widest viewport the island fills from its opening shot (measured at 1500×1000, 1280×720 and 852×393). */
const CITY_FIT_ASPECT = 1.12
/** Never closer than this share of the opening distance, however wide the screen. */
const CITY_MIN_ZOOM = 0.62

/** Rotate a local-frame offset into world space. */
const rotateY = (vec: readonly [number, number, number], angle: number) => {
  const s = Math.sin(angle)
  const c = Math.cos(angle)
  return new Vector3(vec[0] * c + vec[2] * s, vec[1], -vec[0] * s + vec[2] * c)
}

/** World-space door position for a location. */
export const doorWorld = (loc: Location) => {
  const base = new Vector3(...loc.position)
  return base.add(rotateY(loc.door, loc.rotation ?? 0))
}

/**
 * Mid-range pose: the building fills the frame but its surroundings stay
 * readable, so the user keeps their bearings in the city.
 *
 * The distance is solved from the building's own size against BOTH axes of the
 * current viewport, and the tighter one wins. A single authored offset cannot
 * serve a bus shelter and a 52-unit tower — nor a phone and a desktop. A tall
 * tower is governed by height on a wide screen and by width on a narrow one.
 */
export const locationPose = (loc: Location, fov: number, aspect: number): CameraPose => {
  const base = new Vector3(...loc.position)
  const dir = rotateY(loc.focus.offset, loc.rotation ?? 0).normalize()

  const { v, h } = tans(fov, aspect)
  const height = loc.labelHeight
  const spread = Math.hypot(loc.footprint[0], loc.footprint[1])

  // 0.72 leaves the building comfortably inside the frame with street context.
  const distance = Math.max((height * 0.72) / v, (spread * 0.72) / h) + 8

  return {
    position: base.clone().addScaledVector(dir, distance),
    target: base.clone().setY(height * 0.46),
  }
}

/**
 * Final approach: right at the door, eye height. Derived from `door` rather
 * than authored per location, so new buildings need no extra camera data.
 */
export const entrancePose = (loc: Location, aspect: number): CameraPose => {
  const door = doorWorld(loc)
  const outward = door.clone().sub(new Vector3(...loc.position)).setY(0)
  if (outward.lengthSq() < 1e-4) outward.set(0, 0, 1)
  outward.normalize()

  // A touch further back when the lens is narrow, so the doorway still reads.
  const back = aspect < 1 ? 17 : 13
  return {
    position: door.clone().addScaledVector(outward, back).setY(5.4),
    target: door.clone().setY(4.2),
  }
}
