import { Component, type ReactNode, useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { type Bone, DoubleSide, type Group, type Mesh, MeshStandardMaterial, type Object3D, Quaternion, Vector3 } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { rand } from '@/lib/utils'
import { useAppStore, type InteriorZone } from '@/state/useAppStore'

/**
 * Realistic seated people, built in Blender from MakeHuman (MPFB, CC0 assets):
 * one skinned mesh and one texture per person, exported already seated.
 *
 * Each clone keeps its own skeleton and its own attention. Every few seconds a
 * person picks something to do — watch the presenter, glance at notes, look
 * around — and their head eases there. Neighbours pair up and hold silent
 * conversations: they turn to each other and take turns talking, the speaker
 * gesturing and nodding in rhythm. Arms are aimed at natural targets (hands on
 * laps, forearms on the panel's table, a bent-elbow raised hand) rather than
 * rotated by fixed angles, so they read right whatever the rest pose.
 */

const DRACO_PATH = '/draco/'
const modelUrl = (id: string) => `/models/people/${id}.glb`

/**
 * By seat, x = -2.4 … 2.4. The presenter faces +z, so index 0 is the right end
 * of the table on screen. The chair takes the centre seat behind the gold plate.
 */
export const PANEL_CAST = ['panel_5', 'panel_4', 'panel_chair', 'panel_2', 'panel_3'] as const
/** Front rows: double-resolution textures, so faces read from the stage. */
export const FRONT_CAST = ['front_1', 'front_2', 'front_3', 'front_4', 'front_5', 'front_6', 'front_7', 'front_8'] as const
export const AUDIENCE_CAST = [
  'aud_1', 'aud_2', 'aud_3', 'aud_4', 'aud_5', 'aud_6', 'aud_7', 'aud_8', 'aud_9', 'aud_10', 'aud_11', 'aud_12',
] as const

export interface SeatedPerson {
  /** Stable seat id — what a raised hand refers to. */
  id: number
  model: string
  /** Seat surface under the hips, world space. */
  x: number
  y: number
  z: number
  /** 0 faces -z, toward the stage. */
  yaw: number
  role: 'panel' | 'audience'
  seed: number
}

interface Prepared {
  scene: Group
  /** Height of the seat contact below the model origin. */
  seatY: number
}

type BoneKey = 'spine2' | 'spine3' | 'neck' | 'head' | 'upperL' | 'lowerL' | 'handL' | 'upperR' | 'lowerR' | 'handR'
const BONE_NAMES: Record<BoneKey, string> = {
  spine2: 'spine_02',
  spine3: 'spine_03',
  neck: 'neck_01',
  head: 'head',
  upperL: 'upperarm_l',
  lowerL: 'lowerarm_l',
  handL: 'hand_l',
  upperR: 'upperarm_r',
  lowerR: 'lowerarm_r',
  handR: 'hand_r',
}
/** The child each arm bone points at: its direction is bone head → child head. */
const AIM_CHILD: Partial<Record<BoneKey, string>> = {
  upperL: 'lowerarm_l',
  lowerL: 'hand_l',
  handL: 'middle_01_l',
  upperR: 'lowerarm_r',
  lowerR: 'hand_r',
  handR: 'middle_01_r',
}

/** Arm pose as [forward, up, outward] coefficients for upper arm, forearm and hand. */
type ArmPose = [number, number, number][]
const LAP: ArmPose = [[0.3, -0.92, 0.08], [0.8, -0.5, -0.2], [0.7, -0.7, -0.15]]
const DESK: ArmPose = [[0.62, -0.75, 0.1], [0.95, -0.12, -0.3], [1, -0.25, -0.2]]
/** Notes or a phone held low in front. */
const DOWN: ArmPose = [[0.4, -0.9, 0.02], [0.85, -0.05, -0.45], [0.9, 0.1, -0.4]]
const RAISE: ArmPose = [[0.35, 0.6, 0.35], [0.12, 1, -0.08], [0.05, 1, 0]]

interface Rig {
  root: Group
  person: SeatedPerson
  bones: Partial<Record<BoneKey, Bone>>
  rest: Map<Bone, Quaternion>
  aimAxis: Map<Bone, Vector3>
  /** World forward and right of the seated body. */
  F: Vector3
  R: Vector3
  /** Index of the conversation partner in the rig list, or -1. */
  partner: number
  pairSeed: number
  /** Smoothed state — what the person is actually doing right now. */
  s: { yaw: number; pitch: number; lean: number; raise: number; write: number; down: number; gesture: number }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
/** Two small dips of the head midway through a beat. */
const nodCurve = (phase: number) => {
  const u = (phase - 0.35) / 0.25
  return u > 0 && u < 1 ? -0.1 * Math.abs(Math.sin(u * Math.PI * 2)) : 0
}

/**
 * Once per model: swap in a plain standard material and find the seat height.
 *
 * The exported material is flagged BLEND because hair and lashes carry alpha,
 * and GLTFLoader turns depthWrite off for BLEND — triangles then draw in any
 * order and hair paints over faces. A cut-out standard material fixes that and
 * is cheaper than the physical material glTF would otherwise produce.
 */
function prepare(scene: Group, anisotropy: number): Prepared {
  scene.updateMatrixWorld(true)
  const pelvis = scene.getObjectByName('pelvis')
  const pelvisPos = pelvis ? pelvis.getWorldPosition(new Vector3()) : new Vector3()
  let material: MeshStandardMaterial | null = null
  let seatY = 0
  const v = new Vector3()

  scene.traverse((o: Object3D) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const source = mesh.material as MeshStandardMaterial
    if (!material) {
      // Faces are seen at a grazing angle from the stage; anisotropic
      // filtering keeps eyes and brows from smearing into the skin.
      if (source.map) {
        source.map.anisotropy = anisotropy
        source.map.needsUpdate = true
      }
      material = new MeshStandardMaterial({ map: source.map, alphaTest: 0.5, roughness: 0.62, metalness: 0, side: DoubleSide })
    }
    mesh.material = material
    mesh.frustumCulled = false

    const pos = mesh.geometry.attributes.position
    let min = Infinity
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      if (Math.abs(v.z - pelvisPos.z) < 0.12 && v.y < min) min = v.y
    }
    if (Number.isFinite(min)) seatY = min
  })
  return { scene, seatY }
}

