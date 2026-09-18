import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, DoubleSide, type InstancedMesh, type Material, Matrix4 } from 'three'
import { rand } from '@/lib/utils'
import { useAppStore, type InteriorZone } from '@/state/useAppStore'

/**
 * A seated, low-poly crowd with faces, drawn in three instanced batches —
 * boxes, spheres and hair caps — however many people there are. That is what
 * lets a phone draw a full auditorium: ~120 people is three draw calls, and the
 * per-frame work is plain matrix maths.
 *
 * Each person is posed from a handful of angles (lean, head yaw and pitch, arm
 * swing) driven by their seed, so no two move alike: they breathe, glance
 * around, nod, blink, whisper to a neighbour and occasionally raise a hand.
 * Panelists (`pose: 'desk'`) sit with their arms on a table, alternately
 * looking up at the presenter and writing notes.
 */

export interface Person {
  /** Seat surface under the hips, world space. */
  x: number
  y: number
  z: number
  /** 0 faces -z. */
  yaw: number
  skin: string
  hair: string
  top: string
  legs: string
  /** 0 short, 1 cropped, 2 long, 3 bun */
  hairStyle: 0 | 1 | 2 | 3
  tie?: string
  badge?: string
  pose: 'lap' | 'desk'
  seed: number
}

/** Box parts per person, in instance order. */
const NB = 21
/** Sphere parts per person: head, two eye whites, two pupils, bun. */
const NS = 6

const MOUTH = '#8c4a44'
const PUPIL = '#1b1a22'
const WHITE = '#f6f1ea'
const SHOE = '#1d1d24'

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

interface Props {
  people: Person[]
  /** Where everyone's attention goes — the presenter's head. */
  lookAt: [number, number, number]
  /** Animation runs only while the camera is at this station. */
  activeZone: InteriorZone
}

