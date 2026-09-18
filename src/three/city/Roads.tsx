import { useMemo } from 'react'
import { Instance, Instances } from '@react-three/drei'
import { P } from '../palette'
import { BANDS, GRID } from './grid'

const { roads, roadHalf, extent, curb } = GRID

/** Lane dashes and crosswalk stripes, batched into one draw call each. */
function Markings() {
  const { dashes, stripes } = useMemo(() => {
    const dashes: { pos: [number, number, number]; rot: number }[] = []
    const stripes: { pos: [number, number, number]; rot: number }[] = []

    const nearJunction = (v: number) => roads.some((r) => Math.abs(v - r) < 11)

    for (const r of roads) {
      for (let t = -extent + 4; t <= extent - 4; t += 8) {
        if (nearJunction(t)) continue
        dashes.push({ pos: [t, 0, r], rot: 0 })
        dashes.push({ pos: [r, 0, t], rot: Math.PI / 2 })
      }
    }

    // A zebra on every approach to every junction.
    for (const a of roads) {
      for (const b of roads) {
        for (const side of [-1, 1] as const) {
          for (let i = -2; i <= 2; i++) {
            const off = (roadHalf - 2.2) * side
            stripes.push({ pos: [a + i * 2.3, 0, b + off], rot: Math.PI / 2 })
            stripes.push({ pos: [a + off, 0, b + i * 2.3], rot: 0 })
          }
        }
      }
    }
    return { dashes, stripes }
  }, [])

  return (
    <>
      <Instances limit={dashes.length} castShadow={false} receiveShadow={false}>
        <boxGeometry args={[3, 0.02, 0.32]} />
        <meshStandardMaterial color={P.asphaltLine} roughness={0.9} />
        {dashes.map((d, i) => (
          <Instance key={i} position={[d.pos[0], 0.035, d.pos[2]]} rotation={[0, d.rot, 0]} />
        ))}
      </Instances>

      <Instances limit={stripes.length} castShadow={false} receiveShadow={false}>
        <boxGeometry args={[2.6, 0.02, 1.1]} />
        <meshStandardMaterial color={P.crosswalk} roughness={0.9} />
        {stripes.map((s, i) => (
          <Instance key={i} position={[s.pos[0], 0.03, s.pos[2]]} rotation={[0, s.rot, 0]} />
        ))}
      </Instances>
    </>
  )
}

/**
 * Blocks are raised pads. Rendering them as a dark base with a slightly inset
 * lighter top gives a readable kerb line for free — no textures involved.
 */
function Blocks() {
  return (
    <group>
      {BANDS.map((bx) =>
        BANDS.map((bz) => (
          <group key={`${bx.c}:${bz.c}`} position={[bx.c, 0, bz.c]}>
            <mesh position={[0, curb / 2, 0]} receiveShadow>
              <boxGeometry args={[bx.w, curb, bz.w]} />
              <meshStandardMaterial color={P.pavementEdge} roughness={0.95} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, curb + 0.005, 0]} receiveShadow>
              <planeGeometry args={[bx.w - 1.1, bz.w - 1.1]} />
              <meshStandardMaterial color={P.pavement} roughness={0.92} />
            </mesh>
          </group>
        )),
      )}
    </group>
  )
}

export function Roads() {
  return (
    <group>
      {/* Carriageway. Horizontal and vertical strips are offset by 2mm so the
          overlapping junctions cannot z-fight. */}
      {roads.map((r) => (
        <mesh key={`h${r}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, r]} receiveShadow>
          <planeGeometry args={[extent * 2, roadHalf * 2]} />
          <meshStandardMaterial color={P.asphalt} roughness={0.88} />
        </mesh>
      ))}
      {roads.map((r) => (
        <mesh key={`v${r}`} rotation={[-Math.PI / 2, 0, 0]} position={[r, 0.01, 0]} receiveShadow>
          <planeGeometry args={[roadHalf * 2, extent * 2]} />
          <meshStandardMaterial color={P.asphalt} roughness={0.88} />
        </mesh>
      ))}

      <Blocks />
      <Markings />
    </group>
  )
}
