import { useMemo } from 'react'
import { Instance, Instances } from '@react-three/drei'
import { rand, randRange } from '@/lib/utils'
import { GRID } from '@/three/city/grid'
import { P } from '@/three/palette'
import { Doorway, Gable, Planters, Plot, Windows } from '../parts'
import type { ShapeProps } from './Civic'

const B = GRID.curb

/* ------------------------------------------------------------------ */
/* Home — a two-storey house with a garden and a fence.                */
/* ------------------------------------------------------------------ */
export function House({ accent }: ShapeProps) {
  const fence = useMemo(() => {
    const out: [number, number, number][] = []
    for (let x = -8.5; x <= 8.5; x += 1.3) {
      if (Math.abs(x) < 3) continue
      out.push([x, 0, 7.6])
    }
    for (let z = -6; z <= 7.6; z += 1.3) {
      out.push([-8.5, 0, z])
      out.push([8.5, 0, z])
    }
    return out
  }, [])

  return (
    <group>
      <Plot width={18} depth={16} pathTo={8} pathWidth={2.6} />

      {/* Body + pitched roof */}
      <mesh position={[0, B + 3.4, -1]} castShadow receiveShadow>
        <boxGeometry args={[11, 6.8, 9]} />
        <meshStandardMaterial color={P.stoneLight} roughness={0.88} />
      </mesh>
      <Gable halfWidth={5.9} height={3.4} depth={9.8} position={[0, B + 6.8, -1]} color={P.roofWarm} />

      {/* Chimney */}
      <mesh position={[3.4, B + 10.2, -3.4]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 3.4, 1.2]} />
        <meshStandardMaterial color={P.brickDeep} roughness={0.92} />
      </mesh>

      {/* Windows: two up, two down, warmly lit */}
      <Windows width={8} height={0} rows={1} cols={2} y={B + 2.4} z={3.6} pane={[2, 2.2]} color={P.glassLit} lit={1} />
      <Windows width={8} height={0} rows={1} cols={2} y={B + 5.6} z={3.6} pane={[1.8, 1.8]} color={P.glassLit} lit={1} />

      {/* Porch */}
      <group position={[0, B, 0]}>
        <Doorway width={1.8} height={2.9} z={3.5} accent={accent} />
        <mesh position={[0, 3.3, 4.6]} castShadow>
          <boxGeometry args={[4.4, 0.3, 2.6]} />
          <meshStandardMaterial color={P.trim} roughness={0.75} />
        </mesh>
        <Instances limit={2} castShadow>
          <boxGeometry args={[0.22, 3.2, 0.22]} />
          <meshStandardMaterial color={P.trim} roughness={0.75} />
          {[-1.9, 1.9].map((x, i) => (
            <Instance key={i} position={[x, 1.6, 5.6]} />
          ))}
        </Instances>
        <Planters points={[[-2.9, 5.2], [2.9, 5.2]]} y={0} />
      </group>

      {/* Picket fence */}
      <Instances limit={fence.length} castShadow>
        <boxGeometry args={[0.16, 1.5, 0.16]} />
        <meshStandardMaterial color={P.trim} roughness={0.85} />
        {fence.map((p, i) => (
          <Instance key={i} position={[p[0], B + 0.75, p[2]]} />
        ))}
      </Instances>

      {/* Garden tree */}
      <mesh position={[-5.6, B + 2, 4.4]} castShadow>
        <cylinderGeometry args={[0.24, 0.32, 4, 6]} />
        <meshStandardMaterial color={P.trunk} roughness={0.95} />
      </mesh>
      <mesh position={[-5.6, B + 5.6, 4.4]} castShadow>
        <icosahedronGeometry args={[2.3, 1]} />
        <meshStandardMaterial color={P.foliage} roughness={0.9} flatShading />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Bus stop — shelter, bench, timetable, flag.                         */
/* ------------------------------------------------------------------ */
export function BusStop({ accent }: ShapeProps) {
  return (
    <group position={[0, B, 0]}>
      {/* Glass back and side panels */}
      <mesh position={[0, 1.7, -1.4]} castShadow receiveShadow>
        <boxGeometry args={[7.4, 3.4, 0.12]} />
        <meshStandardMaterial color={P.glass} roughness={0.08} metalness={0.2} transparent opacity={0.55} />
      </mesh>
      <Instances limit={2} castShadow>
        <boxGeometry args={[0.12, 3.4, 2.6]} />
        <meshStandardMaterial color={P.glass} roughness={0.08} metalness={0.2} transparent opacity={0.5} />
        {[-3.7, 3.7].map((x, i) => (
          <Instance key={i} position={[x, 1.7, -0.2]} />
        ))}
      </Instances>

      {/* Posts + roof */}
      <Instances limit={4} castShadow>
        <boxGeometry args={[0.16, 3.6, 0.16]} />
        <meshStandardMaterial color={P.metalDark} roughness={0.5} metalness={0.6} />
        {[
          [-3.7, -1.4],
          [3.7, -1.4],
          [-3.7, 1.1],
          [3.7, 1.1],
        ].map(([x, z], i) => (
          <Instance key={i} position={[x, 1.8, z]} />
        ))}
      </Instances>
      <mesh position={[0, 3.7, -0.2]} castShadow>
        <boxGeometry args={[8, 0.22, 3.2]} />
        <meshStandardMaterial color={P.metalDark} roughness={0.5} metalness={0.5} />
      </mesh>

      {/* Bench */}
      <mesh position={[0, 0.95, -1]} castShadow receiveShadow>
        <boxGeometry args={[5.4, 0.14, 0.7]} />
        <meshStandardMaterial color={P.wood} roughness={0.85} />
      </mesh>

      {/* Lit timetable panel */}
      <mesh position={[2.6, 1.9, -1.28]}>
        <boxGeometry args={[1.4, 2, 0.08]} />
        <meshStandardMaterial color={P.glassLit} emissive={P.glassLit} emissiveIntensity={0.5} roughness={0.3} />
      </mesh>

      {/* Flag pole and sign disc */}
      <mesh position={[4.6, 2.2, 1]} castShadow>
        <cylinderGeometry args={[0.09, 0.09, 4.4, 6]} />
        <meshStandardMaterial color={P.metal} roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh position={[4.6, 4.3, 1]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.85, 0.85, 0.14, 18]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.45} roughness={0.4} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Park — the only "location" that is grounds rather than a building.  */
/* A pavilion marks the entrance so there is still something to enter. */
/* ------------------------------------------------------------------ */
export function Park({ accent }: ShapeProps) {
  const { trees, lamps } = useMemo(() => {
    const trees: { p: [number, number, number]; s: number; rot: number }[] = []
    const lamps: [number, number][] = []

    // Scattered but kept clear of the pond, the path and the pavilion.
    for (let i = 0; i < 26; i++) {
      const x = randRange(i * 3 + 1, -18, 18)
      const z = randRange(i * 3 + 2, -13, 13)
      const nearPond = Math.hypot(x - 8, z + 4) < 8
      const nearPath = Math.abs(x) < 3.4
      const nearPavilion = Math.hypot(x + 9, z - 5) < 7
      if (nearPond || nearPath || nearPavilion) continue
      trees.push({ p: [x, 0, z], s: randRange(i * 7, 2.2, 3.6), rot: rand(i) * 6 })
    }
    for (let z = -11; z <= 11; z += 5.5) {
      lamps.push([3.9, z])
    }
    return { trees, lamps }
  }, [])

  return (
    <group>
      {/* Lawn */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, B + 0.02, 0]} receiveShadow>
        <planeGeometry args={[40, 30]} />
        <meshStandardMaterial color={P.grass} roughness={1} />
      </mesh>

      {/* Path in from the gate */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, B + 0.04, 2]} receiveShadow>
        <planeGeometry args={[5, 30]} />
        <meshStandardMaterial color={P.pavement} roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-6, B + 0.04, 5]} receiveShadow>
        <planeGeometry args={[16, 4.4]} />
        <meshStandardMaterial color={P.pavement} roughness={0.95} />
      </mesh>

      {/* Pond */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[8, B + 0.05, -4]} receiveShadow>
        <circleGeometry args={[6.4, 34]} />
        <meshStandardMaterial color={P.water} roughness={0.06} metalness={0.55} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[8, B + 0.045, -4]} receiveShadow>
        <ringGeometry args={[6.4, 7.4, 34]} />
        <meshStandardMaterial color={P.pavementEdge} roughness={0.95} />
      </mesh>

      {/* Entrance gate — piers and a sign beam */}
      <group position={[0, B, 13.4]}>
        <Instances limit={2} castShadow receiveShadow>
          <boxGeometry args={[1.4, 5, 1.4]} />
          <meshStandardMaterial color={P.stoneDeep} roughness={0.9} />
          {[-3.6, 3.6].map((x, i) => (
            <Instance key={i} position={[x, 2.5, 0]} />
          ))}
        </Instances>
        <mesh position={[0, 5.2, 0]} castShadow>
          <boxGeometry args={[8.6, 0.5, 0.6]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.28} roughness={0.45} />
        </mesh>
      </group>

      {/* Pavilion — a bandstand, and the thing the camera approaches */}
      <group position={[-9, B, 5]}>
        <mesh position={[0, 0.2, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[4.6, 4.9, 0.4, 12]} />
          <meshStandardMaterial color={P.pavement} roughness={0.92} />
        </mesh>
        <Instances limit={6} castShadow>
          <cylinderGeometry args={[0.18, 0.2, 3.6, 8]} />
          <meshStandardMaterial color={P.trim} roughness={0.8} />
          {Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2
            return <Instance key={i} position={[Math.cos(a) * 3.8, 2.2, Math.sin(a) * 3.8]} />
          })}
        </Instances>
        <mesh position={[0, 4.3, 0]} castShadow receiveShadow>
          <coneGeometry args={[5.2, 1.8, 12]} />
          <meshStandardMaterial color={P.roofWarm} roughness={0.86} flatShading />
        </mesh>
      </group>

      {/* Trees */}
      <Instances limit={trees.length} castShadow receiveShadow>
        <cylinderGeometry args={[0.26, 0.36, 3.6, 6]} />
        <meshStandardMaterial color={P.trunk} roughness={0.95} />
        {trees.map((t, i) => (
          <Instance key={i} position={[t.p[0], B + 1.8, t.p[2]]} />
        ))}
      </Instances>
      <Instances limit={trees.length} castShadow>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color={P.foliage} roughness={0.9} flatShading />
        {trees.map((t, i) => (
          <Instance
            key={i}
            position={[t.p[0], B + 3.6 + t.s * 0.6, t.p[2]]}
            scale={[t.s, t.s * 0.9, t.s]}
            rotation={[0, t.rot, 0]}
          />
        ))}
      </Instances>

      {/* Path lamps */}
      <Instances limit={lamps.length} castShadow>
        <cylinderGeometry args={[0.09, 0.13, 4.4, 6]} />
        <meshStandardMaterial color={P.metalDark} roughness={0.55} metalness={0.5} />
        {lamps.map((l, i) => (
          <Instance key={i} position={[l[0], B + 2.2, l[1]]} />
        ))}
      </Instances>
      <Instances limit={lamps.length}>
        <sphereGeometry args={[0.42, 12, 8]} />
        <meshStandardMaterial color={P.glassLit} emissive={P.glassLit} emissiveIntensity={0.8} roughness={0.3} />
        {lamps.map((l, i) => (
          <Instance key={i} position={[l[0], B + 4.6, l[1]]} />
        ))}
      </Instances>

      {/* Benches along the path */}
      <Instances limit={4} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.15, 0.7]} />
        <meshStandardMaterial color={P.wood} roughness={0.85} />
        {[-8, -2, 4, 10].map((z, i) => (
          <Instance key={i} position={[-3.4, B + 0.6, z]} rotation={[0, Math.PI / 2, 0]} />
        ))}
      </Instances>
    </group>
  )
}
