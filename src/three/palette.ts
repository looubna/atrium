/**
 * One palette for the whole world. Everything procedural pulls from here so
 * the city reads as a single designed place rather than assorted geometry.
 * Late-afternoon light, warm stone, cool glass, desaturated greens.
 */
export const P = {
  // Sky / atmosphere
  skyZenith: '#5d8fc4',
  skyMid: '#a8c8e0',
  skyHorizon: '#f4e3ce',
  sunTint: '#fff1d8',
  fog: '#eadfd0',
  /** Behind the island, below the horizon line. */
  backdrop: '#9aa8ad',

  // Ground
  earth: '#8f9c86',
  grass: '#8ba37d',
  grassDark: '#748d69',
  pavement: '#c8c3b8',
  pavementEdge: '#b3ada1',
  asphalt: '#565d65',
  asphaltLine: '#d8d2c4',
  crosswalk: '#e4e0d4',

  // Architecture
  stoneLight: '#ece5d9',
  stone: '#ddd5c6',
  stoneWarm: '#d6c6b0',
  stoneDeep: '#b7ac9b',
  brick: '#bf8f76',
  brickDeep: '#a1725c',
  concrete: '#9a9791',
  roof: '#55565c',
  roofWarm: '#8c6b5d',
  trim: '#f6f2ea',

  // Glass
  glass: '#8fb3c9',
  glassDeep: '#5c7f96',
  glassLit: '#ffe9bd',

  // Nature & props
  trunk: '#6a5745',
  foliage: '#7d9a6c',
  foliageAlt: '#6d8d60',
  foliageWarm: '#9aa864',
  metal: '#6f7780',
  metalDark: '#4d545c',
  wood: '#a8784f',
  fabric: '#c4553f',
  water: '#6f9fb5',
} as const

/**
 * Golden-hour atmosphere of the TalkVille render, used by the city only — the
 * interiors keep the daylight palette above.
 */
export const TV = {
  skyZenith: '#8fa3c7',
  skyMid: '#e9bfa0',
  skyHorizon: '#fde3c4',
  /** Below the horizon line, behind the bay. */
  backdrop: '#b9a79b',
  fog: '#f0cfb0',
  sun: '#ffb877',
  /** Ambient bounce: warm sky above, green ground below. */
  hemiSky: '#f2c9a5',
  hemiGround: '#6f7d63',
  fill: '#9fb4d8',
} as const

/** Category accents. Must match CATEGORIES in data/locations.ts. */
export const ACCENT = {
  career: '#6aa9ff',
  academic: '#c084fc',
  social: '#fbbf6b',
  practice: '#34d399',
} as const
