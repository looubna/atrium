import { useMemo } from 'react'
import { Instance, Instances } from '@react-three/drei'
import { pick, rand, randRange } from '@/lib/utils'
import { P } from '../palette'

const RADIUS = 138
const FOLIAGE = [P.foliage, P.foliageAlt, P.foliageWarm] as const

/**
 * A planted belt between the last street and the island edge, so the district
 * is framed by landscape rather than stopping at a bare rim.
 */
function GreenBelt() {
  const trees = useMemo(() => {
    const out: { p: [number, number]; s: number; rot: number }[] = []
    for (let i = 0; i < 120; i++) {
      const a = rand(i * 5 + 1) * Math.PI * 2
      const r = randRange(i * 5 + 2, 101, RADIUS - 7)
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      // Keep clear of the road stubs that run out to the island edge.
      if (Math.abs(Math.abs(x) - 56) < 9 && Math.abs(z) < RADIUS) continue
      if (Math.abs(Math.abs(z) - 56) < 9 && Math.abs(x) < RADIUS) continue
      if (Math.abs(x) < 9 || Math.abs(z) < 9) continue
      out.push({ p: [x, z], s: randRange(i * 7, 2.4, 4.2), rot: rand(i * 3) * 6 })
    }
    return out
  }, [])

  return (
    <group>
      <Instances limit={trees.length} castShadow receiveShadow>
        <cylinderGeometry args={[0.26, 0.38, 4, 6]} />
        <meshStandardMaterial color={P.trunk} roughness={0.95} />
        {trees.map((t, i) => (
          <Instance key={i} position={[t.p[0], 2, t.p[1]]} />
        ))}
      </Instances>
      <Instances limit={trees.length} castShadow>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial roughness={0.9} flatShading />
        {trees.map((t, i) => (
          <Instance
            key={i}
            position={[t.p[0], 4 + t.s * 0.62, t.p[1]]}
            scale={[t.s, t.s * 0.9, t.s]}
            rotation={[0, t.rot, 0]}
            color={pick(t.s * 31, FOLIAGE)}
          />
        ))}
      </Instances>
    </group>
  )
}

/**
 * The city sits on a defined island rather than an endless plane.
 *
 * A flat infinite ground always puts the horizon at the camera's eye level,
 * which from an elevated overview is off the top of the screen — the sky never
 * appears and the world reads as a fogged slab. A bounded plinth keeps the sky
 * in frame, reads as a deliberate model of a district, and costs less to draw.
 */
export function Ground() {
  return (
    <group>
      {/* Plinth, slightly tapered so the edge catches light */}
      <mesh position={[0, -3.03, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[RADIUS, RADIUS - 6, 6, 80]} />
        <meshStandardMaterial color={P.earth} roughness={1} />
      </mesh>

      {/* Grass surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[RADIUS, 80]} />
        <meshStandardMaterial color={P.grass} roughness={1} />
      </mesh>

      {/* Mown band around the built-up area — reads as maintained parkland */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <ringGeometry args={[96, 101, 80]} />
        <meshStandardMaterial color={P.grassDark} roughness={1} />
      </mesh>

      <GreenBelt />
    </group>
  )
}
