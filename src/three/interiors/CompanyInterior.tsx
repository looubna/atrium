import { useEffect, useMemo, useRef } from 'react'
import { Instance, Instances } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { DoubleSide, type Group, MathUtils, type MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import { useAppStore, type InteriorZone } from '@/state/useAppStore'
import { P, TV } from '../palette'
import { SkyDome, type SkyColors } from '../environment/SkyDome'
import { SUN } from '../environment/Lighting'
import { Desk, IN, PottedPlant, TaskChair } from './furniture'

/**
 * The Company, ground floor.
 *
 * Plan — the user arrives on the plaza at z = +28 looking toward -z:
 *
 *   z=28  plaza, pass reader beside the doors
 *   z=18  ┃ glazed facade ┃ big sliding doors ┃ navy cladding + canopy above
 *   z=8.6 reception desk, waiting area
 *   z=5   freestanding logo wall (circulation both sides)
 *   z=-2  cross corridor
 *   z=-16 meeting room (x<-2, glass partitions) | open office (x>2)
 *   z=-18 doorway at the end of the corridor
 *   z=-46 auditorium: tiered seats falling to a stage and a big screen
 *
 * Interiors are self-contained: their own lighting, their own outside view, and
 * their camera stations declared in `poses.ts`. That is the whole contract, so
 * any other location can add one without touching the city.
 */

const ACCENT = IN.jade

const W = 16 // half-width
const FRONT = 18 // glazed facade
const BACK = -18
const CEIL = 5.2
/** Half-width and height of the big front doors. */
const DOOR_HALF = 2.6
const DOOR_H = 3.9
/** The auditorium, off the north end of the corridor. */
const HALL_W = 14 // half-width
const HALL_BACK = -46
const HALL_H = 8
const HALL_DOOR_HALF = 2
const HALL_DOOR_H = 3.8

/** Stage front edge, the judging panel's table, and the raked seating behind it. */
const STAGE_EDGE = HALL_BACK + 8
// The panel is the front row of the house: its own table, the same chairs, and
// the tiers rising straight behind it — well back from the stage lip.
// 1.5 m nearer than before: at this distance faces and eyes still read on a phone.
const PANEL_TABLE_Z = -33.4
const PANEL_SEAT_Z = -32.72
const ROWS = 7
const FRONT_ROW_Z = HALL_BACK + 16.1
const ROW_DEPTH = 1.45
// A steep rake, like a real lecture theatre: every row sees over the one in
// front, and from the stage the house fills the view instead of a thin band.
const RISE = 0.62
const SEAT_XS = Array.from({ length: 12 }, (_, i) => 1.9 + i * 0.78).flatMap((x) => [x, -x])
const SEATS = Array.from({ length: ROWS }, (_, row) =>
  SEAT_XS.map((x) => ({ x, y: row * RISE, z: FRONT_ROW_Z + row * ROW_DEPTH, row })),
).flat()

/**
 * The panel's five places at the long desk on stage.
 * Seated close enough together that the whole panel fits a portrait phone.
 */
const PANEL_XS = [-2.4, -1.2, 0, 1.2, 2.4]
/** The chair's nameplate, picked out from the others. */
const GOLD = '#c9a44a'
/** The lectern, and the presenter just behind it: further back on a portrait screen. */
const LECTERN_Z = { wide: HALL_BACK + 6.9, narrow: HALL_BACK + 4.1 }

/** The same golden-hour sky as the city, seen through the glazing. */
const SKY: SkyColors = {
  zenith: TV.skyZenith,
  mid: TV.skyMid,
  horizon: TV.skyHorizon,
  below: TV.backdrop,
  sun: TV.sun,
}

function Shell() {
  const frontGlass = (
    <meshStandardMaterial color={P.skyHorizon} roughness={0.06} metalness={0.1} transparent opacity={0.3} />
  )

  return (
    <group>
      {/* Floor */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <boxGeometry args={[W * 2, 0.2, FRONT - BACK]} />
        <meshStandardMaterial color={IN.floor} roughness={0.6} />
      </mesh>
      {/* Navy runner down the centre of the circulation route */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 2]} receiveShadow>
        <planeGeometry args={[7, 32]} />
        <meshStandardMaterial color={IN.floorDark} roughness={0.4} metalness={0.05} />
      </mesh>

      {/* Ceiling + recessed light panels */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, CEIL, 0]}>
        <planeGeometry args={[W * 2, FRONT - BACK]} />
        <meshStandardMaterial color={IN.ceiling} roughness={0.95} />
      </mesh>
      <Instances limit={24}>
        <boxGeometry args={[3.4, 0.06, 0.5]} />
        <meshStandardMaterial color="#fff1d9" emissive="#ffe8c2" emissiveIntensity={1.2} roughness={0.4} />
        {[-12, -4, 4, 12].flatMap((x) =>
          [-14, -8, -2, 4, 10, 16].map((z) => (
            <Instance key={`${x}:${z}`} position={[x, CEIL - 0.06, z]} />
          )),
        )}
      </Instances>

      {/* West wall — solid, behind the meeting room */}
      <mesh position={[-W, CEIL / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[FRONT - BACK, CEIL]} />
        <meshStandardMaterial color={IN.wall} roughness={0.92} />
      </mesh>
      {/* A pair of navy framed panels with a jade rule, so the wall has something on it */}
      {[-6, -11].map((z) => (
        <group key={z}>
          <mesh position={[-W + 0.06, 2.5, z]} rotation={[0, Math.PI / 2, 0]} castShadow>
            <boxGeometry args={[1.7, 1.2, 0.08]} />
            <meshStandardMaterial color={IN.wallWarm} roughness={0.7} />
          </mesh>
          <mesh position={[-W + 0.11, 2.2, z]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[1.1, 0.06]} />
            <meshStandardMaterial color={IN.jade} emissive={IN.jade} emissiveIntensity={0.5} />
          </mesh>
        </group>
      ))}

      {/* East + north walls — curtain wall, mullions only. The north wall
          leaves an opening onto the auditorium (see <Auditorium>). */}
      <mesh position={[0, (HALL_DOOR_H + CEIL) / 2, BACK]}>
        <planeGeometry args={[HALL_DOOR_HALF * 2, CEIL - HALL_DOOR_H]} />
        <meshStandardMaterial color={P.skyMid} roughness={0.08} metalness={0.1} transparent opacity={0.32} />
      </mesh>
      {(
        [
          { pos: [W, CEIL / 2, 0], rot: [0, -Math.PI / 2, 0], len: FRONT - BACK },
          { pos: [-(HALL_DOOR_HALF + W) / 2, CEIL / 2, BACK], rot: [0, 0, 0], len: W - HALL_DOOR_HALF },
          { pos: [(HALL_DOOR_HALF + W) / 2, CEIL / 2, BACK], rot: [0, 0, 0], len: W - HALL_DOOR_HALF },
        ] as const
      ).map((wall, wi) => (
        <group key={wi}>
          <mesh position={wall.pos as unknown as [number, number, number]} rotation={wall.rot as unknown as [number, number, number]}>
            <planeGeometry args={[wall.len, CEIL]} />
            <meshStandardMaterial
              color={P.skyMid}
              roughness={0.08}
              metalness={0.1}
              transparent
              opacity={0.32}
            />
          </mesh>
        </group>
      ))}
      <Instances limit={20} castShadow>
        <boxGeometry args={[0.14, CEIL, 0.14]} />
        <meshStandardMaterial color={IN.chrome} roughness={0.45} metalness={0.5} />
        {[
          ...[-14, -10, -6, -2, 2, 6, 10, 14].map((z) => [W - 0.1, z] as [number, number]),
          ...[-14, -10, -6, -2, 2, 6, 10, 14].map((x) => [x, BACK + 0.1] as [number, number]),
        ].map(([x, z], i) => (
          <Instance key={i} position={[x, CEIL / 2, z]} />
        ))}
      </Instances>

      {/* Glazed front, split around the big doors (see <Entrance>) */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (DOOR_HALF + (W - DOOR_HALF) / 2), CEIL / 2, FRONT]}>
          <planeGeometry args={[W - DOOR_HALF, CEIL]} />
          {frontGlass}
        </mesh>
      ))}
      <mesh position={[0, (DOOR_H + CEIL) / 2, FRONT]}>
        <planeGeometry args={[DOOR_HALF * 2, CEIL - DOOR_H]} />
        {frontGlass}
      </mesh>
      <Instances limit={8} castShadow>
        <boxGeometry args={[0.16, CEIL, 0.16]} />
        <meshStandardMaterial color={IN.chrome} roughness={0.45} metalness={0.5} />
        {[-14, -10, -6, -3, 3, 6, 10, 14].map((x, i) => (
          <Instance key={i} position={[x, CEIL / 2, FRONT - 0.1]} />
        ))}
      </Instances>

      {/* Skirting, all round — a small thing that makes a room feel built */}
      <Instances limit={4} receiveShadow>
        <boxGeometry args={[1, 0.14, 1]} />
        <meshStandardMaterial color={IN.walnut} roughness={0.7} />
        <Instance position={[-W + 0.06, 0.07, 0]} scale={[0.12, 1, FRONT - BACK]} />
        <Instance position={[W - 0.06, 0.07, 0]} scale={[0.12, 1, FRONT - BACK]} />
        <Instance position={[0, 0.07, BACK + 0.06]} scale={[W * 2, 1, 0.12]} />
        <Instance position={[-(DOOR_HALF + W) / 2, 0.07, FRONT - 0.06]} scale={[W - DOOR_HALF, 1, 0.12]} />
        <Instance position={[(DOOR_HALF + W) / 2, 0.07, FRONT - 0.06]} scale={[W - DOOR_HALF, 1, 0.12]} />
      </Instances>
    </group>
  )
}

