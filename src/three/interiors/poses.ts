import { Vector3 } from 'three'
import type { Posture } from '@/data/practice'
import type { CameraPose } from '@/lib/framing'
import type { InteriorZone } from '@/state/useAppStore'

/** A presenter's point of view at a station, for one posture. */
export interface SessionView {
  wide: CameraPose
  narrow?: CameraPose
  fov?: number
  fovNarrow?: number
  /**
   * On a portrait screen, widen the lens past `fovNarrow` until this much of
   * the view stays in frame sideways (tangent of the horizontal half-angle),
   * rather than stepping the presenter back out of their seat.
   */
  fitWidthNarrow?: number
}

export interface InteriorSpec {
  poses: Record<InteriorZone, CameraPose>
  /**
   * Optional stations for portrait viewports. A narrow lens inside a room sees
   * almost nothing — at the entrance you face the logo wall and little else —
   * and there is no room to simply step back. Raising the eye above the
   * furniture and tilting down reveals the plan instead.
   */
  posesNarrow?: Partial<Record<InteriorZone, CameraPose>>
  /** Optional fixed vertical field of view per station, in degrees. */
  fov?: Partial<Record<InteriorZone, number>>
  /** The same, for portrait viewports. */
  fovNarrow?: Partial<Record<InteriorZone, number>>
  /** Where a presenter's eyes are at a station, by posture — used instead of `poses` during a session. */
  sessionPoses?: Partial<Record<InteriorZone, Partial<Record<Posture, SessionView>>>>
  /** Orbit pivot is clamped to this box so the camera cannot leave the floor. */
  bounds: { min: Vector3; max: Vector3 }
  /** Zones offered in the interior HUD, in walking order. */
  zones: { id: InteriorZone; label: string; note: string }[]
}

const pose = (p: [number, number, number], t: [number, number, number]): CameraPose => ({
  position: new Vector3(...p),
  target: new Vector3(...t),
})

/**
 * Camera stations for each interior, keyed by location id. Interiors declare
 * their own stations so the rig needs no knowledge of any specific floor plan.
 */
export const INTERIOR_SPECS: Record<string, InteriorSpec> = {
  company: {
    poses: {
      // On the plaza, facing the big doors and the pass reader. The target
      // stays below eye height (OrbitControls' polar limit forbids looking up)
      // and inside the rig's pan box (z <= 16), so it is not clamped at rest.
      door: pose([0, 2.6, 28], [0, 1.9, 16]),
      // Eye height, not ceiling height: a 4-5 unit ceiling with a 42 degree
      // vertical fov means anything above ~2 units fills the frame with soffit.
      entrance: pose([0, 2.1, 16.6], [0, 1.2, 1.5]),
      reception: pose([4.6, 1.9, 13.2], [0, 1.2, 7.6]),
      meeting: pose([-1.2, 2.1, 3.4], [-6.2, 1.2, -5.4]),
      office: pose([2.6, 2.1, 3.4], [10, 1.1, -10]),
      // On stage at the presenter's eye height, facing the house: the panel
      // at the table in front, the rows rising behind. The walk in stays under
      // the doorway's 3.8 head height and above the seated heads in the aisle.
      // The presenter's own eyes, standing just behind the lectern and looking
      // a little down over it: notes and microphone at the bottom of the frame,
      // the panel beyond, the raked rows rising behind.
      theater: pose([-0.05, 2.6, -40.6], [-0.05, 1.48, -32.6]),
    },
    posesNarrow: {
      // Further back and almost level on a portrait screen: the emblem, the
      // portal, both door leaves and the reader all sit above the pass panel.
      door: pose([0, 2.9, 30], [0, 1.95, 16]),
      // Diagonally across the lobby from just inside the doors. Straight on,
      // a narrow lens sees nothing but the navy logo wall.
      entrance: pose([3.5, 3.8, 16.2], [-2.5, 0.9, 5.5]),
      reception: pose([5.6, 3.0, 13.2], [0, 1.0, 7.6]),
      meeting: pose([-1.0, 3.3, 5.2], [-6.2, 1.0, -5.4]),
      office: pose([2.4, 3.3, 5.2], [10, 1.0, -10]),
      // A step back and a little higher on a portrait screen, so the panel
      // clears the HUD at the bottom and the rows fill the frame above.
      // A portrait phone is too narrow to hold the whole panel from the lip of
      // the stage: step back to the rear of the stage, a little higher.
      // Further back on the stage (the lectern moves with it) so all five
      // panelists fit a portrait screen, tipped down to keep the microphone in.
      theater: pose([-0.05, 2.6, -43.4], [-0.05, 1.19, -35.4]),
    },
    // A tighter lens on stage: the whole audience spans only ~17° vertically,
    // and a wide lens spends most of a portrait screen on ceiling and floor.
    // Wide enough to hold the lectern in the foreground and the room beyond.
    fov: { theater: 50 },
    fovNarrow: { theater: 64 },
    sessionPoses: {
      // Small-room presentation. The table runs along x
      // with its head at x = -8.5; the oak wall and screen are on the
      // presenter's left, glass ahead and to the right. Standing, the presenter
      // is just behind the head of the table; sitting, they are at it, level
      // with the attendees across the tabletop.
      meeting: {
        standing: {
          wide: pose([-9.7, 1.65, -5.95], [-5.5, 1.0, -5.4]),
          narrow: pose([-10.3, 1.75, -5.75], [-5.5, 0.95, -5.4]),
          fov: 55,
          fovNarrow: 70,
          fitWidthNarrow: 0.5,
        },
        // Portrait keeps the presenter in their seat: a chair-back further
        // out, and a wider lens so the attendees either side stay in view.
        sitting: {
          wide: pose([-9.15, 1.2, -5.4], [-5.5, 0.95, -5.4]),
          narrow: pose([-9.3, 1.22, -5.4], [-5.5, 0.9, -5.4]),
          fov: 55,
          fovNarrow: 68,
          fitWidthNarrow: 0.46,
        },
      },
    },
    bounds: {
      min: new Vector3(-13, 0.8, -44),
      max: new Vector3(13, 4.1, 16),
    },
    zones: [
      { id: 'entrance', label: 'Entrance', note: 'Arrival and the front desk sightline' },
      { id: 'reception', label: 'Reception', note: 'Where a visit begins' },
      { id: 'meeting', label: 'Meeting room', note: 'Six seats, glass walls' },
      { id: 'office', label: 'Open office', note: 'Desks, monitors, daylight' },
      { id: 'theater', label: 'Auditorium', note: 'On stage: the panel in front, the audience behind' },
    ],
  },
}
