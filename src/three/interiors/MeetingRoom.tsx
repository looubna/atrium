import { Suspense, useLayoutEffect, useMemo } from 'react'
import { Instance, Instances, useGLTF, useTexture } from '@react-three/drei'
import {
  CanvasTexture,
  type Group,
  type Mesh,
  type Object3D,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  type Texture,
} from 'three'
import { MEETING_ATTENDEE_IDS } from '@/data/meeting'
import { useAppStore } from '@/state/useAppStore'
import { People, PeopleBoundary, type SeatedPerson } from './people'

/**
 * The small meeting room, dressed like a real one: a warm oak feature wall
 * with the presentation screen, black-framed glass onto the office and the
 * skyline beyond, grey carpet tiles, a long oak table under a linear pendant,
 * mesh task chairs, and three attendees turned toward whoever presents from
 * the head of the table.
 *
 * Plan (world units, metres): the presenter sits at x = -9.15 looking +x down
 * the table. The oak wall is on their left (z = -8.8), glass on their right
 * (z = -2) and ahead (x = -2).
 *
 * Props (chair, laptops, mug, bottle, notebook, pendant, plants) come from one
 * GLB built in Blender; every prop's user side faces +z and sits on y = 0.
 */

const ROOM = { x0: -11.4, x1: -2, z0: -8.8, z1: -2 }
const ROOM_CX = (ROOM.x0 + ROOM.x1) / 2
const ROOM_CZ = (ROOM.z0 + ROOM.z1) / 2
const ROOM_W = ROOM.x1 - ROOM.x0
const ROOM_D = ROOM.z1 - ROOM.z0
/** A dropped ceiling: the hall's 5.2 m would make a small room feel like a gym. */
const CEIL_H = 3.0
const BUILDING_CEIL = 5.2

export const TABLE = { cx: -6.2, cz: -5.4, len: 4.6, wid: 1.6, top: 0.74, thick: 0.045 }
const TOP_Y = TABLE.top + TABLE.thick

const PROPS_URL = '/models/meeting/props.glb'
const TEX = '/textures/meeting'

/**
 * The attendees, turned toward the head of the table like the reference: one
 * each side of the far half, one at the far end. A yaw of 0 faces -z; π/2
 * faces -x, toward the presenter.
 */
const MEETING_SEATS: SeatedPerson[] = [
  { id: MEETING_ATTENDEE_IDS[0], model: 'meet_2', x: -5.0, y: 0.52, z: -6.65, yaw: Math.PI * 0.72, role: 'panel', seed: 901 },
  { id: MEETING_ATTENDEE_IDS[1], model: 'meet_1', x: -5.0, y: 0.52, z: -4.15, yaw: Math.PI * 0.28, role: 'panel', seed: 902 },
  { id: MEETING_ATTENDEE_IDS[2], model: 'meet_3', x: -3.45, y: 0.52, z: -5.4, yaw: Math.PI / 2, role: 'panel', seed: 903 },
]
/** The presenter's head, by posture — where the attendees look. Matches `poses.ts`. */
const MEETING_EYE = {
  standing: [-9.7, 1.65, -5.95] as [number, number, number],
  sitting: [-9.15, 1.2, -5.4] as [number, number, number],
}

/** Empty chairs nearer the presenter, pushed back a little and turned. */
const EMPTY_CHAIRS: { x: number; z: number; yaw: number }[] = [
  { x: -7.35, z: -6.95, yaw: Math.PI * 0.92 },
  { x: -7.3, z: -3.85, yaw: Math.PI * 0.06 },
]

/** Rotation that turns a prop's +z user side toward a point. */
const face = (fromX: number, fromZ: number, toX: number, toZ: number) => Math.atan2(toX - fromX, toZ - fromZ)

function useRepeat(tex: Texture, rx: number, ry: number, color = false) {
  return useMemo(() => {
    const t = tex.clone()
    t.wrapS = t.wrapT = RepeatWrapping
    t.repeat.set(rx, ry)
    if (color) t.colorSpace = SRGBColorSpace
    t.anisotropy = 8
    t.needsUpdate = true
    return t
  }, [tex, rx, ry, color])
}

