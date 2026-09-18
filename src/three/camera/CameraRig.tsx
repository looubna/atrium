import { type ElementRef, useEffect, useMemo, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera, Spherical, Vector3 } from 'three'
import { getLocation } from '@/data/locations'
import type { Posture } from '@/data/practice'
import { cityPose, entrancePose, locationPose, viewFov, type CameraPose } from '@/lib/framing'
import { clamp01, easeInOutCubic } from '@/lib/utils'
import { useAppStore, T, type InteriorZone, type View } from '@/state/useAppStore'
import { INTERIOR_SPECS } from '../interiors/poses'

type OrbitRef = ElementRef<typeof OrbitControls>
type Mode = 'city' | 'location' | 'interior'

/** Per-mode orbit limits. Distances are scaled by the framing fit at runtime. */
const LIMITS: Record<Mode, {
  min: number
  max: number
  polarMin: number
  polarMax: number
  pan: Vector3
  near: number
  far: number
}> = {
  city: { min: 46, max: 300, polarMin: 0.22, polarMax: 1.34, pan: new Vector3(130, 26, 130), near: 1.2, far: 2600 },
  location: { min: 13, max: 160, polarMin: 0.12, polarMax: 1.46, pan: new Vector3(130, 30, 130), near: 0.8, far: 2600 },
  interior: { min: 2.2, max: 24, polarMin: 0.16, polarMax: 1.52, pan: new Vector3(13, 2.6, 16), near: 0.1, far: 160 },
}

/**
 * How far the city overview may drift from its opening shot. The overview is
 * a composed view of the map, not a free camera: a little turn, tilt and zoom
 * to feel alive, no panning. Selecting a place hands back full control.
 */
const CITY_FENCE = {
  /** Radians either side of the opening azimuth — beyond this the island rim swings into a corner. */
  turn: 0.15,
  /**
   * Radians toward overhead (smaller polar angle). Kept small: tilting down
   * swings the bottom edge of the frame back past the woods to the island rim.
   */
  tiltUp: 0.04,
  /** Radians toward the horizon — the top edge creeps toward the far shore. */
  tiltDown: 0.04,
  /** Distance multipliers on the opening shot. Zooming out would widen past both edges. */
  zoomIn: 0.72,
  zoomOut: 1.03,
} as const

/**
 * Portrait viewports get the interior's narrow stations when it declares them;
 * a presenter's posture picks its own point of view where the station has one.
 */
const interiorPose = (id: string, zone: InteriorZone, aspect: number, posture?: Posture) => {
  const spec = INTERIOR_SPECS[id]
  if (!spec) return null
  const narrow = aspect < 1.05
  const view = posture ? spec.sessionPoses?.[zone]?.[posture] : undefined
  if (view) return (narrow ? view.narrow : undefined) ?? view.wide
  return (narrow ? spec.posesNarrow?.[zone] : undefined) ?? spec.poses[zone]
}

const modeOf = (view: View): Mode =>
  view === 'interior' || view === 'exiting' ? 'interior' : view === 'city' ? 'city' : 'location'

interface Anim {
  from: CameraPose
  to: CameraPose
  /** Seconds. */
  duration: number
  elapsed: number
  /** Extra height at the midpoint, so a long move arcs instead of sliding. */
  lift: number
}

/**
 * Owns the camera for the whole app.
 *
 * Two regimes: OrbitControls drives it while at rest, and a scripted arc takes
 * over during a transition. Handing control back and forth through one `anim`
 * ref keeps the two from fighting, which is the usual failure mode when mixing
 * orbit controls with programmatic camera moves.
 *
 * Every resting pose is solved against the live viewport, so rotating a phone
 * or resizing a window re-frames rather than cropping.
 */