/** Pairs neighbours for silent conversations: side by side in a row, never shared. */
function pairUp(seats: SeatedPerson[]): { partner: number[]; pairSeed: number[] } {
  const partner = seats.map(() => -1)
  const pairSeed = seats.map(() => 0)
  const order = seats
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.z - b.s.z || a.s.x - b.s.x)
  for (let k = 0; k < order.length - 1; k++) {
    const a = order[k]
    const b = order[k + 1]
    if (partner[a.i] >= 0 || partner[b.i] >= 0) continue
    if (a.s.role !== b.s.role || Math.abs(a.s.z - b.s.z) > 0.05) continue
    const gap = Math.abs(a.s.x - b.s.x)
    const maxGap = a.s.role === 'panel' ? 1.7 : 0.9
    // The chair of the panel (x = 0) presides rather than chatting.
    if (gap > maxGap || (a.s.role === 'panel' && (Math.abs(a.s.x) < 0.1 || Math.abs(b.s.x) < 0.1))) continue
    if (a.s.role === 'audience' && rand(a.s.seed * 19.1) > 0.42) continue
    partner[a.i] = b.i
    partner[b.i] = a.i
    pairSeed[a.i] = pairSeed[b.i] = Math.min(a.s.seed, b.s.seed) + 0.5
  }
  return { partner, pairSeed }
}

interface Props {
  seats: SeatedPerson[]
  /** The presenter's head — where attention goes. */
  lookAt: [number, number, number]
  /** Animation runs only while the camera is at this station. */
  activeZone: InteriorZone
  /** Whether this group supplies the audience that can raise hands (the auditorium). */
  reportAudience?: boolean
}