/** A canvas-drawn screen or whiteboard face. */
function useCanvas(width: number, height: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    const g = c.getContext('2d')!
    draw(g, width, height)
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = 8
    return t
    // Drawn once; the function identity is irrelevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height])
}

function drawSlide(g: CanvasRenderingContext2D, w: number, h: number) {
  const grad = g.createLinearGradient(0, 0, w, h)
  grad.addColorStop(0, '#1f2d52')
  grad.addColorStop(1, '#131c36')
  g.fillStyle = grad
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#f3f5f8'
  g.font = '300 92px "Helvetica Neue", Helvetica, Arial, sans-serif'
  g.fillText('Better', 90, 230)
  g.fillText('Together', 90, 335)
  g.fillStyle = 'rgba(243,245,248,0.55)'
  g.fillRect(92, 420, 440, 3)
  g.fillStyle = 'rgba(243,245,248,0.85)'
  g.font = '400 34px "Helvetica Neue", Helvetica, Arial, sans-serif'
  g.fillText('Team  ·  Ideas  ·  Impact', 150, 480)
}

function drawWhiteboard(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#f7f8f8'
  g.fillRect(0, 0, w, h)
  const sheen = g.createLinearGradient(0, 0, w, h)
  sheen.addColorStop(0, 'rgba(255,255,255,0)')
  sheen.addColorStop(0.5, 'rgba(210,216,222,0.25)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = sheen
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#4a5563'
  g.font = 'italic 58px "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
  ;['- Ideas', '- Strategy', '- Growth'].forEach((line, i) => g.fillText(line, 120, 250 + i * 110))
}

/** A plain rounded-corner rectangle, for the tabletop. */
function roundedRect(w: number, d: number, r: number) {
  const s = new Shape()
  const x = -w / 2
  const y = -d / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + d - r)
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d)
  s.lineTo(x + r, y + d)
  s.quadraticCurveTo(x, y + d, x, y + d - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

/** One prop from the GLB, cloned, with shadows on. */
function Prop({
  scene,
  name,
  position,
  rotation = 0,
  scale = 1,
}: {
  scene: Group
  name: string
  position: [number, number, number]
  rotation?: number
  scale?: number
}) {
  const object = useMemo(() => {
    const src = scene.getObjectByName(name)
    if (!src) return null
    const o = src.clone(true)
    o.position.set(0, 0, 0)
    o.traverse((c: Object3D) => {
      const m = c as Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
        m.raycast = () => null
      }
    })
    return o
  }, [scene, name])
  if (!object) return null
  return <primitive object={object} position={position} rotation={[0, rotation, 0]} scale={scale} />
}

