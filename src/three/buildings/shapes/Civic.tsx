import { Instance, Instances } from '@react-three/drei'
import { GRID } from '@/three/city/grid'
import { P } from '@/three/palette'
import { Doorway, Gable, Planters, Plot, RoofUnits, Steps, Windows } from '../parts'

const B = GRID.curb // every exterior stands on the block pad

export interface ShapeProps {
  accent: string
}

/* ------------------------------------------------------------------ */
/* Company — a modern office tower on a stone podium.                  */
/* ------------------------------------------------------------------ */
export function Tower({ accent }: ShapeProps) {
  const podiumH = 7
  const towerH = 38
  const bands = Array.from({ length: Math.floor(towerH / 3.6) }, (_, i) => (i + 1) * 3.6)

  return (
    <group>
      <Plot width={26} depth={22} pathTo={11} pathWidth={6} />

      {/* Podium */}
      <mesh position={[0, B + podiumH / 2, -1]} castShadow receiveShadow>
        <boxGeometry args={[26, podiumH, 20]} />
        <meshStandardMaterial color={P.stoneLight} roughness={0.82} />
      </mesh>
      <Windows width={19} height={0} rows={1} cols={7} y={B + 4.4} z={9.1} pane={[1.9, 2.6]} lit={0.25} />

      {/* Curtain-walled tower, set back from the podium edge */}
      <mesh position={[0, B + podiumH + towerH / 2, -2]} castShadow receiveShadow>
        <boxGeometry args={[17, towerH, 14]} />
        <meshStandardMaterial color={P.glass} roughness={0.1} metalness={0.28} />
      </mesh>

      {/* Spandrel bands — reads as floors from the city view */}
      <Instances limit={bands.length} castShadow receiveShadow>
        <boxGeometry args={[17.5, 0.85, 14.5]} />
        <meshStandardMaterial color={P.stone} roughness={0.8} />
        {bands.map((y, i) => (
          <Instance key={i} position={[0, B + podiumH + y, -2]} />
        ))}
      </Instances>

      {/* Corner mullions */}
      <Instances limit={4} castShadow>
        <boxGeometry args={[0.6, towerH, 0.6]} />
        <meshStandardMaterial color={P.trim} roughness={0.65} />
        {[
          [8.5, 5],
          [-8.5, 5],
          [8.5, -9],
          [-8.5, -9],
        ].map(([x, z], i) => (
          <Instance key={i} position={[x, B + podiumH + towerH / 2, z]} />
        ))}
      </Instances>

      {/* Accent fin — the building's identity colour, full height */}
      <mesh position={[0, B + podiumH + towerH / 2, 5.4]} castShadow>
        <boxGeometry args={[1.1, towerH - 1, 0.9]} />
        <meshStandardMaterial color={accent} roughness={0.45} emissive={accent} emissiveIntensity={0.12} />
      </mesh>

      {/* Crown */}
      <mesh position={[0, B + podiumH + towerH + 0.7, -2]} castShadow receiveShadow>
        <boxGeometry args={[18.4, 1.4, 15.4]} />
        <meshStandardMaterial color={P.stoneDeep} roughness={0.88} />
      </mesh>
      <RoofUnits width={12} depth={9} y={B + podiumH + towerH + 1.4} seed={3} />

      {/* Entrance */}
      <group position={[0, B, 0]}>
        <Doorway width={5.6} height={5} z={9} accent={P.trim} />
        <mesh position={[0, 6.1, 11.2]} castShadow>
          <boxGeometry args={[12, 0.4, 5]} />
          <meshStandardMaterial color={P.trim} roughness={0.7} />
        </mesh>
        <Planters points={[[-7.4, 11.5], [7.4, 11.5]]} y={0} />
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* University — a colonnaded range with a pedimented centre.           */
/* ------------------------------------------------------------------ */
export function Campus({ accent }: ShapeProps) {
  const columns = [-12, -8.6, -5.2, 5.2, 8.6, 12]

  return (
    <group>
      <Plot width={34} depth={26} pathTo={13} pathWidth={8} />

      {/* Main range */}
      <mesh position={[0, B + 6.5, -3]} castShadow receiveShadow>
        <boxGeometry args={[34, 13, 16]} />
        <meshStandardMaterial color={P.stoneLight} roughness={0.85} />
      </mesh>
      <Windows width={30} height={5} rows={2} cols={9} y={B + 4} z={5.1} pane={[1.5, 2.4]} lit={0.3} />

      {/* End pavilions, slightly taller, to give the range a silhouette */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[s * 14.5, B + 7.75, -3]} castShadow receiveShadow>
            <boxGeometry args={[7, 15.5, 17]} />
            <meshStandardMaterial color={P.stone} roughness={0.85} />
          </mesh>
          <Gable halfWidth={3.7} height={2.4} depth={17.4} position={[s * 14.5, B + 15.5, -3]} alongX color={P.roof} />
        </group>
      ))}

      {/* Portico: columns, entablature, pediment */}
      <group position={[0, B, 0]}>
        <Instances limit={columns.length} castShadow receiveShadow>
          <cylinderGeometry args={[0.62, 0.7, 10, 10]} />
          <meshStandardMaterial color={P.trim} roughness={0.8} />
          {columns.map((x, i) => (
            <Instance key={i} position={[x, 5.6, 5.8]} />
          ))}
        </Instances>
        <mesh position={[0, 11.2, 5.8]} castShadow receiveShadow>
          <boxGeometry args={[29, 1.6, 3.4]} />
          <meshStandardMaterial color={P.trim} roughness={0.8} />
        </mesh>
        <Gable halfWidth={14.5} height={4} depth={3.4} position={[0, 12, 5.8]} color={P.stoneLight} />

        {/* Clock — a small cue that reads at distance */}
        <mesh position={[0, 14.2, 7.6]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.5, 1.5, 0.3, 20]} />
          <meshStandardMaterial color={P.trim} roughness={0.5} />
        </mesh>
        <mesh position={[0, 14.2, 7.78]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.15, 1.15, 0.05, 20]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.2} roughness={0.4} />
        </mesh>

        <Steps width={20} z={9.6} count={4} rise={0.2} />
        <Doorway width={5} height={4.6} z={4.4} accent={P.stoneLight} />
      </group>

      {/* Lawn edging and a pair of specimen trees flanking the path */}
      <Instances limit={2} castShadow receiveShadow>
        <cylinderGeometry args={[0.3, 0.4, 4, 6]} />
        <meshStandardMaterial color={P.trunk} roughness={0.95} />
        {[-11, 11].map((x, i) => (
          <Instance key={i} position={[x, B + 2, 11]} />
        ))}
      </Instances>
      <Instances limit={2} castShadow>
        <icosahedronGeometry args={[3, 1]} />
        <meshStandardMaterial color={P.foliageAlt} roughness={0.9} flatShading />
        {[-11, 11].map((x, i) => (
          <Instance key={i} position={[x, B + 6.4, 11]} scale={[1, 0.9, 1]} rotation={[0, i * 1.4, 0]} />
        ))}
      </Instances>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Conference centre — glazed foyer, raked hall, fly tower behind.     */
