/**
 * The city plan. Everything spatial derives from these numbers, so the road
 * grid, the kerbs, the street furniture and the location dataset can never
 * drift out of alignment.
 */
export const GRID = {
  /** Road centrelines, on both axes. */
  roads: [-56, 0, 56],
  /** Distance from a centreline to the kerb. */
  roadHalf: 6.5,
  /** Outer limit of the paved city. */
  extent: 96,
  /** Height of the kerb / pavement above the road surface. */
  curb: 0.32,
} as const

export interface Band {
  c: number
  w: number
}

/** Block extents between the roads, per axis. */
export const BANDS: Band[] = [
  { c: -79, w: 33 },
  { c: -28, w: 43 },
  { c: 28, w: 43 },
  { c: 79, w: 33 },
]

/** True when a point sits on carriageway rather than on a block. */
export const onRoad = (v: number) =>
  GRID.roads.some((r) => Math.abs(v - r) <= GRID.roadHalf + 0.5)

/** Nearest kerb line to a road, on the given side. */
export const kerb = (road: number, side: 1 | -1) => road + side * GRID.roadHalf