function Architecture() {
  const [oakDiff, oakNor, oakRough, carpetDiff, carpetNor, skyline] = useTexture([
    `${TEX}/oak_diff.jpg`,
    `${TEX}/oak_nor.jpg`,
    `${TEX}/oak_rough.jpg`,
    `${TEX}/carpet_diff.jpg`,
    `${TEX}/carpet_nor.jpg`,
    `${TEX}/skyline.jpg`,
  ])

  // Carpet tiles are 1 m; the oak grain is drawn at real scale (a texture spans ~1 m).
  const carpetMap = useRepeat(carpetDiff, ROOM_W / 1.0, ROOM_D / 1.0, true)
  const carpetNormal = useRepeat(carpetNor, ROOM_W / 1.0, ROOM_D / 1.0)
  const wallMap = useRepeat(oakDiff, ROOM_W / 1.0, CEIL_H / 1.0, true)
  const wallNormal = useRepeat(oakNor, ROOM_W / 1.0, CEIL_H / 1.0)
  const wallRough = useRepeat(oakRough, ROOM_W / 1.0, CEIL_H / 1.0)
  const tableMap = useRepeat(oakDiff, 1 / 0.9, 1 / 0.9, true)
  const tableNormal = useRepeat(oakNor, 1 / 0.9, 1 / 0.9)
  const tableRough = useRepeat(oakRough, 1 / 0.9, 1 / 0.9)
  useLayoutEffect(() => {
    skyline.colorSpace = SRGBColorSpace
    skyline.needsUpdate = true
  }, [skyline])

  const slide = useCanvas(1024, 585, drawSlide)
  const board = useCanvas(1024, 700, drawWhiteboard)
  const topShape = useMemo(() => roundedRect(TABLE.len, TABLE.wid, 0.09), [])

  const glass = <meshPhysicalMaterial color="#dfe9ee" roughness={0.04} metalness={0} transparent opacity={0.16} />
  const black = <meshStandardMaterial color="#141518" roughness={0.45} metalness={0.55} />

  const grooves = useMemo(() => Array.from({ length: Math.floor(ROOM_W / 0.7) }, (_, i) => ROOM.x0 + 0.7 * (i + 1)), [])
  const farMullions = [-8.8, -6.55, -4.3, -2.0]
  const sideMullions = [-11.4, -9.0, -6.6, -4.2, -2.0]

  return (
    <group>
      {/* Grey carpet tiles */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ROOM_CX, 0.012, ROOM_CZ]} receiveShadow>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial map={carpetMap} normalMap={carpetNormal} roughness={0.97} />
      </mesh>

      {/* Dropped ceiling, recessed downlights, and the bulkhead above the glass */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[ROOM_CX, CEIL_H, ROOM_CZ]}>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial color="#f4f3f0" roughness={0.95} />
      </mesh>
      <Instances limit={8}>
        <cylinderGeometry args={[0.075, 0.075, 0.01, 20]} />
        <meshStandardMaterial color="#fffaf0" emissive="#fff3de" emissiveIntensity={2.2} />
        {[-9.6, -6.2, -2.8].flatMap((x) => [-7.6, -3.2].map((z) => <Instance key={`${x}:${z}`} position={[x, CEIL_H - 0.005, z]} />))}
      </Instances>
      <mesh position={[ROOM.x1, (CEIL_H + BUILDING_CEIL) / 2, ROOM_CZ]}>
        <boxGeometry args={[0.12, BUILDING_CEIL - CEIL_H, ROOM_D + 0.12]} />
        <meshStandardMaterial color="#efece6" roughness={0.9} />
      </mesh>
      <mesh position={[ROOM_CX, (CEIL_H + BUILDING_CEIL) / 2, ROOM.z1]}>
        <boxGeometry args={[ROOM_W + 0.12, BUILDING_CEIL - CEIL_H, 0.12]} />
        <meshStandardMaterial color="#efece6" roughness={0.9} />
      </mesh>

      {/* Oak feature wall, vertical sheets with shadow-gap joints */}
      <mesh position={[ROOM_CX, BUILDING_CEIL / 2, ROOM.z0 - 0.06]} receiveShadow>
        <boxGeometry args={[ROOM_W + 0.12, BUILDING_CEIL, 0.12]} />
        <meshStandardMaterial color="#ead7bf" map={wallMap} normalMap={wallNormal} roughnessMap={wallRough} roughness={0.8} />
      </mesh>
      <Instances limit={grooves.length}>
        <boxGeometry args={[0.012, CEIL_H, 0.006]} />
        <meshStandardMaterial color="#3b2a1d" roughness={0.9} />
        {grooves.map((x) => (
          <Instance key={x} position={[x, CEIL_H / 2, ROOM.z0 + 0.001]} />
        ))}
      </Instances>
      <mesh position={[ROOM_CX, 0.05, ROOM.z0 + 0.012]}>
        <boxGeometry args={[ROOM_W, 0.1, 0.02]} />
        <meshStandardMaterial color="#2b2622" roughness={0.7} />
      </mesh>

      {/* Back wall behind the presenter */}
      <mesh position={[ROOM.x0 - 0.06, BUILDING_CEIL / 2, ROOM_CZ]} receiveShadow>
        <boxGeometry args={[0.12, BUILDING_CEIL, ROOM_D + 0.12]} />
        <meshStandardMaterial color="#ece8e1" roughness={0.92} />
      </mesh>

      {/* Presentation screen on the oak wall */}
      <group position={[-5.3, 1.72, ROOM.z0 + 0.04]}>
        <mesh castShadow>
          <boxGeometry args={[2.18, 1.26, 0.05]} />
          <meshStandardMaterial color="#0d0e10" roughness={0.35} metalness={0.4} />
        </mesh>
        <mesh position={[0, 0, 0.026]}>
          <planeGeometry args={[2.1, 1.18]} />
          <meshStandardMaterial map={slide} emissiveMap={slide} emissive="#ffffff" emissiveIntensity={0.55} roughness={0.25} />
        </mesh>
      </group>

      {/* Glass toward the office (ahead) and the corridor (right), in black frames */}
      <mesh position={[ROOM.x1, CEIL_H / 2, ROOM_CZ]}>
        <boxGeometry args={[0.03, CEIL_H, ROOM_D]} />
        {glass}
      </mesh>
      <mesh position={[ROOM_CX, CEIL_H / 2, ROOM.z1]}>
        <boxGeometry args={[ROOM_W, CEIL_H, 0.03]} />
        {glass}
      </mesh>
      <Instances limit={32} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        {black}
        {farMullions.map((z) => (
          <Instance key={`f${z}`} position={[ROOM.x1, CEIL_H / 2, z]} scale={[0.07, CEIL_H, 0.05]} />
        ))}
        {sideMullions.map((x) => (
          <Instance key={`s${x}`} position={[x, CEIL_H / 2, ROOM.z1]} scale={[0.05, CEIL_H, 0.07]} />
        ))}
        {/* Head and floor tracks */}
        <Instance position={[ROOM.x1, CEIL_H - 0.03, ROOM_CZ]} scale={[0.09, 0.06, ROOM_D]} />
        <Instance position={[ROOM.x1, 0.03, ROOM_CZ]} scale={[0.09, 0.06, ROOM_D]} />
        <Instance position={[ROOM_CX, CEIL_H - 0.03, ROOM.z1]} scale={[ROOM_W, 0.06, 0.09]} />
        <Instance position={[ROOM_CX, 0.03, ROOM.z1]} scale={[ROOM_W, 0.06, 0.09]} />
        {/* Glass door: a second frame and a long bar handle */}
        <Instance position={[-3.25, CEIL_H / 2, ROOM.z1 + 0.06]} scale={[0.04, CEIL_H, 0.03]} />
        <Instance position={[-3.4, 1.05, ROOM.z1 - 0.06]} scale={[0.025, 0.75, 0.025]} />
        <Instance position={[-3.4, 1.05, ROOM.z1 + 0.09]} scale={[0.025, 0.75, 0.025]} />
      </Instances>

      {/* Whiteboard on the corridor glass */}
      <group position={[-5.6, 1.55, ROOM.z1 - 0.05]} rotation={[0, Math.PI, 0]}>
        <mesh castShadow>
          <boxGeometry args={[1.66, 1.16, 0.03]} />
          <meshStandardMaterial color="#c9ccd0" roughness={0.3} metalness={0.7} />
        </mesh>
        <mesh position={[0, 0, 0.017]}>
          <planeGeometry args={[1.6, 1.1]} />
          <meshStandardMaterial map={board} roughness={0.18} />
        </mesh>
      </group>

      {/* The table: oak top with rounded corners, black legs and a cable tray */}
      <mesh position={[TABLE.cx, TABLE.top, TABLE.cz]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <extrudeGeometry args={[topShape, { depth: TABLE.thick, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 }]} />
        <meshStandardMaterial map={tableMap} normalMap={tableNormal} roughnessMap={tableRough} roughness={0.8} color="#eadbc7" />
      </mesh>
      <Instances limit={6} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        {black}
        {[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => (
            <Instance key={`${sx}:${sz}`} position={[TABLE.cx + sx * 1.75, TABLE.top / 2, TABLE.cz + sz * 0.5]} scale={[0.08, TABLE.top, 0.08]} />
          )),
        )}
        <Instance position={[TABLE.cx, TABLE.top - 0.05, TABLE.cz]} scale={[3.5, 0.06, 0.08]} />
      </Instances>
      <mesh position={[TABLE.cx - 0.45, TOP_Y + 0.004, TABLE.cz]}>
        <boxGeometry args={[0.6, 0.008, 0.13]} />
        <meshStandardMaterial color="#1a1b1e" roughness={0.4} metalness={0.6} />
      </mesh>
      <mesh position={[TABLE.cx - 0.45, TOP_Y + 0.0085, TABLE.cz]}>
        <boxGeometry args={[0.52, 0.001, 0.05]} />
        <meshStandardMaterial color="#050506" roughness={0.9} />
      </mesh>

      {/* The skyline beyond the office glazing */}
      <mesh position={[95, 21, -10]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[250, 49]} />
        <meshBasicMaterial map={skyline} toneMapped={false} fog={false} />
      </mesh>

      {/* Light: the pendant over the table, and a soft fill from the presenter's end */}
      <pointLight position={[TABLE.cx, 2.25, TABLE.cz]} intensity={7} distance={8} decay={1.5} color="#fff0db" />
      <pointLight position={[-9.8, 2.4, -5.4]} intensity={5} distance={8} decay={1.5} color="#fff3e6" />
    </group>
  )
}

