import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { BufferAttribute, Color, type Material, type Mesh, MeshStandardMaterial, type Object3D, Vector3 } from 'three'

/**
 * The whole city fabric — ground, bay, roads, park, buildings, trees, cars —
 * exported from Blender as one Draco-compressed GLB (~1 MB).
 *
 * The decoder is served from `public/draco/` rather than drei's default CDN so
 * the installed app keeps working offline.
 */
const MODEL_URL = '/models/talkville.glb'
const DRACO_PATH = '/draco/'

type RGB = [number, number, number]

interface WindowSpec {
  /** Linear RGB, straight from the Blender materials. */
  wall: RGB
  glass: RGB
  /** Window bands per world unit of height. */
  floors: number
  /** Mullion repeats per world unit along the facade. */
  cols: number
  /** Share of each floor band that is glass. */
  win: number
  /** Share of each bay that is glass. */
  colw: number
  metal: number
  glow: number
  glowColor?: RGB
}

/**
 * Blender's window grids are procedural node trees, which glTF cannot carry.
 * They are rebuilt here from the same parameters, keyed by material name.
 */
const WINDOWS: Record<string, WindowSpec> = {
  TV_W_GlassTower: { wall: [0.42, 0.52, 0.6], glass: [0.07, 0.19, 0.33], floors: 1, cols: 1.2, win: 0.75, colw: 0.88, metal: 0.6, glow: 0 },
  TV_W_Beige: { wall: [0.8, 0.63, 0.45], glass: [0.12, 0.15, 0.19], floors: 1, cols: 0.9, win: 0.6, colw: 0.8, metal: 0.4, glow: 0.6 },
  TV_W_White: { wall: [0.86, 0.8, 0.7], glass: [0.15, 0.24, 0.32], floors: 1, cols: 0.9, win: 0.6, colw: 0.8, metal: 0.4, glow: 0.3 },
  TV_W_Grey: { wall: [0.6, 0.56, 0.52], glass: [0.13, 0.19, 0.26], floors: 1, cols: 0.9, win: 0.6, colw: 0.8, metal: 0.4, glow: 0.3 },
  TV_W_Brick: { wall: [0.56, 0.29, 0.18], glass: [0.12, 0.14, 0.18], floors: 1, cols: 0.9, win: 0.6, colw: 0.8, metal: 0.4, glow: 0.8 },
  TV_W_Stone: { wall: [0.82, 0.72, 0.58], glass: [0.14, 0.13, 0.15], floors: 0.8, cols: 0.7, win: 0.5, colw: 0.45, metal: 0.4, glow: 0.6 },
  TV_W_MallGlass: { wall: [0.9, 0.88, 0.84], glass: [0.22, 0.2, 0.18], floors: 0.5, cols: 1.3, win: 0.9, colw: 0.85, metal: 0.4, glow: 4, glowColor: [1, 0.7, 0.4] },
  TV_W_PracticeGlass: { wall: [0.92, 0.92, 0.9], glass: [0.18, 0.3, 0.38], floors: 0.3, cols: 1.4, win: 0.92, colw: 0.8, metal: 0.5, glow: 1 },
}

/** Blender's lit windows were tuned for EEVEE; the realtime AgX grade needs a little less. */
const GLOW_SCALE = 0.55

/** Big flat or distant pieces gain nothing from casting into the shadow map. */
const NO_CAST = new Set(['TV_Water', 'TV_Land', 'TV_Bay', 'TV_Roads'])

/**
 * Nothing shades the water or the far shore, and with the sun this low they
 * self-shadow at grazing angles — which draws the shadow frustum's edge as a
 * hard rectangle across the bay.
 */
const NO_RECEIVE = new Set(['TV_Water', 'TV_Bay'])

/**
 * The far shore reads as distant land only with some atmospheric haze: a
 * bright green plain pulls it forward and makes the bay look like a lake.
 * Blue-leaning greens let it recede behind the city, as in the map art.
 */
const RECOLOUR: Record<string, string> = {
  TV_FarLand: '#55705c',
  TV_HillGreen: '#4d6758',
}

function windowMaterial(name: string, spec: WindowSpec) {
  const material = new MeshStandardMaterial({ name, color: new Color(...spec.wall), roughness: 0.75, metalness: 0 })
  const glow = spec.glowColor ?? [1, 0.75, 0.45]

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uGlass: { value: new Color(...spec.glass) },
      uGlow: { value: new Color(...glow) },
      uGlowStrength: { value: spec.glow * GLOW_SCALE },
      uFloors: { value: spec.floors },
      uCols: { value: spec.cols },
      uWin: { value: spec.win },
      uColW: { value: spec.colw },
      uMetal: { value: spec.metal },
    })

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTvWorld;\nvarying vec3 vTvNormal;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vTvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTvNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )

    // Same maths as the Blender node tree. Blender's X+Y becomes X-Z after the
    // Y-up conversion. Horizontal faces are excluded explicitly: Draco
    // quantisation nudges roof heights off whole numbers, which would
    // otherwise paint windows onto roofs.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTvWorld;
        varying vec3 vTvNormal;
        uniform vec3 uGlass;
        uniform vec3 uGlow;
        uniform float uGlowStrength, uFloors, uCols, uWin, uColW, uMetal;
        float tvWindowMask() {
          float band = step(1.0 - uWin, fract(vTvWorld.y * uFloors));
          float bay = 1.0 - step(uColW, fract((vTvWorld.x - vTvWorld.z) * uCols));
          float facade = 1.0 - step(0.5, abs(vTvNormal.y));
          return band * bay * facade;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat tvMask = tvWindowMask();\ndiffuseColor.rgb = mix(diffuseColor.rgb, uGlass, tvMask);',
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.1, tvMask);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, uMetal, tvMask);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlow * (uGlowStrength * tvMask);')
  }
  // One program for every window material; the uniforms stay per material.
  material.customProgramCacheKey = () => 'tv-window'
  return material
}