/** One glass leaf of the front doors, with a brass frame and a pull handle on its inner edge. */
function DoorLeaf({ inner }: { inner: 1 | -1 }) {
  const w = DOOR_HALF - 0.04
  return (
    <group>
      <mesh position={[0, DOOR_H / 2, 0]}>
        <boxGeometry args={[w, DOOR_H - 0.1, 0.05]} />
        <meshStandardMaterial color="#a9cbe0" roughness={0.04} metalness={0.25} transparent opacity={0.32} />
      </mesh>
      <Instances limit={4} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={IN.chrome} roughness={0.35} metalness={0.7} />
        <Instance position={[-w / 2, DOOR_H / 2, 0]} scale={[0.09, DOOR_H, 0.1]} />
        <Instance position={[w / 2, DOOR_H / 2, 0]} scale={[0.09, DOOR_H, 0.1]} />
        <Instance position={[0, 0.05, 0]} scale={[w, 0.1, 0.1]} />
        <Instance position={[0, DOOR_H - 0.05, 0]} scale={[w, 0.1, 0.1]} />
      </Instances>
      <mesh position={[inner * (w / 2 - 0.28), 1.35, 0.14]} castShadow>
        <boxGeometry args={[0.05, 1.3, 0.05]} />
        <meshStandardMaterial color={IN.chrome} roughness={0.3} metalness={0.8} />
      </mesh>
    </group>
  )
}

/**
 * The front of the building, seen from the arrival station: plaza, navy
 * cladding with the company emblem, a brass portal and canopy, the big doors,
 * and the pass reader. The doors slide apart once the pass is scanned.
 */
