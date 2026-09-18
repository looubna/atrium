import { useMemo } from 'react'
import { Instance, Instances } from '@react-three/drei'
import { GRID } from '../city/grid'
import { P } from '../palette'

/** Reusable facade / plot pieces shared by every location exterior. */

interface WindowsProps {
  /** Facade width and the vertical span the grid should fill. */
  width: number
  height: number
  rows: number
  cols: number
  /** Local y of the lowest row's centre. */
  y: number
  /** How far the panes sit in front of the wall plane. */
  z: number
  pane?: [number, number]
  color?: string
  /** A few panes lit from inside — reads as occupied. */
  lit?: number
}

export function Windows({
  width,
  height,
  rows,
  cols,
  y,
  z,
  pane = [1.5, 1.7],
  color = P.glassDeep,
  lit = 0,
}: WindowsProps) {
  const cells = useMemo(() => {
    const out: { p: [number, number, number]; on: boolean }[] = []
    const stepX = width / cols
    const stepY = rows > 1 ? height / (rows - 1) : 0
    let n = 0
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const on = lit > 0 && Math.sin(n * 12.9898) * 0.5 + 0.5 < lit
        out.push({ p: [-width / 2 + stepX * (c + 0.5), y + stepY * r, z], on })
        n++
      }
    }
    return out
  }, [width, height, rows, cols, y, z, lit])

  const dark = cells.filter((c) => !c.on)
  const on = cells.filter((c) => c.on)

  return (
    <>
      <Instances limit={Math.max(dark.length, 1)} castShadow={false}>
        <boxGeometry args={[pane[0], pane[1], 0.1]} />
        <meshStandardMaterial color={color} roughness={0.14} metalness={0.15} />
        {dark.map((c, i) => (
          <Instance key={i} position={c.p} />
        ))}
      </Instances>
      {on.length > 0 && (
        <Instances limit={on.length} castShadow={false}>
          <boxGeometry args={[pane[0], pane[1], 0.1]} />
          <meshStandardMaterial
            color={P.glassLit}
            emissive={P.glassLit}
            emissiveIntensity={0.45}
            roughness={0.3}
          />
          {on.map((c, i) => (
            <Instance key={i} position={c.p} />
          ))}
        </Instances>
      )}
    </>
  )
}

interface DoorwayProps {
  width?: number
  height?: number
  /** Local z of the facade plane the doorway is cut into. */
  z: number
  accent?: string
}

/** Entrance: recessed reveal, glazed leaves, warm spill onto the pavement. */
export function Doorway({ width = 4.4, height = 4, z, accent = P.trim }: DoorwayProps) {
  return (
    <group position={[0, 0, z]}>
      {/* Reveal */}
      <mesh position={[0, height / 2, -0.5]}>
        <boxGeometry args={[width + 1.1, height + 0.9, 1]} />
        <meshStandardMaterial color={accent} roughness={0.7} />
      </mesh>
      {/* Glazed leaves */}
      <mesh position={[0, height / 2, 0.06]}>
        <boxGeometry args={[width, height, 0.14]} />
        <meshStandardMaterial
          color={P.glassLit}
          emissive={P.glassLit}
          emissiveIntensity={0.3}
          roughness={0.2}
          metalness={0.1}
        />
      </mesh>
      {/* Mullion */}
      <mesh position={[0, height / 2, 0.14]}>
        <boxGeometry args={[0.12, height, 0.1]} />
        <meshStandardMaterial color={P.metalDark} roughness={0.5} metalness={0.5} />
      </mesh>
      {/* Threshold */}
      <mesh position={[0, 0.04, 1.4]} receiveShadow>
        <boxGeometry args={[width + 2.4, 0.08, 3.4]} />
        <meshStandardMaterial color={P.trim} roughness={0.85} />
      </mesh>
    </group>
  )
}

interface PlotProps {
  /** Footprint of the landscaped plot. */
  width: number
  depth: number
  /** Local z where the path should meet the kerb. */
  pathTo: number
  pathWidth?: number
}

/**
 * The ground a building stands on: a planted apron with a paved path running
 * out to the street. Sits just above the block pad.
 */
export function Plot({ width, depth, pathTo, pathWidth = 5 }: PlotProps) {
  return (
    <group position={[0, GRID.curb + 0.02, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={P.grassDark} roughness={1} />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, pathTo / 2 + depth / 4]}
        receiveShadow
      >
        <planeGeometry args={[pathWidth, Math.abs(pathTo) + depth / 2]} />
        <meshStandardMaterial color={P.pavement} roughness={0.92} />
      </mesh>
    </group>
  )
}

