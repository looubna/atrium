import { useMemo } from 'react'
import { Instance, Instances } from '@react-three/drei'
import { LOCATIONS } from '@/data/locations'
import { pick, rand, randRange } from '@/lib/utils'
import { P } from '../palette'
import { BANDS, GRID } from './grid'

const FACADE = [P.stoneLight, P.stone, P.stoneWarm, P.stoneDeep, P.concrete, P.brick] as const

interface Mass {
  pos: [number, number, number]
  scale: [number, number, number]
  color: string
  floors: number
}

/**
 * Background city fabric on the blocks that have no location. These are not
 * interactive — their only job is to make the grid feel inhabited and give the
 * hero buildings something to stand out against.
 */
export function CityFill() {
  const { masses, bands, parapets } = useMemo(() => {
    // Which blocks are already taken by a real location?
    const bandOf = (v: number) =>
      BANDS.reduce((best, b) => (Math.abs(v - b.c) < Math.abs(v - best.c) ? b : best), BANDS[0])
    const taken = new Set(
      LOCATIONS.map((l) => `${bandOf(l.position[0]).c}:${bandOf(l.position[2]).c}`),
    )

    const masses: Mass[] = []
    let seed = 1000

    for (const bx of BANDS) {
      for (const bz of BANDS) {
        if (taken.has(`${bx.c}:${bz.c}`)) continue

        const count = 2 + Math.floor(rand(seed) * 2)
        for (let i = 0; i < count; i++) {
          const s = seed + i * 17
          // Subdivide the block along its long axis so masses share party walls.
          const along = bx.w >= bz.w
          const span = (along ? bx.w : bz.w) - 12
          const slot = -span / 2 + (span / count) * (i + 0.5)
          const w = randRange(s, 11, span / count + 5)
          const d = randRange(s + 1, 12, (along ? bz.w : bx.w) - 13)
          // Outer ring stays low so the skyline steps up toward the centre —
          // and so the blocks nearest the opening camera cannot wall off the city.
          const outer = Math.abs(bx.c) > 50 || Math.abs(bz.c) > 50
          const h = outer ? randRange(s + 2, 7, 14) : randRange(s + 2, 12, 30)

          masses.push({
            pos: [
              bx.c + (along ? slot : randRange(s + 4, -2, 2)),
              GRID.curb,
              bz.c + (along ? randRange(s + 4, -2, 2) : slot),
            ],
            scale: along ? [w, h, d] : [d, h, w],
            color: pick(s * 1.3, FACADE),
            floors: Math.max(2, Math.floor(h / 3.6)),
          })
        }
        seed += 71
      }
    }

    // One glazing band per floor, and a parapet cap per mass.
    const bands: { pos: [number, number, number]; scale: [number, number, number] }[] = []
    const parapets: { pos: [number, number, number]; scale: [number, number, number] }[] = []

    masses.forEach((m) => {
      const [w, h, d] = m.scale
      for (let f = 1; f <= m.floors; f++) {
        const y = (h / (m.floors + 1)) * f
        bands.push({ pos: [m.pos[0], m.pos[1] + y, m.pos[2]], scale: [w + 0.12, 1.5, d + 0.12] })
      }
      parapets.push({
        pos: [m.pos[0], m.pos[1] + h + 0.35, m.pos[2]],
        scale: [w + 0.7, 0.7, d + 0.7],
      })
    })

    return { masses, bands, parapets }
  }, [])

  return (
    <group>
      <Instances limit={masses.length} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.85} />
        {masses.map((m, i) => (
          <Instance
            key={i}
            position={[m.pos[0], m.pos[1] + m.scale[1] / 2, m.pos[2]]}
            scale={m.scale}
            color={m.color}
          />
        ))}
      </Instances>

      <Instances limit={bands.length} castShadow={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={P.glassDeep} roughness={0.22} metalness={0.1} />
        {bands.map((b, i) => (
          <Instance key={i} position={b.pos} scale={b.scale} />
        ))}
      </Instances>

      <Instances limit={parapets.length} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={P.stoneDeep} roughness={0.9} />
        {parapets.map((b, i) => (
          <Instance key={i} position={b.pos} scale={b.scale} />
        ))}
      </Instances>
    </group>
  )
}