function Entrance() {
  const open = useAppStore((s) => s.passScanned)
  const left = useRef<Group>(null)
  const right = useRef<Group>(null)

  useFrame((_, dt) => {
    const slide = open ? DOOR_HALF + 0.1 : 0
    if (left.current) left.current.position.x = MathUtils.damp(left.current.position.x, -slide, 2.6, dt)
    if (right.current) right.current.position.x = MathUtils.damp(right.current.position.x, slide, 2.6, dt)
  })

  const reader = open ? IN.jade : '#4a78ff'

  return (
    <group>
      {/* Plaza */}
      <mesh position={[0, -0.06, FRONT + 11]} receiveShadow>
        <boxGeometry args={[W * 2 + 16, 0.12, 22]} />
        <meshStandardMaterial color="#dccbb3" roughness={0.9} />
      </mesh>
      {/* Navy runner leading to the doors */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, FRONT + 5]} receiveShadow>
        <planeGeometry args={[DOOR_HALF * 2, 10]} />
        <meshStandardMaterial color={IN.floorDark} roughness={0.8} />
      </mesh>

      {/* Cladding band above the glazing, and pilasters at the corners */}
      <mesh position={[0, CEIL + 3.5, FRONT + 0.3]} castShadow receiveShadow>
        <boxGeometry args={[W * 2 + 0.8, 7, 0.6]} />
        <meshStandardMaterial color={IN.cladding} roughness={0.55} metalness={0.2} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (W + 0.1), (CEIL + 7) / 2, FRONT + 0.3]} castShadow receiveShadow>
          <boxGeometry args={[0.8, CEIL + 7, 0.7]} />
          <meshStandardMaterial color={IN.cladding} roughness={0.55} metalness={0.2} />
        </mesh>
      ))}

      {/* Company emblem and wordmark on the cladding — low, just above the
          canopy, so they sit inside the arrival shot rather than above it. */}
      {/* Centred over the doorway: a phone frames little more than the portal. */}
      <mesh position={[-2.1, 6.5, FRONT + 0.64]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.6, 0.6, 0.1, 6]} />
        <meshStandardMaterial color={IN.jade} emissive={IN.jade} emissiveIntensity={0.9} roughness={0.35} />
      </mesh>
      <mesh position={[-2.1, 6.5, FRONT + 0.7]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.1, 6]} />
        <meshStandardMaterial color={IN.cladding} roughness={0.5} />
      </mesh>
      <mesh position={[1.0, 6.72, FRONT + 0.64]}>
        <boxGeometry args={[3.6, 0.34, 0.08]} />
        <meshStandardMaterial color={IN.cream} emissive={IN.cream} emissiveIntensity={0.35} roughness={0.5} />
      </mesh>
      <mesh position={[0.4, 6.22, FRONT + 0.64]}>
        <boxGeometry args={[2.4, 0.2, 0.08]} />
        <meshStandardMaterial color="#8fa6c8" roughness={0.5} />
      </mesh>

      {/* Brass portal around the doors */}
      <mesh position={[0, DOOR_H + 0.25, FRONT + 0.2]} castShadow>
        <boxGeometry args={[DOOR_HALF * 2 + 0.8, 0.5, 0.5]} />
        <meshStandardMaterial color={IN.chrome} roughness={0.35} metalness={0.75} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (DOOR_HALF + 0.2), DOOR_H / 2, FRONT + 0.2]} castShadow>
          <boxGeometry args={[0.4, DOOR_H, 0.5]} />
          <meshStandardMaterial color={IN.chrome} roughness={0.35} metalness={0.75} />
        </mesh>
      ))}

      {/* Canopy over the approach */}
      <mesh position={[0, 4.75, FRONT + 1.7]} castShadow>
        <boxGeometry args={[DOOR_HALF * 2 + 4, 0.24, 3.2]} />
        <meshStandardMaterial color={IN.cladding} roughness={0.5} metalness={0.2} />
      </mesh>

      {/* The doors */}
      <group ref={left}>
        <group position={[-DOOR_HALF / 2, 0, FRONT + 0.06]}>
          <DoorLeaf inner={1} />
        </group>
      </group>
      <group ref={right}>
        <group position={[DOOR_HALF / 2, 0, FRONT + 0.06]}>
          <DoorLeaf inner={-1} />
        </group>
      </group>

      {/* Pass reader: blue while waiting, jade once the pass is accepted */}
      <group position={[DOOR_HALF + 1.5, 0, FRONT + 1.3]}>
        <mesh position={[0, 0.65, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.36, 1.3, 0.3]} />
          <meshStandardMaterial color={IN.cladding} roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position={[0, 1.2, 0.16]} rotation={[-0.35, 0, 0]}>
          <boxGeometry args={[0.26, 0.32, 0.02]} />
          <meshStandardMaterial color={reader} emissive={reader} emissiveIntensity={1.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 1.34, 0]}>
          <boxGeometry args={[0.37, 0.04, 0.31]} />
          <meshStandardMaterial color={reader} emissive={reader} emissiveIntensity={1.2} />
        </mesh>
      </group>

      {/* Planters and bollard lights either side of the approach */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[s * (DOOR_HALF + 4.2), 0.45, FRONT + 2.2]} castShadow receiveShadow>
            <boxGeometry args={[1.8, 0.9, 1.8]} />
            <meshStandardMaterial color={IN.cladding} roughness={0.6} />
          </mesh>
          <PottedPlant position={[s * (DOOR_HALF + 4.2), 0.55, FRONT + 2.2]} scale={1.7} seed={s > 0 ? 3 : 6} />
          {[5, 9].map((dz) => (
            <group key={dz} position={[s * (DOOR_HALF + 0.9), 0, FRONT + dz]}>
              <mesh position={[0, 0.45, 0]} castShadow>
                <cylinderGeometry args={[0.12, 0.14, 0.9, 12]} />
                <meshStandardMaterial color={IN.cladding} roughness={0.5} metalness={0.3} />
              </mesh>
              <mesh position={[0, 0.92, 0]}>
                <cylinderGeometry args={[0.13, 0.13, 0.06, 12]} />
                <meshStandardMaterial color="#ffe2b0" emissive="#ffd9a0" emissiveIntensity={1.6} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  )
}

function Reception() {
  return (
    <group>
      {/* Freestanding logo wall. Deliberately narrow relative to the floor
          plate so the way through is obvious on both sides. */}
      {/* Height matters: a taller backdrop looks good from the door on a wide
          screen but blocks the whole room on a narrow one, where the lens
          cannot step back. 2.5 keeps it a backdrop and keeps the plan legible. */}
      <mesh position={[0, 1.25, 5]} castShadow receiveShadow>
        <boxGeometry args={[9, 2.5, 0.4]} />
        <meshStandardMaterial color={IN.wallWarm} roughness={0.7} />
      </mesh>
      <mesh position={[-2.4, 1.52, 5.22]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.4, 0.4, 0.08, 6]} />
        <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.7} roughness={0.4} />
      </mesh>
      {/* Wordmark stand-in: weighted rules beside the emblem */}
      <mesh position={[-0.3, 1.62, 5.22]}>
        <boxGeometry args={[2.4, 0.13, 0.06]} />
        <meshStandardMaterial color={IN.cream} emissive={IN.cream} emissiveIntensity={0.25} roughness={0.6} />
      </mesh>
      <mesh position={[-0.68, 1.36, 5.22]}>
        <boxGeometry args={[1.64, 0.08, 0.06]} />
        <meshStandardMaterial color="#8fa6c8" roughness={0.6} />
      </mesh>

      {/* Reception desk — counter plus a lower return */}
      <mesh position={[0, 0.55, 8.6]} castShadow receiveShadow>
        <boxGeometry args={[3.7, 1.1, 0.8]} />
        <meshStandardMaterial color={IN.deskTop} roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.14, 8.6]} castShadow>
        <boxGeometry args={[4.1, 0.1, 1.15]} />
        <meshStandardMaterial color={IN.walnut} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.58, 8.21]}>
        <boxGeometry args={[3.72, 0.14, 0.06]} />
        <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[2.55, 0.4, 9.1]} rotation={[0, -0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.8, 0.7]} />
        <meshStandardMaterial color={IN.panel} roughness={0.7} />
      </mesh>
      <TaskChair position={[0, 0, 9.5]} rotation={Math.PI} />
      <PottedPlant position={[-3.5, 0, 7.2]} scale={1} seed={1} />

      {/* Waiting area, tucked against the east glazing */}
      <group position={[10, 0, 12.5]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
          <planeGeometry args={[8, 6]} />
          <meshStandardMaterial color={IN.rug} roughness={0.95} />
        </mesh>
        {/* Sofa */}
        <mesh position={[0, 0.38, -2.1]} castShadow receiveShadow>
          <boxGeometry args={[3.2, 0.42, 0.9]} />
          <meshStandardMaterial color={IN.seat} roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.76, -2.44]} castShadow>
          <boxGeometry args={[3.2, 0.68, 0.26]} />
          <meshStandardMaterial color={IN.seat} roughness={0.85} />
        </mesh>
        <Instances limit={2} castShadow>
          <boxGeometry args={[0.24, 0.58, 0.9]} />
          <meshStandardMaterial color={IN.seat} roughness={0.85} />
          {[-1.48, 1.48].map((x, i) => (
            <Instance key={i} position={[x, 0.5, -2.1]} />
          ))}
        </Instances>
        {/* Coffee table */}
        <mesh position={[0, 0.36, -0.4]} castShadow receiveShadow>
          <cylinderGeometry args={[0.62, 0.62, 0.08, 20]} />
          <meshStandardMaterial color={IN.walnut} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.17, -0.4]} castShadow>
          <cylinderGeometry args={[0.1, 0.14, 0.34, 10]} />
          <meshStandardMaterial color={IN.chrome} roughness={0.4} metalness={0.6} />
        </mesh>
        {/* Two armchairs facing the sofa */}
        {[-1.1, 1.1].map((x) => (
          <group key={x} position={[x, 0, 1.2]} rotation={[0, Math.PI, 0]}>
            <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.86, 0.4, 0.82]} />
              <meshStandardMaterial color={IN.seatWarm} roughness={0.86} />
            </mesh>
            <mesh position={[0, 0.74, -0.31]} castShadow>
              <boxGeometry args={[0.86, 0.62, 0.22]} />
              <meshStandardMaterial color={IN.seatWarm} roughness={0.86} />
            </mesh>
          </group>
        ))}
        <PottedPlant position={[2.6, 0, -1.9]} scale={1.35} seed={4} />
      </group>
    </group>
  )
}