export function Crowd({ people, lookAt, activeZone }: Props) {
  const boxes = useRef<InstancedMesh>(null)
  const spheres = useRef<InstancedMesh>(null)
  const caps = useRef<InstancedMesh>(null)
  const primed = useRef(false)

  const m = useMemo(
    () => ({
      P: new Matrix4(),
      F: new Matrix4(),
      A: new Matrix4(),
      E: new Matrix4(),
      H: new Matrix4(),
      M: new Matrix4(),
      T: new Matrix4(),
      Z: new Matrix4().makeScale(0, 0, 0),
    }),
    [],
  )

  // Colours never change: set once.
  useLayoutEffect(() => {
    const b = boxes.current
    const s = spheres.current
    const c = caps.current
    if (!b || !s || !c) return
    const col = new Color()

    people.forEach((p, i) => {
      const bi = i * NB
      const si = i * NS
      const skinDark = new Color(p.skin).multiplyScalar(0.86)
      const box = (k: number, v: string | Color) => b.setColorAt(bi + k, typeof v === 'string' ? col.set(v) : v)
      const sph = (k: number, v: string) => s.setColorAt(si + k, col.set(v))

      box(0, p.top) // torso
      box(1, p.skin) // neck
      box(2, p.top) // upper arms
      box(3, p.top)
      box(4, p.top) // forearms
      box(5, p.top)
      box(6, p.skin) // hands
      box(7, p.skin)
      box(8, p.legs) // thighs
      box(9, p.legs)
      box(10, p.legs) // shins
      box(11, p.legs)
      box(12, SHOE)
      box(13, SHOE)
      box(14, p.hair) // brows
      box(15, p.hair)
      box(16, skinDark) // nose
      box(17, MOUTH)
      box(18, p.tie ?? p.top)
      box(19, p.hair) // long hair
      box(20, p.badge ?? p.top)

      sph(0, p.skin) // head
      sph(1, WHITE)
      sph(2, WHITE)
      sph(3, PUPIL)
      sph(4, PUPIL)
      sph(5, p.hair) // bun
      c.setColorAt(i, col.set(p.hair))
    })

    for (const mesh of [b, s, c]) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      ;(mesh.material as Material).needsUpdate = true
    }
    primed.current = false
  }, [people])

  const update = (t: number) => {
    const b = boxes.current
    const s = spheres.current
    const c = caps.current
    if (!b || !s || !c) return
    const { P, F, A, E, H, M, T, Z } = m
    const tr = (mat: Matrix4, x: number, y: number, z: number) => mat.multiply(T.makeTranslation(x, y, z))
    const rx = (mat: Matrix4, a: number) => mat.multiply(T.makeRotationX(a))
    const ry = (mat: Matrix4, a: number) => mat.multiply(T.makeRotationY(a))
    const sc = (mat: Matrix4, x: number, y: number, z: number) => mat.multiply(T.makeScale(x, y, z))
    const [lx, ly, lz] = lookAt

    for (let i = 0; i < people.length; i++) {
      const p = people[i]
      const bi = i * NB
      const si = i * NS
      const ph = rand(p.seed * 3.1) * Math.PI * 2
      const f = 0.7 + rand(p.seed * 5.3) * 0.6
      const desk = p.pose === 'desk'

      const breath = 1 + 0.02 * Math.sin(t * 1.7 * f + ph)
      // Positive leans back; panelists lean in toward the table.
      const lean = (desk ? -0.12 : 0.04) + 0.035 * Math.sin(t * 0.33 * f + ph)

      // Attention: face the presenter, then drift.
      const dx = lx - p.x
      const dz = lz - p.z
      let yaw = Math.atan2(-dx, -dz) - p.yaw
      let pitch = Math.atan2(ly - (p.y + 0.8), Math.hypot(dx, dz)) * 0.85
      const nod = -0.14 * Math.pow(Math.max(0, Math.sin(t * 1.25 * f + ph)), 10)

      // Arms as angles: `a` swings the upper arm forward, `tot` is the
      // forearm's pitch relative to the torso.
      let aR = desk ? 0.85 : 0.2
      let totR = desk ? 0 : -0.25
      const aL = aR
      const totL = totR

      if (desk) {
        // Alternate between looking up at the presenter and writing.
        const w = smooth(-0.25, 0.25, Math.sin(t * 0.21 * f + ph))
        yaw = lerp(yaw + 0.12 * Math.sin(t * 0.3 + ph), 0.15, w)
        pitch = lerp(pitch + nod, -0.55, w)
        aR += w * 0.05 * Math.sin(t * 9 + ph)
        totR += w * 0.06 * Math.sin(t * 7.3 + ph)
      } else {
        yaw += 0.3 * Math.sin(t * 0.23 * f + ph) * Math.sin(t * 0.11 + ph * 2)
        pitch += nod
        if (rand(p.seed * 7.7) < 0.08) {
          // Whispering to a neighbour now and then.
          const w = smooth(0.5, 0.8, Math.sin(t * 0.19 * f + ph))
          yaw += w * (rand(p.seed * 9.1) < 0.5 ? 1 : -1) * 1.05
          pitch -= w * 0.12
        }
        if (rand(p.seed * 11.3) < 0.04) {
          // A hand goes up.
          const r = smooth(0.72, 0.92, Math.sin(t * 0.17 + ph))
          aR = lerp(aR, -2.85, r)
          totR = lerp(totR, 1.5, r)
        }
      }
      const blink = (t * 0.23 * f + ph) % 1 < 0.025 ? 0.12 : 1

      // Body frames: P at the hips, F the (leaning) torso, H the head.
      P.makeTranslation(p.x, p.y, p.z)
      ry(P, p.yaw)
      F.copy(P)
      tr(F, 0, 0, 0.05)
      rx(F, lean)

      M.copy(F)
      tr(M, 0, 0.3, 0.03)
      sc(M, 0.44, 0.56 * breath, 0.26)
      b.setMatrixAt(bi, M)
      M.copy(F)
      tr(M, 0, 0.61, 0.03)
      sc(M, 0.1, 0.1, 0.1)
      b.setMatrixAt(bi + 1, M)

      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? -1 : 1
        const a = k === 0 ? aL : aR
        const tot = k === 0 ? totL : totR

        A.copy(F)
        tr(A, side * 0.26, 0.54, 0.03)
        rx(A, a)
        M.copy(A)
        tr(M, 0, -0.16, 0)
        sc(M, 0.1, 0.34, 0.11)
        b.setMatrixAt(bi + 2 + k, M)

        E.copy(A)
        tr(E, 0, -0.31, 0)
        rx(E, tot - a)
        M.copy(E)
        tr(M, 0, 0, -0.15)
        sc(M, 0.09, 0.09, 0.32)
        b.setMatrixAt(bi + 4 + k, M)
        M.copy(E)
        tr(M, 0, 0, -0.34)
        sc(M, 0.08, 0.06, 0.1)
        b.setMatrixAt(bi + 6 + k, M)

        M.copy(P)
        tr(M, side * 0.11, 0.06, -0.17)
        sc(M, 0.15, 0.13, 0.44)
        b.setMatrixAt(bi + 8 + k, M)
        M.copy(P)
        tr(M, side * 0.11, -0.2, -0.37)
        sc(M, 0.13, 0.46, 0.13)
        b.setMatrixAt(bi + 10 + k, M)
        M.copy(P)
        tr(M, side * 0.11, -0.43, -0.43)
        sc(M, 0.13, 0.07, 0.24)
        b.setMatrixAt(bi + 12 + k, M)
      }

      H.copy(F)
      tr(H, 0, 0.63, 0.03)
      ry(H, yaw)
      rx(H, pitch)

      M.copy(H)
      tr(M, 0, 0.15, 0)
      sc(M, 0.13, 0.155, 0.14)
      s.setMatrixAt(si, M)

      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? -1 : 1
        M.copy(H)
        tr(M, side * 0.048, 0.172, -0.133)
        sc(M, 0.028, 0.02 * blink, 0.01)
        s.setMatrixAt(si + 1 + k, M)
        M.copy(H)
        tr(M, side * 0.048, 0.17, -0.139)
        sc(M, 0.013, 0.015 * blink, 0.008)
        s.setMatrixAt(si + 3 + k, M)
        M.copy(H)
        tr(M, side * 0.05, 0.212, -0.131)
        sc(M, 0.05, 0.011, 0.012)
        b.setMatrixAt(bi + 14 + k, M)
      }

      M.copy(H)
      tr(M, 0, 0.14, -0.148)
      sc(M, 0.024, 0.045, 0.03)
      b.setMatrixAt(bi + 16, M)
      M.copy(H)
      tr(M, 0, 0.087, -0.128)
      sc(M, 0.058, 0.012, 0.012)
      b.setMatrixAt(bi + 17, M)

      if (p.tie) {
        M.copy(F)
        tr(M, 0, 0.4, -0.107)
        sc(M, 0.055, 0.3, 0.012)
        b.setMatrixAt(bi + 18, M)
      } else b.setMatrixAt(bi + 18, Z)

      if (p.hairStyle === 2) {
        M.copy(H)
        tr(M, 0, 0.08, 0.09)
        sc(M, 0.27, 0.28, 0.09)
        b.setMatrixAt(bi + 19, M)
      } else b.setMatrixAt(bi + 19, Z)

      if (p.badge) {
        M.copy(F)
        tr(M, 0.13, 0.42, -0.107)
        sc(M, 0.06, 0.085, 0.012)
        b.setMatrixAt(bi + 20, M)
      } else b.setMatrixAt(bi + 20, Z)

      if (p.hairStyle === 3) {
        M.copy(H)
        tr(M, 0, 0.25, 0.11)
        sc(M, 0.065, 0.065, 0.065)
        s.setMatrixAt(si + 5, M)
      } else s.setMatrixAt(si + 5, Z)

      // Hair cap tipped back so the forehead shows.
      M.copy(H)
      tr(M, 0, 0.165, 0.012)
      rx(M, 0.3)
      sc(M, 0.142, p.hairStyle === 1 ? 0.09 : 0.135, 0.152)
      c.setMatrixAt(i, M)
    }

    b.instanceMatrix.needsUpdate = true
    s.instanceMatrix.needsUpdate = true
    c.instanceMatrix.needsUpdate = true
  }

  useFrame((state) => {
    const here = useAppStore.getState().interiorZone === activeZone
    if (!here && primed.current) return
    update(state.clock.elapsedTime)
    primed.current = true
  })

  const count = people.length
  return (
    <group>
      <instancedMesh ref={boxes} args={[undefined, undefined, count * NB]} frustumCulled={false} raycast={() => null}>
        <boxGeometry />
        <meshStandardMaterial roughness={0.78} />
      </instancedMesh>
      <instancedMesh ref={spheres} args={[undefined, undefined, count * NS]} frustumCulled={false} raycast={() => null}>
        <sphereGeometry args={[1, 14, 10]} />
        <meshStandardMaterial roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={caps} args={[undefined, undefined, count]} frustumCulled={false} raycast={() => null}>
        <sphereGeometry args={[1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial roughness={0.9} side={DoubleSide} />
      </instancedMesh>
    </group>
  )
}
