import type { Vec3 } from '@/lib/types'

/** The four top-level areas of life from the product IA. */
export type CategoryId = 'career' | 'academic' | 'social' | 'practice'

/** Which procedural exterior to render for a location. */
export type BuildingKind =
  | 'tower'
  | 'campus'
  | 'auditorium'
  | 'restaurant'
  | 'cafe'
  | 'mall'
  | 'mart'
  | 'house'
  | 'busStop'
  | 'practice'
  | 'park'
  /** The Brain Lab: not in the Blender city model, drawn from code (`exterior`). */
  | 'lab'

/** Glyphs for the floating labels. */
export type PlaceIcon =
  | 'briefcase'
  | 'graduation'
  | 'dining'
  | 'tree'
  | 'coffee'
  | 'shopping'
  | 'language'
  | 'target'
  | 'bus'
  | 'brain'

export interface Category {
  id: CategoryId
  name: string
  /** Hex string, shared by the HUD (CSS) and the 3D accent materials. */
  color: string
}

export interface Location {
  id: string
  name: string
  /** Used for the floating label on narrow screens, where full names collide. */
  shortName: string
  /** Icon colour of the floating label — the colours of the TalkVille render. */
  markerColor: string
  /** Glyph inside the label's icon circle, after the TalkVille map art. */
  icon: PlaceIcon
  /** One line shown in the selection panel. */
  tagline: string
  category: CategoryId
  kind: BuildingKind
  /** World-space footprint centre. y is always 0 — the ground plane. */
  position: Vec3
  /** Y-rotation in radians so the facade faces its street. 0 faces +z. */
  rotation?: number
  /** Footprint in world units — drives the selection ring and the hitbox. */
  footprint: [number, number]
  /** Height at which the floating label sits, above the roof. */
  labelHeight: number
  /**
   * Which way the camera sits when this location is focused.
   *
   * `offset` is a DIRECTION in the location's LOCAL frame (before `rotation`) —
   * its magnitude is ignored. The actual distance and look-at height are
   * derived from `footprint` and `labelHeight`, so a building frames correctly
   * whether it is a bus shelter or a 50-unit tower, and re-orienting it never
   * means re-authoring its camera.
   */
  focus: { offset: Vec3 }
  /** Door position in the LOCAL frame. The final approach target. */
  door: Vec3
  /** Practice areas that will later be offered inside. Display only for now. */
  practiceAreas: string[]
  /** True when the interior registry has a module for this location. */
  hasInterior?: boolean
  /** Photo-only interiors skip the front doors and open straight into this room. */
  arrival?: 'meeting' | 'theater'
  /** A screen of its own, opened from the panel instead of practice areas (the Language Center). */
  opens?: 'language'
  /**
   * The building isn't part of the Blender city model: the city draws `EXTERIORS[kind]` here
   * (the Brain Lab, which replaced the waterfront restaurant; see `CUTOUTS` in TalkVilleModel).
   */
  exterior?: boolean
}