function OpenOffice() {
  return (
    <group>
      <Desk position={[6, 0, -6]} rotation={0} />
      <TaskChair position={[6, 0, -4.6]} rotation={Math.PI} />
      <Desk position={[6, 0, -12]} rotation={0} />
      <TaskChair position={[6, 0, -10.6]} rotation={Math.PI} />
      <Desk position={[12.5, 0, -6]} rotation={0} />
      <TaskChair position={[12.5, 0, -4.6]} rotation={Math.PI} color={IN.seatWarm} />
      <Desk position={[12.5, 0, -12]} rotation={0} />
      <TaskChair position={[12.5, 0, -10.6]} rotation={Math.PI} color={IN.seatWarm} />

      {/* Low divider between the desk rows */}
      <mesh position={[9.2, 0.6, -9]} castShadow receiveShadow>
        <boxGeometry args={[0.18, 1.2, 12]} />
        <meshStandardMaterial color={IN.potGlazed} roughness={0.8} />
      </mesh>

      {/* Shelving against the corridor edge */}
      <mesh position={[2.9, 1, -13]} castShadow receiveShadow>
        <boxGeometry args={[0.5, 2, 4.4]} />
        <meshStandardMaterial color={IN.wallWarm} roughness={0.75} />
      </mesh>
      <Instances limit={9}>
        <boxGeometry args={[0.34, 0.3, 0.18]} />
        <meshStandardMaterial roughness={0.85} />
        {[0, 1, 2].flatMap((r) =>
          [-1.2, 0, 1.2].map((z, i) => (
            <Instance
              key={`${r}:${z}`}
              position={[2.9, 0.55 + r * 0.62, -13 + z]}
              color={[IN.seatWarm, IN.cream, IN.jade][(r + i) % 3]}
            />
          )),
        )}
      </Instances>

      {/* Kept out of the approach sightline — a plant at the corridor mouth
          reads as a wall from the office camera station. */}
      <PottedPlant position={[14.8, 0, -4.2]} scale={1.15} seed={2} />
      <PottedPlant position={[14.6, 0, -15.6]} scale={1.1} seed={5} />
    </group>
  )
}

