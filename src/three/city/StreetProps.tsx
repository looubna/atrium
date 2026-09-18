import { useMemo } from 'react'
import { Instance, Instances } from '@react-three/drei'
import { pick, rand, randRange } from '@/lib/utils'
import { P } from '../palette'
import { parkingSlots, pavementSlots, type Slot } from './slots'

const FOLIAGE = [P.foliage, P.foliageAlt, P.foliageWarm] as const
const CAR_PAINT = ['#e8e4dc', '#3f4b57', '#8d2f2f', '#5a6b53', '#d8b36a', '#2d3339'] as const

/**
 * All street furniture, batched. Every prop type is one `Instances` group and
 * therefore one draw call, which is what lets the city scale later.
 */
export function StreetProps() {
  const { trees, lamps, benches, bins, cars } = useMemo(() => {
    const slots = pavementSlots()
    const trees: Slot[] = []
    const lamps: Slot[] = []
    const benches: Slot[] = []
    const bins: Slot[] = []

    // Round-robin with a bias toward trees: greenery every other slot, then
    // lighting, then the occasional bench or bin.
    slots.forEach((s, i) => {
      const m = i % 6
      if (m === 0 || m === 2 || m === 4) trees.push(s)
      else if (m === 1 || m === 3) lamps.push(s)
      else if (rand(s.seed * 3.3) > 0.45) benches.push(s)
      else bins.push(s)
    })

    return { trees, lamps, benches, bins, cars: parkingSlots() }
  }, [])

  return (
    <group>
      {/* ---- Trees: trunk + two-lobe canopy ---- */}
      <Instances limit={trees.length} castShadow receiveShadow>
        <cylinderGeometry args={[0.24, 0.34, 3.4, 6]} />
        <meshStandardMaterial color={P.trunk} roughness={0.95} />
        {trees.map((t, i) => (
          <Instance key={i} position={[t.pos[0], t.pos[1] + 1.7, t.pos[2]]} />
        ))}
      </Instances>

      <Instances limit={trees.length} castShadow receiveShadow>
        <icosahedronGeometry args={[1, 1]} />
        {trees.map((t, i) => {
          const s = randRange(t.seed, 2.1, 3.0)
          return (
            <Instance
              key={i}
              position={[t.pos[0], t.pos[1] + 3.4 + s * 0.62, t.pos[2]]}
              scale={[s, s * 0.92, s]}
              rotation={[0, t.seed * 0.7, 0]}
              color={pick(t.seed * 1.7, FOLIAGE)}
            />
          )
        })}
        <meshStandardMaterial roughness={0.88} flatShading />
      </Instances>

      <Instances limit={trees.length} castShadow receiveShadow>
        <icosahedronGeometry args={[1, 1]} />
        {trees.map((t, i) => {
          const s = randRange(t.seed + 9, 1.3, 1.9)
          return (
            <Instance
              key={i}
              position={[
                t.pos[0] + randRange(t.seed + 3, -1.1, 1.1),
                t.pos[1] + 4.9,
                t.pos[2] + randRange(t.seed + 5, -1.1, 1.1),
              ]}
              scale={s}
              color={pick(t.seed * 2.9, FOLIAGE)}
            />
          )
        })}
        <meshStandardMaterial roughness={0.88} flatShading />
      </Instances>

      {/* ---- Street lamps: slim pole, angled head ---- */}
      <Instances limit={lamps.length} castShadow>
        <cylinderGeometry args={[0.1, 0.15, 7.4, 6]} />
        <meshStandardMaterial color={P.metal} roughness={0.55} metalness={0.5} />
        {lamps.map((l, i) => (
          <Instance key={i} position={[l.pos[0], l.pos[1] + 3.7, l.pos[2]]} />
        ))}
      </Instances>
      <Instances limit={lamps.length} castShadow>
        <boxGeometry args={[0.5, 0.24, 1.9]} />
        <meshStandardMaterial color={P.metalDark} roughness={0.5} metalness={0.6} />
        {lamps.map((l, i) => (
          <Instance
            key={i}
            position={[l.pos[0], l.pos[1] + 7.3, l.pos[2]]}
            rotation={[0, l.rot, 0]}
          />
        ))}
      </Instances>
      {/* Emissive lens. Reads as "on" without costing a light. */}
      <Instances limit={lamps.length}>
        <boxGeometry args={[0.38, 0.06, 1.5]} />
        <meshStandardMaterial
          color={P.glassLit}
          emissive={P.glassLit}
          emissiveIntensity={0.7}
          roughness={0.3}
        />
        {lamps.map((l, i) => (
          <Instance
            key={i}
            position={[l.pos[0], l.pos[1] + 7.17, l.pos[2]]}
            rotation={[0, l.rot, 0]}
          />
        ))}
      </Instances>

      {/* ---- Benches ---- */}
      <Instances limit={benches.length} castShadow receiveShadow>
        <boxGeometry args={[2.6, 0.16, 0.72]} />
        <meshStandardMaterial color={P.wood} roughness={0.8} />
        {benches.map((b, i) => (
          <Instance
            key={i}
            position={[b.pos[0], b.pos[1] + 0.62, b.pos[2]]}
            rotation={[0, b.rot, 0]}
          />
        ))}
      </Instances>
      <Instances limit={benches.length} castShadow>
        <boxGeometry args={[2.6, 0.6, 0.14]} />
        <meshStandardMaterial color={P.wood} roughness={0.8} />
        {benches.map((b, i) => (
          <Instance
            key={i}
            position={[b.pos[0], b.pos[1] + 0.95, b.pos[2]]}
            rotation={[0, b.rot, 0]}
          />
        ))}
      </Instances>
      <Instances limit={benches.length * 2} castShadow>
        <boxGeometry args={[0.16, 0.6, 0.6]} />
        <meshStandardMaterial color={P.metalDark} roughness={0.6} metalness={0.4} />
        {benches.flatMap((b, i) =>
          [-1, 1].map((s) => (
            <Instance
              key={`${i}:${s}`}
              position={[
                b.pos[0] + Math.cos(b.rot) * s * 1.05,
                b.pos[1] + 0.3,
                b.pos[2] - Math.sin(b.rot) * s * 1.05,
              ]}
              rotation={[0, b.rot, 0]}
            />
          )),
        )}
      </Instances>

      {/* ---- Litter bins ---- */}
      <Instances limit={Math.max(bins.length, 1)} castShadow receiveShadow>
        <cylinderGeometry args={[0.42, 0.34, 1, 8]} />
        <meshStandardMaterial color={P.metalDark} roughness={0.6} metalness={0.35} />
        {bins.map((b, i) => (
          <Instance key={i} position={[b.pos[0], b.pos[1] + 0.5, b.pos[2]]} />
        ))}
      </Instances>

      {/* ---- Parked cars: body, cabin, wheels ---- */}
      <Instances limit={cars.length} castShadow receiveShadow>
        <boxGeometry args={[4.3, 0.95, 1.9]} />
        {cars.map((c, i) => (
          <Instance
            key={i}
            position={[c.pos[0], 0.72, c.pos[2]]}
            rotation={[0, c.rot, 0]}
            color={pick(c.seed, CAR_PAINT)}
          />
        ))}
        <meshStandardMaterial roughness={0.35} metalness={0.25} />
      </Instances>
      <Instances limit={cars.length} castShadow>
        <boxGeometry args={[2.3, 0.78, 1.66]} />
        <meshStandardMaterial color={P.glassDeep} roughness={0.15} metalness={0.1} />
        {cars.map((c, i) => (
          <Instance
            key={i}
            position={[
              c.pos[0] - Math.cos(c.rot) * 0.25,
              1.48,
              c.pos[2] + Math.sin(c.rot) * 0.25,
            ]}
            rotation={[0, c.rot, 0]}
          />
        ))}
      </Instances>
      <Instances limit={cars.length * 4} castShadow>
        <cylinderGeometry args={[0.42, 0.42, 0.3, 8]} />
        <meshStandardMaterial color="#23262a" roughness={0.9} />
        {cars.flatMap((c, i) =>
          [
            [1.4, 0.88],
            [1.4, -0.88],
            [-1.4, 0.88],
            [-1.4, -0.88],
          ].map(([a, b], j) => {
            const cos = Math.cos(c.rot)
            const sin = Math.sin(c.rot)
            return (
              <Instance
                key={`${i}:${j}`}
                position={[c.pos[0] + a * cos + b * sin, 0.42, c.pos[2] - a * sin + b * cos]}
                rotation={[Math.PI / 2, 0, c.rot]}
              />
            )
          }),
        )}
      </Instances>
    </group>
  )
}