interface StepsProps {
  width: number
  z: number
  count?: number
  rise?: number
}

export function Steps({ width, z, count = 3, rise = 0.17 }: StepsProps) {
  return (
    <group>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} position={[0, rise * (count - i) - rise / 2, z + i * 0.9]} receiveShadow castShadow>
          <boxGeometry args={[width - i * 0.5, rise, 0.9]} />
          <meshStandardMaterial color={P.stoneDeep} roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

interface CanopyProps {
  width: number
  z: number
  y?: number
  depth?: number
  color?: string
}

/** Fabric awning — the cheapest way to make a small shopfront feel designed. */
export function Canopy({ width, z, y = 4.1, depth = 2.6, color = P.fabric }: CanopyProps) {
  return (
    <group position={[0, y, z]}>
      <mesh rotation={[-0.32, 0, 0]} position={[0, 0, depth / 2]} castShadow>
        <boxGeometry args={[width, 0.12, depth]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      {/* Scalloped valance */}
      <mesh position={[0, -0.36, depth - 0.1]} castShadow>
        <boxGeometry args={[width, 0.6, 0.1]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
    </group>
  )
}

/** Rooftop plant — breaks up otherwise flat roofs at city-overview distance. */
export function RoofUnits({ width, depth, y, seed = 0 }: { width: number; depth: number; y: number; seed?: number }) {
  const units = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number] }[] = []
    for (let i = 0; i < 3; i++) {
      const r = Math.abs(Math.sin((seed + i) * 91.7))
      out.push({
        p: [(-0.3 + r * 0.6) * width, y + 0.6, (-0.3 + ((r * 3) % 1) * 0.6) * depth],
        s: [2 + r * 2.4, 1.2, 1.6 + r * 1.6],
      })
    }
    return out
  }, [width, depth, y, seed])

  return (
    <Instances limit={units.length} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={P.concrete} roughness={0.8} />
      {units.map((u, i) => (
        <Instance key={i} position={u.p} scale={u.s} />
      ))}
    </Instances>
  )
}

/** Planter boxes with clipped shrubs, for entrances and terraces. */
export function Planters({ points, y }: { points: [number, number][]; y: number }) {
  return (
    <>
      <Instances limit={points.length} castShadow receiveShadow>
        <boxGeometry args={[1.5, 0.8, 1.5]} />
        <meshStandardMaterial color={P.stoneDeep} roughness={0.9} />
        {points.map((p, i) => (
          <Instance key={i} position={[p[0], y + 0.4, p[1]]} />
        ))}
      </Instances>
      <Instances limit={points.length} castShadow>
        <icosahedronGeometry args={[0.72, 1]} />
        <meshStandardMaterial color={P.foliage} roughness={0.9} flatShading />
        {points.map((p, i) => (
          <Instance key={i} position={[p[0], y + 1.2, p[1]]} rotation={[0, i * 1.1, 0]} />
        ))}
      </Instances>
    </>
  )
}

interface GableProps {
  /** Half-width of the base. */
  halfWidth: number
  /** Base to apex. */
  height: number
  /** Extrusion length along the ridge. */
  depth: number
  color?: string
  /** Position of the base centre. */
  position?: [number, number, number]
  /** Run the ridge along X instead of Z. */
  alongX?: boolean
}

/**
 * Triangular prism for pitched roofs and pediments. Built from a 3-segment
 * cylinder with thetaStart = PI, which puts a flat edge at the bottom and a
 * single apex on top — no ExtrudeGeometry, no shape parsing.
 *
 * Unrolled geometry axes: X is the base half-width (0.866 at radius 1), Y is
 * the extrusion, Z is the triangle height (1.5, apex at -Z). The inner mesh
 * rotation maps Z to +Y so the apex points up.
 */
export function Gable({
  halfWidth,
  height,
  depth,
  color = P.roof,
  position = [0, 0, 0],
  alongX = false,
}: GableProps) {
  return (
    <group position={position} rotation={[0, alongX ? Math.PI / 2 : 0, 0]}>
      <mesh
        position={[0, height / 3, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[halfWidth / 0.866, 1, height / 1.5]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[1, 1, depth, 3, 1, false, Math.PI]} />
        <meshStandardMaterial color={color} roughness={0.86} flatShading />
      </mesh>
    </group>
  )
}