/** Raked seating: seven rows rising toward the back, a centre aisle. */
function Seating() {
  const seats = SEATS

  return (
    <group>
      {/* Risers */}
      {Array.from({ length: ROWS - 1 }, (_, i) => i + 1).map((r) => (
        <mesh key={r} position={[0, (r * RISE) / 2, FRONT_ROW_Z + r * ROW_DEPTH]} castShadow receiveShadow>
          <boxGeometry args={[HALL_W * 2 - 0.4, r * RISE, ROW_DEPTH]} />
          <meshStandardMaterial color={IN.rug} roughness={0.95} />
        </mesh>
      ))}
      {/* Seat cushions and backs — the seats face the stage (-z) */}
      <Instances limit={seats.length} castShadow receiveShadow>
        <boxGeometry args={[0.62, 0.16, 0.55]} />
        <meshStandardMaterial color={IN.seatWarm} roughness={0.85} />
        {seats.map((s, i) => (
          <Instance key={i} position={[s.x, s.y + 0.45, s.z]} />
        ))}
      </Instances>
      <Instances limit={seats.length} castShadow>
        <boxGeometry args={[0.62, 0.62, 0.1]} />
        <meshStandardMaterial color={IN.seatWarm} roughness={0.85} />
        {seats.map((s, i) => (
          <Instance key={i} position={[s.x, s.y + 0.82, s.z + 0.27]} />
        ))}
      </Instances>
    </group>
  )
}

type V3 = [number, number, number]

/** A cylinder stretched between two points. */
function Tube({ a, b, r, color, metalness = 0.8 }: { a: V3; b: V3; r: number; color: string; metalness?: number }) {
  const { position, quaternion, length } = useMemo(() => {
    const va = new Vector3(...a)
    const d = new Vector3(...b).sub(va)
    return {
      position: va.clone().addScaledVector(d, 0.5),
      quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.clone().normalize()),
      length: d.length(),
    }
  }, [a, b])
  return (
    <mesh position={position} quaternion={quaternion} castShadow>
      <cylinderGeometry args={[r, r, length, 10]} />
      <meshStandardMaterial color={color} roughness={0.35} metalness={metalness} />
    </mesh>
  )
}

/** Gooseneck from the lectern top, curving up and back toward the presenter's mouth (lectern-local). */
const MIC_NECK: V3[] = [
  [-0.3, 1.125, 0.15],
  [-0.3, 1.24, 0.12],
  [-0.31, 1.32, 0.02],
  [-0.33, 1.34, -0.12],
  [-0.35, 1.34, -0.2],
]
const MIC_AIM = new Vector3(-0.18, 0, -0.98).normalize()
const MIC_START = new Vector3(...MIC_NECK[MIC_NECK.length - 1])
const MIC_END = MIC_START.clone().addScaledVector(MIC_AIM, 0.11)
const MIC_LED_Q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), MIC_AIM)

/**
 * The lectern microphone. Its tally ring is dark while the mic is closed, jade
 * while it listens, and pulses while the presenter is speaking.
 */
function Microphone() {
  const led = useRef<MeshStandardMaterial>(null)

  useFrame((state) => {
    const m = led.current
    if (!m) return
    const mic = useAppStore.getState().micState
    const c = mic === 'off' ? '#4a2626' : IN.jade
    m.color.set(c)
    m.emissive.set(c)
    m.emissiveIntensity = mic === 'off' ? 0.25 : mic === 'speaking' ? 2.4 + 0.9 * Math.sin(state.clock.elapsedTime * 14) : 1.2
  })

  return (
    <group>
      <mesh position={[-0.3, 1.125, 0.15]} rotation={[-0.3, 0, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.05, 0.02, 20]} />
        <meshStandardMaterial color="#1b1d22" roughness={0.4} metalness={0.6} />
      </mesh>
      {MIC_NECK.slice(1).map((p, i) => (
        <Tube key={i} a={MIC_NECK[i]} b={p} r={0.009} color="#2a2c31" />
      ))}
      <Tube a={MIC_START.toArray() as V3} b={MIC_END.toArray() as V3} r={0.017} color="#1b1d22" metalness={0.6} />
      <mesh position={MIC_START.clone().addScaledVector(MIC_AIM, 0.022)} quaternion={MIC_LED_Q}>
        <torusGeometry args={[0.019, 0.004, 8, 24]} />
        <meshStandardMaterial ref={led} color="#4a2626" emissive="#4a2626" emissiveIntensity={0.25} />
      </mesh>
      <mesh position={MIC_END} castShadow>
        <sphereGeometry args={[0.024, 16, 12]} />
        <meshStandardMaterial color="#15161a" roughness={0.95} />
      </mesh>
    </group>
  )
}

/**
 * The judges' table between the stage and the front row: name plates facing
 * the presenter, laptops, notepads and water. The chair's place is gold.
 */
