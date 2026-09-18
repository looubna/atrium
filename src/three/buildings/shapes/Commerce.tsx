import { Instance, Instances } from '@react-three/drei'
import { GRID } from '@/three/city/grid'
import { P } from '@/three/palette'
import { Canopy, Doorway, Planters, Plot, RoofUnits, Windows } from '../parts'
import type { ShapeProps } from './Civic'

const B = GRID.curb

/** Round cafe/terrace table with four stools. Shared by cafe and restaurant. */
function TerraceSet({ points, umbrella = false }: { points: [number, number][]; umbrella?: boolean }) {
  const seats = points.flatMap(([x, z]) =>
    [
      [1.5, 0],
      [-1.5, 0],
      [0, 1.5],
      [0, -1.5],
    ].map(([dx, dz]) => [x + dx, z + dz] as [number, number]),
  )

  return (
    <group>
      <Instances limit={points.length} castShadow receiveShadow>
        <cylinderGeometry args={[1.05, 1.05, 0.1, 16]} />
        <meshStandardMaterial color={P.trim} roughness={0.7} />
        {points.map((p, i) => (
          <Instance key={i} position={[p[0], 0.78, p[1]]} />
        ))}
      </Instances>
      <Instances limit={points.length} castShadow>
        <cylinderGeometry args={[0.1, 0.16, 0.78, 8]} />
        <meshStandardMaterial color={P.metalDark} roughness={0.6} metalness={0.4} />
        {points.map((p, i) => (
          <Instance key={i} position={[p[0], 0.39, p[1]]} />
        ))}
      </Instances>
      <Instances limit={seats.length} castShadow receiveShadow>
        <cylinderGeometry args={[0.36, 0.32, 0.12, 10]} />
        <meshStandardMaterial color={P.wood} roughness={0.85} />
        {seats.map((p, i) => (
          <Instance key={i} position={[p[0], 0.48, p[1]]} />
        ))}
      </Instances>
      <Instances limit={seats.length} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.48, 6]} />
        <meshStandardMaterial color={P.metalDark} roughness={0.6} metalness={0.4} />
        {seats.map((p, i) => (
          <Instance key={i} position={[p[0], 0.24, p[1]]} />
        ))}
      </Instances>

      {umbrella && (
        <>
          <Instances limit={points.length} castShadow>
            <cylinderGeometry args={[0.08, 0.08, 3, 6]} />
            <meshStandardMaterial color={P.metal} roughness={0.6} metalness={0.4} />
            {points.map((p, i) => (
              <Instance key={i} position={[p[0], 1.5, p[1]]} />
            ))}
          </Instances>
          <Instances limit={points.length} castShadow>
            <coneGeometry args={[2.4, 0.9, 8]} />
            <meshStandardMaterial color={P.stoneLight} roughness={0.9} />
            {points.map((p, i) => (
              <Instance key={i} position={[p[0], 3.25, p[1]]} rotation={[0, Math.PI / 8, 0]} />
            ))}
          </Instances>
        </>
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Shopping centre — long glazed frontage with a taller atrium.        */
/* ------------------------------------------------------------------ */
export function Mall({ accent }: ShapeProps) {
  return (
    <group>
      <Plot width={34} depth={24} pathTo={12} pathWidth={12} />

      <mesh position={[0, B + 5.5, -3]} castShadow receiveShadow>
        <boxGeometry args={[33, 11, 17]} />
        <meshStandardMaterial color={P.stone} roughness={0.85} />
      </mesh>
      {/* Continuous shopfront glazing */}
      <mesh position={[0, B + 3.2, 5.7]} castShadow receiveShadow>
        <boxGeometry args={[31, 6.4, 1.2]} />
        <meshStandardMaterial color={P.glassDeep} roughness={0.12} metalness={0.2} />
      </mesh>
      <Instances limit={9} castShadow>
        <boxGeometry args={[0.34, 6.6, 1.5]} />
        <meshStandardMaterial color={P.trim} roughness={0.65} />
        {[-15, -11.2, -7.4, -3.6, 3.6, 7.4, 11.2, 15].map((x, i) => (
          <Instance key={i} position={[x, B + 3.2, 5.7]} />
        ))}
      </Instances>

      {/* Atrium — the tallest element, centred on the entrance */}
      <mesh position={[0, B + 8, 4]} castShadow receiveShadow>
        <boxGeometry args={[13, 16, 12]} />
        <meshStandardMaterial color={P.glass} roughness={0.1} metalness={0.28} transparent opacity={0.93} />
      </mesh>
      <mesh position={[0, B + 16.3, 4]} castShadow receiveShadow>
        <boxGeometry args={[14, 0.7, 13]} />
        <meshStandardMaterial color={P.trim} roughness={0.7} />
      </mesh>
      <mesh position={[0, B + 12.2, 10.2]}>
        <boxGeometry args={[9, 1.5, 0.4]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.35} roughness={0.4} />
      </mesh>

      <group position={[0, B, 0]}>
        <Doorway width={6.4} height={4.6} z={9.6} accent={P.trim} />
        <Planters points={[[-9, 11], [9, 11], [-13, 11], [13, 11]]} y={0} />
      </group>

      <Windows width={26} height={0} rows={1} cols={9} y={B + 9} z={5.6} pane={[2, 2]} color={P.glassDeep} />
      <RoofUnits width={22} depth={10} y={B + 11} seed={11} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Corner mart — small, busy, awning and crates.                       */
/* ------------------------------------------------------------------ */
export function Mart({ accent }: ShapeProps) {
  return (
    <group>
      <Plot width={18} depth={15} pathTo={7.5} pathWidth={8} />

      <mesh position={[0, B + 3.6, -1.4]} castShadow receiveShadow>
        <boxGeometry args={[17, 7.2, 11]} />
        <meshStandardMaterial color={P.brick} roughness={0.9} />
      </mesh>
      <mesh position={[0, B + 7.5, -1.4]} castShadow receiveShadow>
        <boxGeometry args={[17.8, 0.7, 11.8]} />
        <meshStandardMaterial color={P.brickDeep} roughness={0.88} />
      </mesh>

      {/* Full-width shopfront */}
      <mesh position={[0, B + 2.6, 4.1]} castShadow receiveShadow>
        <boxGeometry args={[14, 4.4, 0.5]} />
        <meshStandardMaterial
          color={P.glassLit}
          emissive={P.glassLit}
          emissiveIntensity={0.34}
          roughness={0.18}
        />
      </mesh>
      <mesh position={[0, B + 6.1, 4.3]}>
        <boxGeometry args={[11, 1.2, 0.36]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.3} roughness={0.4} />
      </mesh>

      <group position={[0, B, 0]}>
        <Canopy width={16} z={4.3} y={5.2} depth={2.4} color={P.foliageAlt} />
        <Doorway width={2.6} height={3.4} z={4.1} accent={P.brickDeep} />

        {/* Produce crates on the pavement */}
        <Instances limit={4} castShadow receiveShadow>
          <boxGeometry args={[1.5, 0.7, 1.1]} />
          <meshStandardMaterial color={P.wood} roughness={0.9} />
          {[
            [-5.6, 5.6, 0.35],
            [-5.6, 5.6, 1.05],
            [5.6, 5.6, 0.35],
            [5.6, 5.6, 1.05],
          ].map(([x, z, y], i) => (
            <Instance key={i} position={[x, y, z]} />
          ))}
        </Instances>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Café — brick, warm light, pavement terrace.                         */
/* ------------------------------------------------------------------ */
export function Cafe({ accent }: ShapeProps) {
  return (
    <group>
      <Plot width={20} depth={16} pathTo={8} pathWidth={9} />

      <mesh position={[0, B + 4, -2]} castShadow receiveShadow>
        <boxGeometry args={[15, 8, 11]} />
        <meshStandardMaterial color={P.brick} roughness={0.9} />
      </mesh>
      <mesh position={[0, B + 8.3, -2]} castShadow receiveShadow>
        <boxGeometry args={[15.8, 0.6, 11.8]} />
        <meshStandardMaterial color={P.brickDeep} roughness={0.88} />
      </mesh>

      {/* Warm, deep shopfront glazing — the café should look occupied */}
      <mesh position={[0, B + 2.7, 3.4]} castShadow receiveShadow>
        <boxGeometry args={[12.4, 4, 0.5]} />
        <meshStandardMaterial
          color={P.glassLit}
          emissive={P.glassLit}
          emissiveIntensity={0.55}
          roughness={0.16}
        />
      </mesh>
      <Windows width={12} height={0} rows={1} cols={2} y={B + 6.4} z={3.6} pane={[3.6, 1.6]} color={P.glassLit} lit={1} />

      <mesh position={[0, B + 6.5, 3.75]}>
        <boxGeometry args={[7, 1.1, 0.3]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.34} roughness={0.4} />
      </mesh>

      <group position={[0, B, 0]}>
        <Canopy width={14.4} z={3.7} y={5} depth={3} color={P.fabric} />
        <Doorway width={2.4} height={3.3} z={3.5} accent={P.brickDeep} />
        <TerraceSet points={[[-5, 7.2], [5, 7.2]]} />
        <Planters points={[[-8.6, 4.4], [8.6, 4.4]]} y={0} />

        {/* A-board on the pavement */}
        <mesh position={[7.4, 0.85, 6.4]} rotation={[0, -0.4, 0.12]} castShadow>
          <boxGeometry args={[1.1, 1.7, 0.1]} />
          <meshStandardMaterial color={P.metalDark} roughness={0.85} />
        </mesh>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Restaurant — the client-dinner venue. Stone, hedges, umbrellas.     */
/* ------------------------------------------------------------------ */
export function Restaurant({ accent }: ShapeProps) {
  return (
    <group>
      <Plot width={24} depth={18} pathTo={9} pathWidth={7} />

      <mesh position={[0, B + 4.5, -2.6]} castShadow receiveShadow>
        <boxGeometry args={[20, 9, 12]} />
        <meshStandardMaterial color={P.stoneWarm} roughness={0.86} />
      </mesh>
      <mesh position={[0, B + 9.4, -2.6]} castShadow receiveShadow>
        <boxGeometry args={[20.8, 0.8, 12.8]} />
        <meshStandardMaterial color={P.roofWarm} roughness={0.85} />
      </mesh>

      {/* Tall arched-feel windows, warmly lit */}
      <Windows width={16} height={0} rows={1} cols={4} y={B + 4} z={3.5} pane={[2.6, 5]} color={P.glassLit} lit={1} />
      <Instances limit={5} castShadow>
        <boxGeometry args={[0.4, 6.4, 0.5]} />
        <meshStandardMaterial color={P.trim} roughness={0.7} />
        {[-8, -4, 0, 4, 8].map((x, i) => (
          <Instance key={i} position={[x, B + 4, 3.6]} />
        ))}
      </Instances>

      <mesh position={[0, B + 8.2, 3.8]}>
        <boxGeometry args={[6.4, 1.2, 0.3]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.3} roughness={0.4} />
      </mesh>

      <group position={[0, B, 0]}>
        <Canopy width={6.8} z={3.7} y={6.4} depth={3.4} color={P.metalDark} />
        <Doorway width={3.2} height={4} z={3.5} accent={P.trim} />

        {/* Terrace, screened from the street by a low hedge */}
        <TerraceSet points={[[-6.4, 7], [6.4, 7]]} umbrella />
        <mesh position={[0, 0.55, 9.6]} castShadow receiveShadow>
          <boxGeometry args={[21, 1.1, 0.9]} />
          <meshStandardMaterial color={P.foliageAlt} roughness={0.95} flatShading />
        </mesh>
      </group>
    </group>
  )
}
