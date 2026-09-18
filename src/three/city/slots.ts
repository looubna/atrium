import { LOCATIONS } from '@/data/locations'
import { rand } from '@/lib/utils'
import { GRID } from './grid'

const { roads, roadHalf, extent, curb } = GRID

export interface Slot {
  pos: [number, number, number]
  /** Facing the carriageway. */
  rot: number
  seed: number
}

/** Axis-aligned keep-out rectangles so street furniture never clips a plot. */
const keepOut = LOCATIONS.map((l) => {
  const turned = Math.abs(Math.round(((l.rotation ?? 0) / Math.PI) * 2)) % 2 === 1
  const [fw, fd] = turned ? [l.footprint[1], l.footprint[0]] : l.footprint
  return {
    x: l.position[0],
    z: l.position[2],
    hw: fw / 2 + 2.5,
    hd: fd / 2 + 2.5,
  }
})

const blocked = (x: number, z: number) =>
  keepOut.some((k) => Math.abs(x - k.x) < k.hw && Math.abs(z - k.z) < k.hd)

const nearJunction = (t: number) => roads.some((r) => Math.abs(t - r) < 13)

/**
 * Evenly spaced positions along every pavement edge, walking both sides of
 * every road. Street furniture is dealt out of this list round-robin, which is
 * what makes the streetscape feel laid out rather than sprinkled.
 */
export const pavementSlots = (): Slot[] => {
  const out: Slot[] = []
  let n = 0

  for (const r of roads) {
    for (const side of [-1, 1] as const) {
      const lane = r + side * (roadHalf + 2.1)
      if (Math.abs(lane) > extent) continue

      for (let t = -extent + 7; t <= extent - 7; t += 11) {
        if (nearJunction(t)) continue

        // Along the road running parallel to X.
        if (!blocked(t, lane)) {
          out.push({ pos: [t, curb, lane], rot: side > 0 ? Math.PI : 0, seed: n++ })
        }
        // Along the road running parallel to Z.
        if (!blocked(lane, t)) {
          out.push({
            pos: [lane, curb, t],
            rot: side > 0 ? -Math.PI / 2 : Math.PI / 2,
            seed: n++,
          })
        }
      }
    }
  }
  return out
}

/** Kerbside parking bays, on the carriageway itself. */
export const parkingSlots = (): Slot[] => {
  const out: Slot[] = []
  let n = 500

  for (const r of roads) {
    for (const side of [-1, 1] as const) {
      for (let t = -extent + 18; t <= extent - 18; t += 27) {
        if (nearJunction(t)) continue
        if (rand(n) > 0.62) {
          out.push({ pos: [t, 0, r + side * (roadHalf - 2.4)], rot: 0, seed: n })
        }
        n++
        if (rand(n) > 0.62) {
          out.push({
            pos: [r + side * (roadHalf - 2.4), 0, t],
            rot: Math.PI / 2,
            seed: n,
          })
        }
        n++
      }
    }
  }
  return out
}