function PanelTable() {
  return (
    <group>
      <mesh position={[0, 0.76, PANEL_TABLE_Z]} castShadow receiveShadow>
        <boxGeometry args={[6.6, 0.06, 0.8]} />
        <meshStandardMaterial color={IN.walnut} roughness={0.45} />
      </mesh>
      {/* Modesty panel toward the stage, with a jade rule */}
      <mesh position={[0, 0.38, PANEL_TABLE_Z - 0.38]} castShadow receiveShadow>
        <boxGeometry args={[6.6, 0.72, 0.05]} />
        <meshStandardMaterial color={IN.cladding} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.62, PANEL_TABLE_Z - 0.415]}>
        <boxGeometry args={[6.6, 0.04, 0.02]} />
        <meshStandardMaterial color={IN.jade} emissive={IN.jade} emissiveIntensity={1} />
      </mesh>

      {PANEL_XS.map((x, i) => {
        const chair = i === 2
        const plate = chair ? GOLD : IN.cream
        return (
          <group key={x}>
            {/* Name plate, facing the presenter */}
            <mesh position={[x, 0.86, PANEL_TABLE_Z - 0.3]} rotation={[-0.25, 0, 0]} castShadow>
              <boxGeometry args={[0.55, 0.14, 0.04]} />
              <meshStandardMaterial color={plate} roughness={0.4} metalness={chair ? 0.6 : 0} />
            </mesh>
            <mesh position={[x, 0.865, PANEL_TABLE_Z - 0.325]} rotation={[-0.25, 0, 0]}>
              <boxGeometry args={[0.36, 0.035, 0.005]} />
              <meshStandardMaterial color={IN.cladding} />
            </mesh>
            {/* Laptop: screen toward the panelist, glowing mark toward the stage */}
            <mesh position={[x + 0.38, 0.8, PANEL_TABLE_Z + 0.02]} castShadow>
              <boxGeometry args={[0.36, 0.02, 0.26]} />
              <meshStandardMaterial color="#9aa1ab" roughness={0.35} metalness={0.6} />
            </mesh>
            <mesh position={[x + 0.38, 0.92, PANEL_TABLE_Z - 0.12]} rotation={[-0.25, 0, 0]} castShadow>
              <boxGeometry args={[0.36, 0.24, 0.015]} />
              <meshStandardMaterial color="#9aa1ab" roughness={0.35} metalness={0.6} />
            </mesh>
            <mesh position={[x + 0.38, 0.93, PANEL_TABLE_Z - 0.13]} rotation={[-0.25, 0, 0]}>
              <circleGeometry args={[0.03, 12]} />
              <meshStandardMaterial color={IN.jade} emissive={IN.jade} emissiveIntensity={1.4} side={DoubleSide} />
            </mesh>
            {/* Notepad and water */}
            <mesh position={[x - 0.22, 0.795, PANEL_TABLE_Z + 0.12]} rotation={[0, 0.15, 0]} castShadow>
              <boxGeometry args={[0.22, 0.012, 0.3]} />
              <meshStandardMaterial color={IN.cream} roughness={0.8} />
            </mesh>
            <mesh position={[x - 0.55, 0.85, PANEL_TABLE_Z - 0.05]} castShadow>
              <cylinderGeometry args={[0.04, 0.035, 0.13, 10]} />
              <meshStandardMaterial color="#cfe6f2" roughness={0.05} transparent opacity={0.55} />
            </mesh>
            {/* The same seats as the house, so the panel reads as its front row;
                the chair of the panel only gets a slightly taller back. */}
            <mesh position={[x, 0.43, PANEL_SEAT_Z + 0.02]} castShadow receiveShadow>
              <boxGeometry args={[0.62, 0.16, 0.55]} />
              <meshStandardMaterial color={IN.seatWarm} roughness={0.85} />
            </mesh>
            <mesh position={[x, chair ? 0.9 : 0.8, PANEL_SEAT_Z + 0.29]} castShadow>
              <boxGeometry args={[0.62, chair ? 0.86 : 0.62, 0.1]} />
              <meshStandardMaterial color={IN.seatWarm} roughness={0.85} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/**
 * The auditorium for large-audience presentations: a navy hall behind the
 * corridor, raked seating, a walnut stage with a lectern, and a big screen
 * showing the title slide.
 */
function Auditorium() {
  // Portrait screens put the presenter further back (see poses.ts); the lectern follows.
  const narrow = useThree((s) => s.size.width / Math.max(1, s.size.height) < 1.05)
  const depth = BACK - HALL_BACK
  const midZ = (BACK + HALL_BACK) / 2
  const navy = <meshStandardMaterial color={IN.wallWarm} roughness={0.85} />
  const warmLight = <meshStandardMaterial color="#fff1d9" emissive="#ffe2b0" emissiveIntensity={1.6} roughness={0.4} />

  return (
    <group>
      {/* Carpeted floor and dark ceiling */}
      <mesh position={[0, -0.1, midZ]} receiveShadow>
        <boxGeometry args={[HALL_W * 2, 0.2, depth]} />
        <meshStandardMaterial color={IN.rug} roughness={0.95} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, HALL_H, midZ]}>
        <planeGeometry args={[HALL_W * 2, depth]} />
        <meshStandardMaterial color={IN.cladding} roughness={0.9} />
      </mesh>
      <Instances limit={15}>
        <cylinderGeometry args={[0.35, 0.35, 0.06, 16]} />
        {warmLight}
        {[-8, 0, 8].flatMap((x) =>
          [-22, -27, -32, -37, -42].map((z) => <Instance key={`${x}:${z}`} position={[x, HALL_H - 0.04, z]} />),
        )}
      </Instances>

      {/* Side walls with warm sconces */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[s * HALL_W, HALL_H / 2, midZ]} rotation={[0, -s * (Math.PI / 2), 0]} receiveShadow>
            <planeGeometry args={[depth, HALL_H]} />
            <meshStandardMaterial color={IN.wallWarm} roughness={0.85} side={DoubleSide} />
          </mesh>
          <Instances limit={4}>
            <boxGeometry args={[0.1, 0.9, 0.3]} />
            {warmLight}
            {[-24, -30, -36, -42].map((z) => (
              <Instance key={z} position={[s * (HALL_W - 0.08), 3.2, z]} />
            ))}
          </Instances>
        </group>
      ))}

      {/* Back wall, and the wall toward the lobby with its doorway */}
      <mesh position={[0, HALL_H / 2, HALL_BACK]}>
        <planeGeometry args={[HALL_W * 2, HALL_H]} />
        <meshStandardMaterial color={IN.cladding} roughness={0.85} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * (HALL_DOOR_HALF + (HALL_W - HALL_DOOR_HALF) / 2), HALL_H / 2, BACK - 0.12]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[HALL_W - HALL_DOOR_HALF, HALL_H, 0.2]} />
          {navy}
        </mesh>
      ))}
      <mesh position={[0, (HALL_DOOR_H + HALL_H) / 2, BACK - 0.12]}>
        <boxGeometry args={[HALL_DOOR_HALF * 2, HALL_H - HALL_DOOR_H, 0.2]} />
        {navy}
      </mesh>

      {/* Brass portal and sign on the lobby side of the doorway */}
      <mesh position={[0, HALL_DOOR_H + 0.1, BACK + 0.06]} castShadow>
        <boxGeometry args={[HALL_DOOR_HALF * 2 + 0.5, 0.2, 0.2]} />
        <meshStandardMaterial color={IN.chrome} roughness={0.35} metalness={0.75} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (HALL_DOOR_HALF + 0.12), HALL_DOOR_H / 2, BACK + 0.06]} castShadow>
          <boxGeometry args={[0.24, HALL_DOOR_H, 0.2]} />
          <meshStandardMaterial color={IN.chrome} roughness={0.35} metalness={0.75} />
        </mesh>
      ))}
      <mesh position={[0, HALL_DOOR_H + 0.55, BACK + 0.12]}>
        <boxGeometry args={[2.6, 0.24, 0.05]} />
        <meshStandardMaterial color={IN.cream} emissive={IN.cream} emissiveIntensity={0.5} />
      </mesh>

      {/* What the presenter looks at over the back row: the company's lit sign
          and warm wall washers, rather than a dark void. */}
      <group position={[0, 6.35, BACK - 0.24]} rotation={[0, Math.PI, 0]}>
        <mesh position={[-1.9, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.46, 0.46, 0.08, 6]} />
          <meshStandardMaterial color={IN.jade} emissive={IN.jade} emissiveIntensity={1.4} />
        </mesh>
        <mesh position={[-1.9, 0, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.17, 0.17, 0.08, 6]} />
          <meshStandardMaterial color={IN.cladding} roughness={0.5} />
        </mesh>
        <mesh position={[0.6, 0.14, 0]}>
          <boxGeometry args={[3.4, 0.3, 0.05]} />
          <meshStandardMaterial color={IN.cream} emissive={IN.cream} emissiveIntensity={0.9} />
        </mesh>
        <mesh position={[0.05, -0.28, 0]}>
          <boxGeometry args={[2.3, 0.14, 0.05]} />
          <meshStandardMaterial color="#8fa6c8" emissive="#8fa6c8" emissiveIntensity={0.6} />
        </mesh>
      </group>
      {[-9, 9].map((x) => (
        <group key={x} position={[x, 5.6, BACK - 0.3]}>
          <mesh>
            <boxGeometry args={[2.4, 1.6, 0.08]} />
            <meshStandardMaterial color={IN.walnut} roughness={0.6} />
          </mesh>
          <pointLight position={[0, 1.2, -0.6]} intensity={4} distance={4} decay={1.6} color="#ffd9a8" />
        </group>
      ))}

      <Seating />
      <PanelTable />
      {/* The house is dressed and empty. People in this app are real footage and live faces,
          never 3D stand-ins: an audience is the footage in `public/video/theater`. */}

      {/* Stage with a jade lip light */}
      <mesh position={[0, 0.45, HALL_BACK + 4]} castShadow receiveShadow>
        <boxGeometry args={[20, 0.9, 8]} />
        <meshStandardMaterial color={IN.walnut} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.2, STAGE_EDGE + 0.04]}>
        <boxGeometry args={[20, 0.06, 0.06]} />
        <meshStandardMaterial color={IN.jade} emissive={IN.jade} emissiveIntensity={1.2} />
      </mesh>

      {/* Big screen with a title slide */}
      <mesh position={[0, 4.9, HALL_BACK + 0.15]} castShadow>
        <boxGeometry args={[13, 6.8, 0.2]} />
        <meshStandardMaterial color={IN.screen} roughness={0.5} />
      </mesh>
      <mesh position={[0, 4.9, HALL_BACK + 0.27]}>
        <planeGeometry args={[12.4, 6.2]} />
        <meshStandardMaterial color="#1d3f6e" emissive="#1d3f6e" emissiveIntensity={0.85} roughness={0.4} />
      </mesh>
      <mesh position={[-2, 6.6, HALL_BACK + 0.29]}>
        <planeGeometry args={[6.5, 0.55]} />
        <meshStandardMaterial color={IN.cream} emissive={IN.cream} emissiveIntensity={0.9} />
      </mesh>
      <mesh position={[-3.2, 5.8, HALL_BACK + 0.29]}>
        <planeGeometry args={[4, 0.2]} />
        <meshStandardMaterial color={IN.jade} emissive={IN.jade} emissiveIntensity={1} />
      </mesh>
      {[0.9, 1.6, 1.2, 2.2].map((h, i) => (
        <mesh key={i} position={[2.2 + i * 1.1, 2.3 + h / 2, HALL_BACK + 0.29]}>
          <planeGeometry args={[0.7, h]} />
          <meshStandardMaterial
            color={i === 3 ? IN.jade : '#7d9cc6'}
            emissive={i === 3 ? IN.jade : '#7d9cc6'}
            emissiveIntensity={0.8}
          />
        </mesh>
      ))}

      {/* Lectern, right in front of the presenter: its slanted top, notes and
          microphone sit at the bottom of the presenter's view. */}
      {/* +x reads as the left of the presenter's view (they face the house).
          Kept low enough that its top never hides a panelist's face. */}
      <group position={[0.55, 0.9, narrow ? LECTERN_Z.narrow : LECTERN_Z.wide]}>
        <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.9, 1.0, 0.6]} />
          <meshStandardMaterial color={IN.walnut} roughness={0.45} />
        </mesh>
        {/* Reading surface, tilted toward the presenter */}
        <mesh position={[0, 1.04, 0]} rotation={[-0.3, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.0, 0.06, 0.7]} />
          <meshStandardMaterial color={IN.cladding} roughness={0.5} />
        </mesh>
        <mesh position={[0.05, 1.075, -0.05]} rotation={[-0.3, 0.08, 0]}>
          <boxGeometry args={[0.3, 0.004, 0.4]} />
          <meshStandardMaterial color={IN.cream} roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.6, 0.31]}>
          <boxGeometry args={[0.6, 0.06, 0.02]} />
          <meshStandardMaterial color={IN.jade} emissive={IN.jade} emissiveIntensity={1} />
        </mesh>
        <Microphone />
      </group>

      {/* Warm wash on the stage, the panel's faces, and the house */}
      <pointLight position={[0, 6, HALL_BACK + 9]} intensity={40} distance={26} decay={1.6} color="#ffe2b8" />
      <pointLight position={[0, 3.6, STAGE_EDGE + 0.6]} intensity={10} distance={9} decay={1.6} color="#fff0dc" />
      <pointLight position={[0, 6.5, -27]} intensity={34} distance={24} decay={1.6} color="#ffe6c4" />
      {/* Soft front light on the faces of the panel and the first rows, from
          just below the stage lip — where the presenter sees them from. */}
      <pointLight position={[0, 2.3, STAGE_EDGE + 1.2]} intensity={28} distance={16} decay={1.5} color="#fff1e2" />
      <pointLight position={[-5, 3, -35]} intensity={14} distance={12} decay={1.5} color="#fff1e2" />
      <pointLight position={[5, 3, -35]} intensity={14} distance={12} decay={1.5} color="#fff1e2" />
    </group>
  )
}