export function CameraRig() {
  const controls = useRef<OrbitRef>(null)
  const anim = useRef<Anim | null>(null)
  const prevMode = useRef<Mode>('city')
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)

  const view = useAppStore((s) => s.view)
  const selectedId = useAppStore((s) => s.selectedId)
  const interiorZone = useAppStore((s) => s.interiorZone)
  const poseNonce = useAppStore((s) => s.poseNonce)
  const session = useAppStore((s) => s.session)

  const mode = modeOf(view)
  const limits = LIMITS[mode]
  const aspect = size.width / Math.max(size.height, 1)
  // Indoors a narrow viewport needs an even wider lens: there are walls where
  // an exterior shot would simply step back.
  // A station may fix its own lens (the presenter's view from the stage).
  const zoneSpec = mode === 'interior' && selectedId ? INTERIOR_SPECS[selectedId] : undefined
  const posture = session && session.locationId === selectedId ? session.posture : undefined
  const sessionView = posture ? zoneSpec?.sessionPoses?.[interiorZone]?.[posture] : undefined
  const zoneFov =
    aspect < 1.05
      ? (sessionView?.fovNarrow ?? zoneSpec?.fovNarrow?.[interiorZone] ?? sessionView?.fov ?? zoneSpec?.fov?.[interiorZone])
      : (sessionView?.fov ?? zoneSpec?.fov?.[interiorZone])
  // A seated presenter cannot step back on a portrait screen: widen instead,
  // capped before the perspective distortion gets silly.
  const fitWidth = aspect < 1.05 ? sessionView?.fitWidthNarrow : undefined
  const fitFov = fitWidth ? Math.min(92, (2 * Math.atan(fitWidth / aspect) * 180) / Math.PI) : 0
  const fov = zoneFov !== undefined ? Math.max(zoneFov, fitFov) : viewFov(aspect) + (mode === 'interior' && aspect < 1.1 ? 8 : 0)
  /** Presenting is a fixed point of view: no orbit, zoom or pan. */
  const locked = mode === 'interior' && interiorZone !== 'door' && session?.locationId === selectedId

  /** The opening shot as orbit angles — the centre of the city fence. */
  const cityRest = useMemo(() => {
    const pose = cityPose(fov, aspect)
    return new Spherical().setFromVector3(pose.position.clone().sub(pose.target))
  }, [fov, aspect])

  /** Keep the lens in step with the viewport before any pose is solved. */
  useEffect(() => {
    if (camera.fov === fov) return
    camera.fov = fov
    camera.updateProjectionMatrix()
  }, [camera, fov])

  /** Opening shot: settle into the city pose instead of cutting to it. */
  useEffect(() => {
    const city = cityPose(fov, aspect)
    const start = city.position.clone().multiplyScalar(1.2)
    start.y = city.position.y * 1.34
    camera.position.copy(start)
    anim.current = {
      from: { position: start, target: city.target.clone() },
      to: city,
      duration: 2.4,
      elapsed: 0,
      lift: 0,
    }
    // Intentionally mount-only: later viewport changes are handled below.
  }, [camera])

  /** Retarget whenever the resting pose changes — including on resize/rotate. */
  useEffect(() => {
    const cameFromInterior = prevMode.current === 'interior'
    prevMode.current = mode

    const loc = getLocation(selectedId)
    let to: CameraPose | null = null
    let duration = 1.1

    if (view === 'city') {
      to = cityPose(fov, aspect)
      duration = T.locationToCity / 1000
    } else if (view === 'location' && loc) {
      to = locationPose(loc, fov, aspect)
      duration = T.cityToLocation / 1000
    } else if (view === 'entering' && loc) {
      to = entrancePose(loc, aspect)
      duration = T.approach / 1000
    } else if (view === 'interior' && loc) {
      // Every visit starts outside the front doors.
      to = interiorPose(loc.id, 'door', aspect)
      duration = 0 // revealed behind the veil — a move here would be unseen
    }

    if (!to) return

    // Crossing the exterior/interior boundary is always a cut: the veil is up,
    // and animating through a wall is worse than not animating at all.
    if (duration === 0 || cameFromInterior) {
      const c = controls.current
      if (c) {
        // drei updates the controls before this rig's frame runs, so on the
        // next frame they would still carry the previous regime's limits —
        // stepping outside, the interior's 24-unit zoom ceiling would drag the
        // camera into the facade. Lift the limits; the rig re-applies the
        // right ones in that same frame.
        c.minDistance = 0
        c.maxDistance = Infinity
        c.minPolarAngle = 0
        c.maxPolarAngle = Math.PI
        c.target.copy(to.target)
      }
      camera.position.copy(to.position)
      anim.current = null
      return
    }

    const from: CameraPose = {
      position: camera.position.clone(),
      target: controls.current?.target.clone() ?? new Vector3(),
    }
    anim.current = {
      from,
      to,
      duration,
      elapsed: 0,
      // Long hops rise over the city; short adjustments stay flat.
      lift: Math.min(from.position.distanceTo(to.position) * 0.11, 24),
    }
  }, [view, selectedId, poseNonce, camera, mode, fov, aspect])

  /** Moving between stations inside an interior. */
  useEffect(() => {
    if (view !== 'interior' || !selectedId) return
    const to = interiorPose(selectedId, interiorZone, aspect, posture)
    if (!to) return

    if (locked) {
      // A presenter arrives behind the veil (see scanPass): a cut, not a walk
      // through seats and glass partitions.
      const c = controls.current
      if (c) {
        c.minDistance = 0
        c.maxDistance = Infinity
        c.minPolarAngle = 0
        c.maxPolarAngle = Math.PI
        c.target.copy(to.target)
      }
      camera.position.copy(to.position)
      anim.current = null
      return
    }

    anim.current = {
      from: {
        position: camera.position.clone(),
        target: controls.current?.target.clone() ?? new Vector3(),
      },
      to,
      // A walk across a room is quick; the long walk from the front doors to
      // the auditorium takes proportionally longer.
      duration: Math.min(2.6, Math.max(0.95, camera.position.distanceTo(to.position) / 18)),
      elapsed: 0,
      lift: 0.25,
    }
  }, [interiorZone, view, selectedId, camera, aspect, posture, locked])

  useFrame((_, dt) => {
    const c = controls.current
    if (!c) return

    const a = anim.current
    if (a) {
      c.enabled = false
      a.elapsed += dt
      const k = easeInOutCubic(clamp01(a.elapsed / a.duration))

      camera.position.lerpVectors(a.from.position, a.to.position, k)
      camera.position.y += Math.sin(k * Math.PI) * a.lift
      c.target.lerpVectors(a.from.target, a.to.target, k)

      if (a.elapsed >= a.duration) {
        camera.position.copy(a.to.position)
        c.target.copy(a.to.target)
        anim.current = null
      }
    } else {
      c.enabled = !locked

      // Keep the orbit pivot in bounds so panning cannot strand the user.
      // Outdoors the floor is well below ground: narrow viewports deliberately
      // drop the look-at point to lift the city clear of the bottom panel, and
      // clamping that to y=0 would snap the composition back every frame.
      const bounds = mode === 'interior' && selectedId ? INTERIOR_SPECS[selectedId]?.bounds : undefined
      if (bounds) {
        // An interior declares its own floor plan: a symmetric box cannot
        // fit a building with a hall off one side.
        c.target.clamp(bounds.min, bounds.max)
      } else {
        const p = limits.pan
        const floorY = mode === 'interior' ? 0.9 : -70
        c.target.set(
          Math.min(p.x, Math.max(-p.x, c.target.x)),
          Math.min(p.y, Math.max(floorY, c.target.y)),
          Math.min(p.z, Math.max(-p.z, c.target.z)),
        )
      }

      // Never drop the camera through the pavement or the floor slab.
      const eyeFloor = mode === 'interior' ? 1.1 : 2.5
      if (camera.position.y < eyeFloor) camera.position.y = eyeFloor
    }

    // A narrow viewport pushes every pose further out, so the zoom ceiling has
    // to follow or the framing would be clipped by the controls themselves.
    const reach = mode === 'interior' ? 1 : Math.max(1, 1.6 / aspect)

    // The overview is fenced around its opening shot — but only once the
    // camera has landed. OrbitControls clamps on every update, so a fence in
    // force mid-flight would snap the move back to city → location and back.
    if (mode === 'city' && !anim.current) {
      c.minDistance = cityRest.radius * CITY_FENCE.zoomIn
      c.maxDistance = cityRest.radius * CITY_FENCE.zoomOut
      c.minPolarAngle = cityRest.phi - CITY_FENCE.tiltUp
      c.maxPolarAngle = cityRest.phi + CITY_FENCE.tiltDown
      c.minAzimuthAngle = cityRest.theta - CITY_FENCE.turn
      c.maxAzimuthAngle = cityRest.theta + CITY_FENCE.turn
    } else {
      c.minDistance = limits.min
      c.maxDistance = limits.max * reach
      c.minPolarAngle = limits.polarMin
      c.maxPolarAngle = limits.polarMax
      c.minAzimuthAngle = -Infinity
      c.maxAzimuthAngle = Infinity
    }
    c.update()

    // Tight near/far per context — free depth-buffer precision.
    if (camera.near !== limits.near) {
      camera.near = limits.near
      camera.far = limits.far
      camera.updateProjectionMatrix()
    }
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.075}
      rotateSpeed={0.62}
      zoomSpeed={0.85}
      panSpeed={0.7}
      screenSpacePanning={false}
      // Panning only around a selected place; the overview is a composed shot.
      enablePan={mode === 'location'}
    />
  )
}