/**
 * Buildings taken out of the model, where the city has changed since the Blender export: every
 * triangle of `node` whose centre lies in the box (world x/z, above `minY`) is dropped once, on load.
 * The waterfront restaurant made way for the Brain Lab (drawn by `LabBuilding`); the ground and the
 * deck stay.
 */
export const CUTOUTS: { node: string; center: [number, number]; half: [number, number]; minY: number }[] = [
  { node: 'TV_Waterfront', center: [23.5, -24.5], half: [11.5, 11.5], minY: 0.25 },
]

/**
 * Drops, from `mesh`, every connected piece (a house, a roof, an umbrella: triangles sharing corners)
 * whose centre lies in one of the boxes. Whole pieces only, so nothing is left half-cut.
 */
function cutOut(mesh: Mesh, boxes: typeof CUTOUTS) {
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  if (!position) return
  const count = geometry.index ? geometry.index.count : position.count
  const corner = (i: number) => (geometry.index ? geometry.index.getX(i) : i)

  // Corners at the same place are one vertex, even when the export split them (per-face normals).
  const vertexOf = new Int32Array(position.count)
  const seen = new Map<string, number>()
  for (let v = 0; v < position.count; v++) {
    const key = `${position.getX(v).toFixed(3)},${position.getY(v).toFixed(3)},${position.getZ(v).toFixed(3)}`
    let id = seen.get(key)
    if (id === undefined) {
      id = seen.size
      seen.set(key, id)
    }
    vertexOf[v] = id
  }
  const parent = Int32Array.from({ length: seen.size }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (let i = 0; i + 2 < count; i += 3) {
    const r0 = find(vertexOf[corner(i)])
    parent[find(vertexOf[corner(i + 1)])] = r0
    parent[find(vertexOf[corner(i + 2)])] = r0
  }

  // Each piece's bounds in world space.
  const bounds = new Map<number, [number, number, number, number, number]>() // minX, maxX, minY, minZ, maxZ
  const p = new Vector3()
  for (let v = 0; v < position.count; v++) {
    p.fromBufferAttribute(position, v).applyMatrix4(mesh.matrixWorld)
    const root = find(vertexOf[v])
    const b = bounds.get(root)
    if (!b) bounds.set(root, [p.x, p.x, p.y, p.z, p.z])
    else {
      b[0] = Math.min(b[0], p.x)
      b[1] = Math.max(b[1], p.x)
      b[2] = Math.min(b[2], p.y)
      b[3] = Math.min(b[3], p.z)
      b[4] = Math.max(b[4], p.z)
    }
  }
  const dropped = new Set<number>()
  for (const [root, [x0, x1, y0, z0, z1]] of bounds) {
    const x = (x0 + x1) / 2
    const z = (z0 + z1) / 2
    // The ground and the deck are one big flat piece that reaches under everything: never inside.
    const inside = boxes.some(
      (box) =>
        y0 > box.minY - 0.3 &&
        x1 - x0 < box.half[0] * 2 &&
        z1 - z0 < box.half[1] * 2 &&
        Math.abs(x - box.center[0]) < box.half[0] &&
        Math.abs(z - box.center[1]) < box.half[1],
    )
    if (inside) dropped.add(root)
  }
  if (!dropped.size) return
  const kept: number[] = []
  for (let i = 0; i + 2 < count; i += 3) {
    if (!dropped.has(find(vertexOf[corner(i)]))) kept.push(corner(i), corner(i + 1), corner(i + 2))
  }
  const IndexArray = position.count > 65535 ? Uint32Array : Uint16Array
  geometry.setIndex(new BufferAttribute(new IndexArray(kept), 1))
}

function prepare(root: Object3D) {
  const windows = new Map<string, Material>()
  root.updateMatrixWorld(true)

  for (const top of root.children) {
    const cast = !NO_CAST.has(top.name)
    const receive = !NO_RECEIVE.has(top.name)
    const cuts = CUTOUTS.filter((c) => c.node === top.name)
    top.traverse((o) => {
      // Only the per-location proxies are raycast targets.
      o.raycast = () => null
      const mesh = o as Mesh
      if (!mesh.isMesh) return

      mesh.castShadow = cast
      mesh.receiveShadow = receive
      if (cuts.length) cutOut(mesh, cuts)

      const original = mesh.material as Material
      const recolour = RECOLOUR[original.name]
      if (recolour) (original as MeshStandardMaterial).color.set(recolour)
      if (original.name === 'TV_Water') {
        // Mirror-smooth water reflects the environment's rectangular light
        // panels as hard-edged slabs across the bay. Enough roughness blurs
        // them into a sheen and keeps the deep blue of the render.
        const water = original as MeshStandardMaterial
        water.roughness = 0.32
        water.metalness = 0.05
        water.envMapIntensity = 0.3
      }
      const spec = WINDOWS[original.name]
      if (!spec) return
      let replacement = windows.get(original.name)
      if (!replacement) {
        replacement = windowMaterial(original.name, spec)
        windows.set(original.name, replacement)
      }
      mesh.material = replacement
      original.dispose()
    })
  }
}

export function TalkVilleModel() {
  const { scene } = useGLTF(MODEL_URL, DRACO_PATH)
  useMemo(() => prepare(scene), [scene])
  return <primitive object={scene} />
}

useGLTF.preload(MODEL_URL, DRACO_PATH)
