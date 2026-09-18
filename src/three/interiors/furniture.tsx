import { Instance, Instances } from '@react-three/drei'
import { P } from '../palette'

/**
 * Indoor palette, in the app's own colours: the HUD's navy for feature walls
 * and seating, its jade for accents, set against warm oak, walnut, brushed
 * brass and cream so the rooms feel lit by the same golden hour as the city.
 */
export const IN = {
  floor: '#c79d6f',
  /** Navy runner down the circulation route. */
  floorDark: '#1f2c4a',
  wall: '#f4eee5',
  /** Feature walls — the logo wall, framed panels, shelving. */
  wallWarm: '#1c2b4b',
  ceiling: '#fbf7f0',
  panel: '#e8ddcc',
  rug: '#2e4c70',
  deskTop: '#f1e8da',
  screen: '#0f1726',
  seat: '#26365a',
  seatWarm: '#e08a4f',
  /** Brushed brass rather than chrome. */
  chrome: '#b99a5f',
  potGlazed: '#2aa888',
  walnut: '#7a5234',
  jade: '#34d399',
  cream: '#f4eee5',
  /** Exterior facade cladding. */
  cladding: '#16213a',
} as const

export function PottedPlant({
  position,
  scale = 1,
  seed = 0,
}: {
  position: [number, number, number]
  scale?: number
  seed?: number
}) {
  const lobes: [number, number, number][] = [
    [0, 0.92, 0],
    [0.34, 0.68, 0.2],
    [-0.3, 0.72, -0.22],
    [0.1, 1.22, -0.26],
  ]
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.34, 0.26, 0.56, 12]} />
        <meshStandardMaterial color={IN.potGlazed} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.56, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.06, 12]} />
        <meshStandardMaterial color="#4a3b2c" roughness={1} />
      </mesh>
      {lobes.map((l, i) => (
        <mesh key={i} position={l} rotation={[0, (i + seed) * 1.3, i * 0.2]} castShadow>
          <icosahedronGeometry args={[0.42 - i * 0.04, 1]} />
          <meshStandardMaterial color={i % 2 ? P.foliage : P.foliageAlt} roughness={0.9} flatShading />
        </mesh>
      ))}
    </group>
  )
}

/** Five-star task chair. Used in the office and behind the reception desk. */
export function TaskChair({
  position,
  rotation = 0,
  color = IN.seat,
}: {
  position: [number, number, number]
  rotation?: number
  color?: string
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.44, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.52, 0.1, 0.5]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.75, -0.23]} rotation={[-0.14, 0, 0]} castShadow>
        <boxGeometry args={[0.48, 0.56, 0.08]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.36, 8]} />
        <meshStandardMaterial color={IN.chrome} roughness={0.4} metalness={0.6} />
      </mesh>
      <Instances limit={5} castShadow>
        <boxGeometry args={[0.34, 0.05, 0.07]} />
        <meshStandardMaterial color="#3b4046" roughness={0.7} />
        {Array.from({ length: 5 }, (_, i) => {
          const a = (i / 5) * Math.PI * 2
          return (
            <Instance
              key={i}
              position={[Math.cos(a) * 0.17, 0.05, Math.sin(a) * 0.17]}
              rotation={[0, -a, 0]}
            />
          )
        })}
      </Instances>
    </group>
  )
}

/** Meeting/dining style chair with legs rather than a castor base. */
export function SideChair({
  position,
  rotation = 0,
}: {
  position: [number, number, number]
  rotation?: number
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.48, 0.08, 0.46]} />
        <meshStandardMaterial color={IN.seat} roughness={0.82} />
      </mesh>
      <mesh position={[0, 0.76, -0.21]} rotation={[-0.1, 0, 0]} castShadow>
        <boxGeometry args={[0.44, 0.54, 0.07]} />
        <meshStandardMaterial color={IN.seat} roughness={0.82} />
      </mesh>
      <Instances limit={4} castShadow>
        <cylinderGeometry args={[0.026, 0.026, 0.45, 6]} />
        <meshStandardMaterial color={IN.chrome} roughness={0.4} metalness={0.6} />
        {[
          [0.19, 0.18],
          [-0.19, 0.18],
          [0.19, -0.18],
          [-0.19, -0.18],
        ].map(([x, z], i) => (
          <Instance key={i} position={[x, 0.225, z]} />
        ))}
      </Instances>
    </group>
  )
}

/** Desk with a monitor, keyboard and a pedestal. */
export function Desk({
  position,
  rotation = 0,
}: {
  position: [number, number, number]
  rotation?: number
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.2, 0.07, 1.05]} />
        <meshStandardMaterial color={IN.deskTop} roughness={0.6} />
      </mesh>
      <Instances limit={4} castShadow>
        <boxGeometry args={[0.07, 0.74, 0.07]} />
        <meshStandardMaterial color={IN.chrome} roughness={0.45} metalness={0.55} />
        {[
          [1.0, 0.45],
          [-1.0, 0.45],
          [1.0, -0.45],
          [-1.0, -0.45],
        ].map(([x, z], i) => (
          <Instance key={i} position={[x, 0.37, z]} />
        ))}
      </Instances>

      {/* Monitor */}
      <mesh position={[0, 0.82, -0.34]} castShadow>
        <cylinderGeometry args={[0.14, 0.18, 0.04, 12]} />
        <meshStandardMaterial color="#3b4046" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.0, -0.34]} castShadow>
        <boxGeometry args={[0.05, 0.34, 0.05]} />
        <meshStandardMaterial color="#3b4046" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.33, -0.36]} rotation={[0.08, 0, 0]} castShadow>
        <boxGeometry args={[1.14, 0.66, 0.05]} />
        <meshStandardMaterial color="#2c3137" roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.33, -0.325]} rotation={[0.08, 0, 0]}>
        <planeGeometry args={[1.06, 0.58]} />
        <meshStandardMaterial color="#3f7fd8" emissive="#3f7fd8" emissiveIntensity={0.6} roughness={0.4} />
      </mesh>

      {/* Keyboard + notebook */}
      <mesh position={[0, 0.78, 0.12]} castShadow>
        <boxGeometry args={[0.62, 0.02, 0.2]} />
        <meshStandardMaterial color="#d5cec2" roughness={0.7} />
      </mesh>
      <mesh position={[0.72, 0.785, 0.1]} rotation={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[0.3, 0.03, 0.22]} />
        <meshStandardMaterial color={P.fabric} roughness={0.8} />
      </mesh>

      {/* Pedestal */}
      <mesh position={[1.32, 0.33, -0.1]} castShadow receiveShadow>
        <boxGeometry args={[0.5, 0.66, 0.62]} />
        <meshStandardMaterial color={IN.panel} roughness={0.7} />
      </mesh>
    </group>
  )
}