/** Clickable floor pads so the rooms themselves are navigable, not just the HUD. */
function ZonePads() {
  const setZone = useAppStore((s) => s.setInteriorZone)
  const active = useAppStore((s) => s.interiorZone)

  const pads: { id: InteriorZone; pos: [number, number, number]; size: [number, number] }[] = [
    { id: 'reception', pos: [0, 0.02, 11], size: [22, 12] },
    { id: 'meeting', pos: [-6.7, 0.02, -5.4], size: [9.4, 6.8] },
    { id: 'office', pos: [9.5, 0.02, -9], size: [13, 14] },
    { id: 'theater', pos: [0, 0.02, -32], size: [26, 26] },
  ]

  return (
    <group>
      {pads.map((p) => (
        <mesh
          key={p.id}
          visible={false}
          position={p.pos}
          rotation={[-Math.PI / 2, 0, 0]}
          onClick={(e) => {
            e.stopPropagation()
            if (active !== p.id) setZone(p.id)
          }}
          onPointerOver={(e) => {
            e.stopPropagation()
            document.body.style.cursor = 'pointer'
          }}
          onPointerOut={() => {
            document.body.style.cursor = ''
          }}
        >
          <planeGeometry args={p.size} />
        </mesh>
      ))}
    </group>
  )
}