export function People({ seats, lookAt, activeZone, reportAudience = true }: Props) {
  const models = useMemo(() => [...new Set(seats.map((s) => s.model))], [seats])
  const gltfs = useGLTF(models.map(modelUrl), DRACO_PATH) as unknown as { scene: Group }[]
  const setAudienceIds = useAppStore((s) => s.setAudienceIds)
  const gl = useThree((s) => s.gl)

  const prepared = useMemo(
    () => new Map(models.map((id, i) => [id, prepare(gltfs[i].scene, gl.capabilities.getMaxAnisotropy())])),
    [models, gltfs, gl],
  )

  const rigs = useMemo<Rig[]>(() => {
    const { partner, pairSeed } = pairUp(seats)
    return seats.map((person, index) => {
      const model = prepared.get(person.model)!
      const root = cloneSkinned(model.scene) as Group
      root.position.set(person.x, person.y - model.seatY, person.z)
      // Models face +z; a yaw of 0 should face the stage (-z).
      root.rotation.y = person.yaw + Math.PI
      root.traverse((o) => {
        o.raycast = () => null
      })
      root.updateMatrixWorld(true)

      const bones: Rig['bones'] = {}
      const rest = new Map<Bone, Quaternion>()
      const aimAxis = new Map<Bone, Vector3>()
      for (const key of Object.keys(BONE_NAMES) as BoneKey[]) {
        const bone = root.getObjectByName(BONE_NAMES[key]) as Bone | undefined
        if (!bone) continue
        bones[key] = bone
        rest.set(bone, bone.quaternion.clone())
        const childName = AIM_CHILD[key]
        const child = childName ? bone.children.find((c) => c.name === childName) : undefined
        if (child) aimAxis.set(bone, child.position.clone().normalize())
      }

      const up = new Vector3(0, 1, 0)
      const R = new Vector3(1, 0, 0)
      if (bones.upperR && bones.upperL) {
        R.copy(bones.upperR.getWorldPosition(new Vector3()).sub(bones.upperL.getWorldPosition(new Vector3())))
        R.y = 0
        R.normalize()
      }
      const F = new Vector3().crossVectors(up, R).normalize()

      return {
        root,
        person,
        bones,
        rest,
        aimAxis,
        F,
        R,
        partner: partner[index],
        pairSeed: pairSeed[index],
        s: { yaw: 0, pitch: 0, lean: 0, raise: 0, write: 0, down: 0, gesture: 0 },
      }
    })
  }, [seats, prepared])

  // Only people the presenter can actually see may ask: a hand raised outside
  // the frame is a question nobody knows about.
  useEffect(() => {
    if (!reportAudience) return
    const [lx, , lz] = lookAt
    const visible = seats
      .filter((s) => s.role === 'audience')
      .map((s) => ({ id: s.id, spread: Math.abs(s.x - lx) / Math.max(1, s.z - lz) }))
      .filter((s) => s.spread < 0.16)
      .map((s) => s.id)
    setAudienceIds(visible)
    return () => setAudienceIds([])
  }, [seats, lookAt, setAudienceIds, reportAudience])

  const tmp = useMemo(
    () => ({
      parent: new Quaternion(),
      parentInv: new Quaternion(),
      world: new Quaternion(),
      rot: new Quaternion(),
      yawQ: new Quaternion(),
      pitchQ: new Quaternion(),
      up: new Vector3(0, 1, 0),
      right: new Vector3(),
      from: new Vector3(),
      dir: new Vector3(),
      side: new Vector3(),
    }),
    [],
  )

  /**
   * Turn a bone by a yaw about world up and a pitch about the person's own
   * right axis, on top of its rest pose. Children inherit, so increments add
   * down the chain.
   */
  const turn = (rig: Rig, bone: Bone | undefined, yaw: number, pitch: number) => {
    if (!bone || !bone.parent) return
    const rest = rig.rest.get(bone)
    if (!rest) return
    const facing = rig.root.rotation.y + yaw
    tmp.right.set(Math.cos(facing), 0, -Math.sin(facing))
    tmp.yawQ.setFromAxisAngle(tmp.up, yaw)
    tmp.pitchQ.setFromAxisAngle(tmp.right, -pitch).multiply(tmp.yawQ)
    bone.parent.getWorldQuaternion(tmp.parent)
    tmp.parentInv.copy(tmp.parent).invert()
    bone.quaternion.copy(tmp.parentInv).multiply(tmp.pitchQ).multiply(tmp.parent).multiply(rest)
  }

  /** Point a bone at a world direction: the shortest rotation from its rest direction. */
  const aim = (rig: Rig, bone: Bone | undefined, c: [number, number, number], side: 1 | -1) => {
    if (!bone || !bone.parent) return
    const rest = rig.rest.get(bone)
    const axis = rig.aimAxis.get(bone)
    if (!rest || !axis) return
    tmp.side.copy(rig.R).multiplyScalar(side)
    tmp.dir.set(0, 0, 0).addScaledVector(rig.F, c[0]).addScaledVector(tmp.up, c[1]).addScaledVector(tmp.side, c[2]).normalize()
    bone.parent.getWorldQuaternion(tmp.parent)
    tmp.world.copy(tmp.parent).multiply(rest)
    tmp.from.copy(axis).applyQuaternion(tmp.world)
    tmp.rot.setFromUnitVectors(tmp.from, tmp.dir)
    tmp.parentInv.copy(tmp.parent).invert()
    bone.quaternion.copy(tmp.parentInv).multiply(tmp.rot).multiply(tmp.parent).multiply(rest)
  }

  const mix = (a: ArmPose, b: ArmPose, w: number): ArmPose =>
    a.map((c, i) => [c[0] + (b[i][0] - c[0]) * w, c[1] + (b[i][1] - c[1]) * w, c[2] + (b[i][2] - c[2]) * w])

  useFrame((state, delta) => {
    const store = useAppStore.getState()
    if (store.interiorZone !== activeZone) return
    const raised = store.raisedHands
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    const [lx, ly, lz] = lookAt
    const headEase = 1 - Math.exp(-dt * 3.2)
    const postureEase = 1 - Math.exp(-dt * 1.1)
    const armEase = 1 - Math.exp(-dt * 3)

    for (const rig of rigs) {
      const p = rig.person
      const s = rig.s
      const b = rig.bones
      const ph = rand(p.seed * 3.1) * Math.PI * 2
      const facing = rig.root.rotation.y
      const panel = p.role === 'panel'
      const hand = raised.includes(p.id)

      const dx = lx - p.x
      const dz = lz - p.z
      const yawTo = wrap(Math.atan2(dx, dz) - facing)
      const pitchTo = Math.atan2(ly - (p.y + 0.75), Math.hypot(dx, dz))

      // A "beat" is one thing a person does; its length is personal.
      const beat = 2.4 + rand(p.seed * 2.1) * 3.6
      const clock = t + rand(p.seed * 4.4) * beat * 3
      const k = Math.floor(clock / beat)
      const phase = clock / beat - k
      const r = rand(p.seed * 17.3 + k * 7.13)

      // Silent conversation with a neighbour, on a schedule both of them share.
      let talking = false
      let speaking = false
      if (rig.partner >= 0) {
        const other = rigs[rig.partner]
        const ps = rig.pairSeed
        const cycle = 13 + rand(ps * 2.9) * 9
        const cph = ((t + rand(ps * 5.7) * cycle) / cycle) % 1
        talking = cph < (panel ? 0.22 : 0.5) && !hand && !raised.includes(other.person.id)
        if (talking) {
          const turnLen = 1.6 + rand(ps * 3.3) * 1.4
          const firstSpeaks = rand(ps * 7.1 + Math.floor(t / turnLen) * 1.37) < 0.5
          speaking = firstSpeaks === p.id < other.person.id
        }
      }

      let tYaw = yawTo
      let tPitch = pitchTo
      let tWrite = 0
      let tDown = 0
      let tGesture = 0
      let nod = 0
      let yawLimit = 1.15
      // Posture drifts on a slower clock than attention.
      let tLean = (rand(p.seed * 5.9 + Math.floor((t + p.seed) / 11) * 3.7) - 0.4) * 0.12

      if (hand) {
        // Waiting to be picked: eyes on the presenter, leaning in.
        tPitch = pitchTo + 0.06
        tLean = -0.06
      } else if (talking) {
        const other = rigs[rig.partner].person
        tYaw = wrap(Math.atan2(other.x - p.x, other.z - p.z) - facing)
        tPitch = -0.04
        tLean = -0.05
        yawLimit = 1.45
        if (speaking) {
          tGesture = 1
          nod = 0.035 * Math.sin(t * 6.5 + ph) + 0.02 * Math.sin(t * 10.1 + ph)
        } else {
          nod = nodCurve(phase) * 0.8
        }
      } else if (panel) {
        if (r < 0.5) {
          tWrite = 1
          tPitch = -0.55
          tYaw = 0.12 * (rand(p.seed + k) - 0.5)
          tLean = -0.08
        } else if (rand(p.seed * 9.7 + k) < 0.5) {
          nod = nodCurve(phase)
        }
      } else if (r < 0.66) {
        tYaw += (rand(p.seed + k * 3.3) - 0.5) * 0.18
        tPitch += (rand(p.seed + k * 5.1) - 0.5) * 0.1
        if (rand(p.seed * 9.7 + k) < 0.35) nod = nodCurve(phase)
      } else if (r < 0.82) {
        tPitch = -0.5
        tYaw *= 0.25
        tDown = 1
      } else {
        tYaw += (rand(p.seed * 2.7 + k) - 0.5) * 1.3
        tPitch += (rand(p.seed * 3.9 + k) - 0.5) * 0.35
      }

      s.yaw += (clamp(tYaw, -yawLimit, yawLimit) - s.yaw) * headEase
      s.pitch += (clamp(tPitch, -0.65, 0.5) - s.pitch) * headEase
      s.lean += (tLean - s.lean) * postureEase
      s.raise += ((hand ? 1 : 0) - s.raise) * armEase
      s.write += (tWrite - s.write) * armEase
      s.down += (tDown - s.down) * armEase
      s.gesture += (tGesture - s.gesture) * armEase

      const breath = 0.012 * Math.sin(t * 1.5 + ph)
      const yaw = s.yaw + 0.025 * Math.sin(t * 0.9 + ph * 1.7)
      const pitch = s.pitch + 0.02 * Math.sin(t * 1.3 + ph) + nod

      // Torso and head, parents first.
      turn(rig, b.spine2, yaw * 0.08, -s.lean * 0.5 + breath)
      turn(rig, b.spine3, yaw * 0.14, -s.lean * 0.5 + breath * 0.6)
      turn(rig, b.neck, yaw * 0.3, pitch * 0.4)
      turn(rig, b.head, yaw * 0.48, pitch * 0.6)

      // Arms: a resting pose, blended toward notes, gesturing, or a raised hand.
      let left = mix(panel ? DESK : LAP, DOWN, s.down)
      let right = mix(panel ? DESK : LAP, DOWN, s.down)
      if (s.write > 0.01) {
        right = right.map((c, i) => (i === 0 ? c : [c[0], c[1], c[2] + 0.06 * Math.sin(t * 9 + ph) * s.write])) as ArmPose
      }
      if (s.gesture > 0.01) {
        const g = Math.sin(t * 3.1 + ph)
        const gesture: ArmPose = [
          [0.45, -0.85, 0.12],
          [0.85, 0.12 + 0.15 * g, 0.12 + 0.12 * Math.sin(t * 2.3 + ph)],
          [0.8, 0.4 + 0.2 * g, 0.1],
        ]
        right = mix(right, gesture, s.gesture)
      }
      if (s.raise > 0.01) {
        const wave: ArmPose = RAISE.map((c, i) => (i === 2 ? [c[0] + 0.08 * Math.sin(t * 4 + ph), c[1], c[2]] : c)) as ArmPose
        right = mix(right, wave, s.raise)
        left = mix(left, LAP, s.raise * 0.5)
      }
      aim(rig, b.upperR, right[0], 1)
      aim(rig, b.lowerR, right[1], 1)
      aim(rig, b.handR, right[2], 1)
      aim(rig, b.upperL, left[0], -1)
      aim(rig, b.lowerL, left[1], -1)
      aim(rig, b.handL, left[2], -1)
    }
  })

  return (
    <group>
      {rigs.map((rig) => (
        <primitive key={rig.person.id} object={rig.root} />
      ))}
    </group>
  )
}

/**
 * Until every model exists — or if one fails to load — the stylised crowd
 * stands in, rather than taking the whole scene down with it.
 */
export class PeopleBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.info('[Atrium] realistic people unavailable, using the stylised crowd:', error.message)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