/* ------------------------------------------------------------------ */
export function Auditorium({ accent }: ShapeProps) {
  return (
    <group>
      <Plot width={32} depth={24} pathTo={12} pathWidth={10} />

      {/* Raked hall */}
      <mesh position={[0, B + 5.5, -3]} castShadow receiveShadow>
        <boxGeometry args={[30, 11, 18]} />
        <meshStandardMaterial color={P.stoneWarm} roughness={0.84} />
      </mesh>
      {/* Sloped roof over the rake */}
      <mesh position={[0, B + 12, -3]} rotation={[0.16, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[30.6, 0.8, 18.6]} />
        <meshStandardMaterial color={P.roof} roughness={0.8} />
      </mesh>

      {/* Fly tower */}
      <mesh position={[0, B + 9, -13]} castShadow receiveShadow>
        <boxGeometry args={[16, 18, 9]} />
        <meshStandardMaterial color={P.concrete} roughness={0.86} />
      </mesh>

      {/* Glazed foyer */}
      <mesh position={[0, B + 3.6, 7.4]} castShadow receiveShadow>
        <boxGeometry args={[26, 7.2, 9]} />
        <meshStandardMaterial color={P.glass} roughness={0.1} metalness={0.25} transparent opacity={0.94} />
      </mesh>
      <Instances limit={7} castShadow>
        <boxGeometry args={[0.35, 7.2, 9.3]} />
        <meshStandardMaterial color={P.trim} roughness={0.6} />
        {[-12, -8, -4, 0, 4, 8, 12].map((x, i) => (
          <Instance key={i} position={[x, B + 3.6, 7.4]} />
        ))}
      </Instances>

      {/* Cantilevered entrance canopy */}
      <mesh position={[0, B + 7.6, 9.5]} castShadow>
        <boxGeometry args={[28, 0.55, 11]} />
        <meshStandardMaterial color={P.trim} roughness={0.65} />
      </mesh>

      {/* Signage band in the category colour */}
      <mesh position={[0, B + 9.1, 6]}>
        <boxGeometry args={[18, 1.3, 0.4]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.3} roughness={0.4} />
      </mesh>

      <group position={[0, B, 0]}>
        <Steps width={26} z={12.2} count={3} rise={0.16} />
        <Doorway width={7} height={4.4} z={11.7} accent={P.trim} />
        <Planters points={[[-14.5, 10], [14.5, 10]]} y={0} />
      </group>

      <RoofUnits width={18} depth={10} y={B + 18} seed={7} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Practice Room — a drum with a lit ring. Deliberately unlike the     */
/* rest of the city, because it is not a real-world place.             */
/* ------------------------------------------------------------------ */
export function PracticeHall({ accent }: ShapeProps) {
  return (
    <group>
      {/* Concentric paving — a target, read from above */}
      <group position={[0, B + 0.02, 0]}>
        {[12.6, 9.4, 6.2].map((r, i) => (
          <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, i * 0.012, 0]} receiveShadow>
            <circleGeometry args={[r, 40]} />
            <meshStandardMaterial color={i % 2 === 0 ? P.pavement : P.grassDark} roughness={0.95} />
          </mesh>
        ))}
      </group>

      {/* Drum */}
      <mesh position={[0, B + 4.6, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[9, 9.4, 9.2, 28]} />
        <meshStandardMaterial color={P.stoneLight} roughness={0.8} />
      </mesh>
      {/* Clerestory */}
      <mesh position={[0, B + 10, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[8.2, 8.2, 2.4, 28]} />
        <meshStandardMaterial color={P.glassDeep} roughness={0.14} metalness={0.2} />
      </mesh>
      {/* Roof cap */}
      <mesh position={[0, B + 11.7, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[7.4, 8.6, 1.3, 28]} />
        <meshStandardMaterial color={P.roof} roughness={0.82} />
      </mesh>

      {/* The ring: this building's whole identity */}
      <mesh position={[0, B + 12.9, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[5.2, 0.3, 8, 40]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.1} roughness={0.3} />
      </mesh>
      <mesh position={[0, B + 9.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[9.5, 0.16, 6, 40]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.7} roughness={0.3} />
      </mesh>

      {/* Entrance portal projecting from the drum */}
      <group position={[0, B, 0]}>
        <mesh position={[0, 3.2, 8.4]} castShadow receiveShadow>
          <boxGeometry args={[7.4, 6.4, 4.4]} />
          <meshStandardMaterial color={P.stone} roughness={0.82} />
        </mesh>
        <Doorway width={4.4} height={4} z={10.6} accent={P.trim} />
        <Steps width={8} z={11.4} count={2} rise={0.16} />
        <Planters points={[[-5.6, 11.2], [5.6, 11.2]]} y={0} />
      </group>
    </group>
  )
}