/** Distant massing outside the glazing, so the windows look onto something. */
function OutsideView() {
  const blocks: [number, number, number, number][] = [
    [-40, 12, -52, 16],
    [-10, 20, -64, 22],
    [22, 15, -58, 18],
    [48, 26, -70, 24],
    [40, 10, -30, 14],
    [44, 18, 8, 20],
    [50, 12, 34, 16],
    [-56, 16, -30, 18],
  ]
  return (
    <Instances limit={blocks.length}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#c7a88a" roughness={0.9} />
      {blocks.map(([x, h, z, w], i) => (
        <Instance key={i} position={[x, h / 2, z]} scale={[w, h, w * 0.8]} />
      ))}
    </Instances>
  )
}

export default function CompanyInterior() {
  const ready = useAppStore((s) => s.interiorReady)

  // Tell the app the room is built so the veil can lift.
  useEffect(() => {
    const id = requestAnimationFrame(() => ready())
    return () => cancelAnimationFrame(id)
  }, [ready])

  return (
    <group>
      <SkyDome sun={SUN} colors={SKY} />
      <OutsideView />
      {/* Ground outside, visible through the glass at floor level */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.25, 0]}>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color={P.pavement} roughness={1} />
      </mesh>

      {/* Interior lighting: warm ambience plus one shadow-casting golden-hour
          sun through the entrance glazing. A tight frustum keeps the shadows
          crisp. */}
      {/* Downward-facing surfaces (the whole ceiling) only ever see the
          hemisphere light's ground colour, so without an ambient fill the
          ceiling renders the colour of the floor. */}
      <ambientLight intensity={0.7} color="#fff4e6" />
      <hemisphereLight args={['#fff1dd', '#c8a27a', 1.0]} />
      <directionalLight
        position={[14, 16, 26]}
        intensity={1.7}
        color="#ffd09a"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
      />
      <directionalLight position={[-10, 12, -24]} intensity={0.45} color={TV.fill} />

      <Shell />
      <Entrance />
      <Reception />
      <OpenOffice />
      <Auditorium />
      <ZonePads />
    </group>
  )
}