function Furnishings() {
  const { scene } = useGLTF(PROPS_URL, '/draco/') as unknown as { scene: Group }
  const occupied = MEETING_SEATS.map((s) => ({ x: s.x, z: s.z, yaw: s.yaw }))
  const chairs = [...occupied, ...EMPTY_CHAIRS]

  return (
    <group>
      {chairs.map((c, i) => (
        // A chair's front is +z; an occupant with yaw θ faces (-sin θ, -cos θ).
        <Prop key={i} scene={scene} name="chair" position={[c.x, 0, c.z]} rotation={c.yaw + Math.PI} />
      ))}

      {/* Open laptops in front of each attendee, turned to them */}
      {MEETING_SEATS.map((s) => {
        const lx = s.x + (TABLE.cx + 0.2 - s.x) * 0.0 + (s.z === TABLE.cz ? -0.55 : -0.15)
        const lz = s.z === TABLE.cz ? s.z : s.z + Math.sign(TABLE.cz - s.z) * 1.0
        return <Prop key={s.id} scene={scene} name="laptop_open" position={[lx, TOP_Y, lz]} rotation={face(lx, lz, s.x, s.z)} />
      })}

      {/* The presenter's place: a closed laptop, a notebook and pen */}
      <Prop scene={scene} name="laptop_closed" position={[-8.05, TOP_Y, -5.3]} rotation={-Math.PI / 2} />
      <Prop scene={scene} name="notebook" position={[-8.0, TOP_Y, -4.78]} rotation={-Math.PI / 2 + 0.1} />
      <Prop scene={scene} name="mug" position={[-7.55, TOP_Y, -5.95]} rotation={0.6} />
      <Prop scene={scene} name="bottle" position={[-7.05, TOP_Y, -4.78]} />
      <Prop scene={scene} name="plant_small" position={[-5.35, TOP_Y, -5.22]} />

      <Prop scene={scene} name="pendant" position={[TABLE.cx, CEIL_H, TABLE.cz]} rotation={Math.PI / 2} />

      {/* Floor plants in concrete pots */}
      <Prop scene={scene} name="plant_floor" position={[-2.55, 0, -8.25]} rotation={0.4} />
      <Prop scene={scene} name="plant_floor" position={[-2.6, 0, -2.6]} rotation={2.1} scale={0.9} />
      <Prop scene={scene} name="plant_floor" position={[-10.8, 0, -8.2]} rotation={1.2} scale={1.05} />
    </group>
  )
}

export function MeetingRoom() {
  const posture = useAppStore((s) => (s.session?.locationId === 'company' ? s.session.posture : undefined))
  const eye = posture === 'sitting' ? MEETING_EYE.sitting : MEETING_EYE.standing

  return (
    <group>
      {/* A missing texture or prop must never take the whole building down. */}
      <PeopleBoundary fallback={null}>
        <Suspense fallback={null}>
          <Architecture />
        </Suspense>
      </PeopleBoundary>
      <PeopleBoundary fallback={null}>
        <Suspense fallback={null}>
          <Furnishings />
        </Suspense>
      </PeopleBoundary>
      <PeopleBoundary fallback={null}>
        <Suspense fallback={null}>
          <People seats={MEETING_SEATS} lookAt={eye} activeZone="meeting" reportAudience={false} />
        </Suspense>
      </PeopleBoundary>
    </group>
  )
}

useGLTF.preload(PROPS_URL, '/draco/')
