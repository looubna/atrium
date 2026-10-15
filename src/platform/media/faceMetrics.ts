import type { FaceLandmarker, NormalizedLandmark, PoseLandmarker } from '@mediapipe/tasks-vision'
import {
  MAX_HAND_PATH,
  faceWidth,
  p95,
  poseFeatures,
  poseSlot,
  wristTravel,
  type Point,
  type PoseFeatures,
} from './bodyFeatures'

/**
 * On-device face and body measurements during an interview: whether the candidate looks
 * at the camera, smiles, and how much their head moves — and, with body tracking, whether
 * their shoulders, hands and whole body are in frame and whether their hands are up at their
 * head or face. Frames are analysed on the device and discarded; only per-second numbers are
 * kept and uploaded.
 *
 * The body half exists because a face tracker cannot see hands: someone holding their head
 * through a whole interview measured as perfectly calm.
 */

/** Served by the app itself (see vite.config.ts), so it works offline and inside the iOS app. */
const WASM_BASE = '/models/mediapipe/wasm'
const MODEL_PATH = '/models/mediapipe/face_landmarker.task'
const POSE_MODEL_PATH = '/models/mediapipe/pose_landmarker_lite.task'
/**
 * Body tracking runs with every face sample, so sway and repeated gestures can be seen; on a device
 * where it is slow it drops to every other sample, which still serves posture and framing.
 */
const POSE_EVERY_SLOW = 2
/** Pose detection slower than this (95th percentile, ms) halves the body-tracking rate. */
const SLOW_POSE_MS = 40
/** Timings kept to judge that. */
const POSE_TIMINGS = 20
/** A landmark counts as in frame above this visibility, and inside the image. */
const VISIBLE = 0.5
/** A wrist closer to the nose than this many shoulder-widths is up at the head or face. */
const HAND_AT_FACE_SHOULDERS = 0.9
const SAMPLES_PER_SECOND = 4
/** Head turned or tilted further than this (degrees) is not looking at the camera. */
const LOOK_AWAY_DEGREES = 15
/** Eye-direction blendshape score above which the eyes are looking away. */
const EYES_AWAY = 0.55
/** In person the interviewers are on the screen below the camera: a wider allowance counts as looking at them. */
const SCREEN_DEGREES = 25
/** Head yaw beyond this (degrees) is turned toward a side seat. */
const SEAT_YAW_DEGREES = 8
/** Head rotation faster than this (degrees per second) counts as restless movement. */
const RESTLESS_DEGREES_PER_SECOND = 25
/**
 * Below this average brightness (0-255) the face is too dark for its eyes to be read. The tracker
 * still finds a dim face, but its eye-direction scores then sit near zero — which reads as "looking
 * at the camera". So in the dark the eyes are not judged at all, and nobody scores well by default.
 */
export const DARK_LUMA = 50
/** The frame is shrunk to this width to measure brightness: plenty for an average, and cheap. */
const LUMA_WIDTH = 64

/** One second of the interview, as fractions of that second's samples. */
export interface FaceSecond {
  /** Seconds on the session's media clock. */
  t: number
  /** A face was found. */
  present: number
  /** Looking at the camera, among the samples where the face was clear enough to judge. */
  eye: number
  /**
   * The picture was clear enough to judge: the face, when one was found, or else the whole frame,
   * was bright enough. Low means too dark: an absent face or unread eyes say nothing then.
   */
  clear?: number
  /** Average smile strength (0..1), while present. */
  smile: number
  /** Restless head movement, while present. */
  move: number
  /** In-person panels: turned toward the seat of whoever was speaking, while present. */
  toSpeaker?: number
  /** Body tracking, when it could run: shoulders in frame. */
  body?: number
  /** Body tracking: at least one hand in frame. */
  hands?: number
  /** Body tracking: a hand up at the head or face. */
  handsFace?: number
  /** Body tracking: hips and feet in frame too. */
  full?: number
  /** Head turn and nod (degrees, mean of the second), while present. */
  yaw?: number
  pitch?: number
  /** Face width, cheek to cheek (image heights), while present. */
  faceW?: number
  /** Shoulder line tilt (degrees; positive: the person's left shoulder lower), while the shoulders were seen. */
  tilt?: number
  /** Shoulder width (image heights). */
  shoulderW?: number
  /** The nose's height above the shoulder line, in shoulder widths. */
  neck?: number
  /** How far the wrists travelled this second, in shoulder widths. */
  handPath?: number
  /** One slot per body sample (`poseHz` a second): the shoulder midpoint's x, and the wrists relative to it. */
  sx?: (number | null)[]
  lw?: (Point | null)[]
  rw?: (Point | null)[]
}

/**
 * What is wrong with how the candidate sits in the frame right now, if anything.
 * `too_close`: only the face shows, so posture and hands cannot be judged.
 * `step_back`: a setting judged on the whole body (presenting, a defence) sees only part of it.
 */
export type Framing = 'no_face' | 'too_close' | 'step_back'

/** Where a speaker sits on screen, from the candidate's point of view. */
export type Seat = -1 | 0 | 1

export interface FaceTrackerOptions {
  /** `camera`: eye contact is looking into the lens (a video call). `screen`: at the people on screen (in person). */
  setting?: 'camera' | 'screen'
  /** The seat of whoever is speaking right now, or null when nobody is. */
  speakerSeat?: () => Seat | null
  /** Judged on the whole body (presenting, a thesis defence): the framing check asks for all of it. */
  fullBody?: boolean
}

export interface HeadAngles {
  yaw: number
  pitch: number
}

const DEG = 180 / Math.PI

/** Yaw (left/right) and pitch (up/down) in degrees from a column-major 4×4 face transformation matrix. */
export function headAngles(m: ArrayLike<number>): HeadAngles {
  const r20 = m[2]
  const r21 = m[6]
  const r22 = m[10]
  return {
    yaw: Math.atan2(-r20, Math.hypot(r21, r22)) * DEG,
    pitch: Math.atan2(r21, r22) * DEG,
  }
}

export function lookingAtCamera(angles: HeadAngles, blend: Record<string, number>): boolean {
  if (Math.abs(angles.yaw) > LOOK_AWAY_DEGREES || Math.abs(angles.pitch) > LOOK_AWAY_DEGREES) return false
  const away = ['eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookDownLeft', 'eyeLookDownRight']
  return away.every((name) => (blend[name] ?? 0) < EYES_AWAY)
}

/**
 * In person, the people are on the screen, which sits below the camera: looking anywhere on it is
 * looking at them (eyes lowered toward the screen included).
 */
export function lookingAtScreen(angles: HeadAngles, blend: Record<string, number>): boolean {
  if (Math.abs(angles.yaw) > SCREEN_DEGREES || Math.abs(angles.pitch) > SCREEN_DEGREES) return false
  const away = ['eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight']
  return away.every((name) => (blend[name] ?? 0) < EYES_AWAY)
}

/**
 * Whether the head is turned toward a seat. Positive yaw (see `headAngles`) turns the face toward
 * the right of the camera image, which is the person's own left: the left of their screen.
 */
export function facesSeat(yaw: number, seat: Seat): boolean {
  if (seat === 0) return Math.abs(yaw) <= SEAT_YAW_DEGREES
  return seat === -1 ? yaw > SEAT_YAW_DEGREES : yaw < -SEAT_YAW_DEGREES
}

let landmarker: Promise<FaceLandmarker> | null = null

function loadLandmarker(): Promise<FaceLandmarker> {
  landmarker ??= (async () => {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE)
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    })
    try {
      return await FaceLandmarker.createFromOptions(fileset, options('GPU'))
    } catch {
      return FaceLandmarker.createFromOptions(fileset, options('CPU'))
    }
  })()
  landmarker.catch(() => {
    landmarker = null
  })
  return landmarker
}

let poseLandmarker: Promise<PoseLandmarker> | null = null

function loadPose(): Promise<PoseLandmarker> {
  poseLandmarker ??= (async () => {
    const { PoseLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE)
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: POSE_MODEL_PATH, delegate },
      runningMode: 'VIDEO' as const,
      numPoses: 1,
    })
    try {
      return await PoseLandmarker.createFromOptions(fileset, options('GPU'))
    } catch {
      return PoseLandmarker.createFromOptions(fileset, options('CPU'))
    }
  })()
  poseLandmarker.catch(() => {
    poseLandmarker = null
  })
  return poseLandmarker
}

/** What one body-tracking sample saw. */
export interface BodySample {
  body: boolean
  hands: boolean
  handsFace: boolean
  full: boolean
}

/**
 * Reads a pose (MediaPipe's 33 landmarks, normalised to the image) into what matters for body
 * language. `aspect` is the image's width over its height, so distances are measured square.
 */
export function readPose(landmarks: NormalizedLandmark[], aspect: number): BodySample {
  const seen = (i: number) => {
    const l = landmarks[i]
    return Boolean(l) && (l.visibility ?? 0) > VISIBLE && l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1
  }
  const distance = (a: number, b: number) =>
    Math.hypot((landmarks[a].x - landmarks[b].x) * aspect, landmarks[a].y - landmarks[b].y)
  const body = seen(11) && seen(12)
  const wrists = [15, 16].filter(seen)
  // Shoulder width sizes "near the face" to this person at this distance; without the shoulders,
  // a quarter of the image height stands in for it.
  const reach = body ? distance(11, 12) * HAND_AT_FACE_SHOULDERS : 0.25
  return {
    body,
    hands: wrists.length > 0,
    handsFace: seen(0) && wrists.some((w) => distance(w, 0) < reach),
    full: seen(23) && seen(24) && (seen(27) || seen(28)),
  }
}

/** The framing problem in a run of recent samples, if one holds for most of it. */
export function framingOf(
  faces: boolean[],
  bodies: BodySample[],
  fullBody: boolean,
): Framing | null {
  if (faces.length >= 4 && faces.filter(Boolean).length < faces.length / 2) return 'no_face'
  if (bodies.length < 3) return null
  const most = (pick: (b: BodySample) => boolean) => bodies.filter(pick).length >= bodies.length / 2
  if (!most((b) => b.body)) return 'too_close'
  if (fullBody && !most((b) => b.full)) return 'step_back'
  return null
}

interface Bucket {
  samples: number
  present: number
  /** Samples bright enough to judge, and among them those with the face present (the eye samples). */
  clear: number
  judged: number
  eye: number
  smile: number
  move: number
  /** Samples taken while someone was speaking, and how many faced their seat. */
  spoken: number
  toSpeaker: number
  /** Body-tracking samples, and how many saw each thing. */
  poses: number
  body: number
  hands: number
  handsFace: number
  full: number
  /** Sums for the second's means, and how many samples each one has. */
  angles: number
  yaw: number
  pitch: number
  faces: number
  faceW: number
  shoulders: number
  tilt: number
  shoulderW: number
  necks: number
  neck: number
  handPath: number
  sx: (number | null)[] | null
  lw: (Point | null)[] | null
  rw: (Point | null)[] | null
}

const round2 = (value: number) => Math.round(value * 100) / 100
const round1 = (value: number) => Math.round(value * 10) / 10
const round3 = (value: number) => Math.round(value * 1000) / 1000
const roundPoint = (p: Point | null): Point | null => (p ? [round2(p[0]), round2(p[1])] : null)

/** A second's body-language numbers (face metrics version 3); only those that were measured. */
function bodyNumbers(b: Bucket): Partial<FaceSecond> {
  return {
    ...(b.angles ? { yaw: round1(b.yaw / b.angles), pitch: round1(b.pitch / b.angles) } : {}),
    ...(b.faces ? { faceW: round3(b.faceW / b.faces) } : {}),
    ...(b.shoulders
      ? {
          tilt: round1(b.tilt / b.shoulders),
          shoulderW: round3(b.shoulderW / b.shoulders),
          handPath: round2(Math.min(MAX_HAND_PATH, b.handPath)),
          ...(b.necks ? { neck: round2(b.neck / b.necks) } : {}),
          sx: (b.sx ?? []).map((x) => (x === null ? null : round3(x))),
          lw: (b.lw ?? []).map(roundPoint),
          rw: (b.rw ?? []).map(roundPoint),
        }
      : {}),
  }
}

export class FaceTracker {
  private readonly buckets = new Map<number, Bucket>()
  private video: HTMLVideoElement | null = null
  private timer: number | undefined
  private last: (HeadAngles & { at: number }) | null = null
  private stopped = false
  /** The most recent samples, for live feedback during a drill. */
  private readonly recent: { present: boolean; eye: boolean; smile: number }[] = []
  /** The last few seconds of body tracking, for the framing check. */
  private readonly recentBodies: BodySample[] = []
  private pose: PoseLandmarker | null = null
  private samples = 0
  private poseEvery = 1
  private readonly poseTimings: number[] = []
  private lastPose: PoseFeatures | null = null

  /** Body-tracking samples a second, as recorded (lower on a slow device). */
  get poseHz(): number {
    return SAMPLES_PER_SECOND / this.poseEvery
  }

  /** What is wrong with the framing right now, if anything; null when it is fine or unknown. */
  framing(): Framing | null {
    return framingOf(
      this.recent.map((s) => s.present),
      this.recentBodies,
      Boolean(this.options.fullBody),
    )
  }

  /**
   * The framing as far as it is known: a problem, 'ok' once enough recent samples have actually seen
   * the face and the body the setting needs, or null while there is not enough to tell (just started,
   * or body tracking unavailable). Unlike `framing()`, null never means "fine".
   */
  framingStatus(): Framing | 'ok' | null {
    const problem = this.framing()
    if (problem) return problem
    const faces = this.recent
    const faceSeen = faces.length >= 4 && faces.filter((s) => s.present).length >= faces.length / 2
    return faceSeen && this.recentBodies.length >= 3 ? 'ok' : null
  }

  /** Over roughly the last two seconds: is a face visible, the share looking at the camera, and smile strength. */
  live(): { present: boolean; eye: number; smile: number } | null {
    if (!this.recent.length) return null
    const seen = this.recent.filter((s) => s.present)
    if (seen.length < this.recent.length / 2) return { present: false, eye: 0, smile: 0 }
    return {
      present: true,
      eye: seen.filter((s) => s.eye).length / seen.length,
      smile: seen.reduce((sum, s) => sum + s.smile, 0) / seen.length,
    }
  }

  constructor(
    private readonly stream: MediaStream,
    private readonly mediaMs: () => number,
    private readonly options: FaceTrackerOptions = {},
  ) {}

  /** Starts sampling; resolves false when face tracking can't run on this device. */
  async start(): Promise<boolean> {
    try {
      const detector = await loadLandmarker()
      if (this.stopped) return false
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = this.stream
      await video.play()
      this.video = video
      this.timer = window.setInterval(() => this.sample(detector), 1000 / SAMPLES_PER_SECOND)
      // Body tracking is extra: where it cannot run, the face measurements carry on without it.
      void loadPose()
        .then((pose) => {
          if (!this.stopped) this.pose = pose
        })
        .catch(() => {})
      return true
    } catch {
      return false
    }
  }

  private sample(detector: FaceLandmarker): void {
    const video = this.video
    if (!video || video.readyState < 2) return
    const now = performance.now()
    let result
    try {
      result = detector.detectForVideo(video, now)
    } catch {
      return
    }
    const second = Math.floor(this.mediaMs() / 1000)
    const bucket = this.buckets.get(second) ?? {
      samples: 0, present: 0, clear: 0, judged: 0, eye: 0, smile: 0, move: 0, spoken: 0, toSpeaker: 0,
      poses: 0, body: 0, hands: 0, handsFace: 0, full: 0,
      angles: 0, yaw: 0, pitch: 0, faces: 0, faceW: 0, shoulders: 0, tilt: 0, shoulderW: 0, necks: 0, neck: 0,
      handPath: 0, sx: null, lw: null, rw: null,
    }
    bucket.samples += 1
    this.samples += 1
    if (this.pose && this.samples % this.poseEvery === 0) this.samplePose(this.pose, video, now, bucket)

    const matrix = result.facialTransformationMatrixes?.[0]?.data
    const shapes = result.faceBlendshapes?.[0]?.categories
    if (matrix && shapes) {
      const blend: Record<string, number> = {}
      for (const shape of shapes) blend[shape.categoryName] = shape.score
      const angles = headAngles(matrix)
      bucket.angles += 1
      bucket.yaw += angles.yaw
      bucket.pitch += angles.pitch
      const width = faceWidth(result.faceLandmarks?.[0], video.videoWidth / Math.max(1, video.videoHeight))
      if (width !== null) {
        bucket.faces += 1
        bucket.faceW += width
      }
      const looking = this.options.setting === 'screen' ? lookingAtScreen(angles, blend) : lookingAtCamera(angles, blend)
      const seat = this.options.speakerSeat?.() ?? null
      if (seat !== null) {
        bucket.spoken += 1
        if (facesSeat(angles.yaw, seat)) bucket.toSpeaker += 1
      }
      const smile = ((blend.mouthSmileLeft ?? 0) + (blend.mouthSmileRight ?? 0)) / 2
      bucket.present += 1
      // The eyes are judged only on a face lit well enough to see them.
      const lit = this.brightness(video, result.faceLandmarks?.[0]) >= DARK_LUMA
      if (lit) {
        bucket.clear += 1
        bucket.judged += 1
        if (looking) bucket.eye += 1
      }
      bucket.smile += smile
      this.remember({ present: true, eye: lit && looking, smile })
      if (this.last) {
        const seconds = Math.max(0.05, (now - this.last.at) / 1000)
        const speed = Math.hypot(angles.yaw - this.last.yaw, angles.pitch - this.last.pitch) / seconds
        if (speed > RESTLESS_DEGREES_PER_SECOND) bucket.move += 1
      }
      this.last = { ...angles, at: now }
    } else {
      this.last = null
      // No face: in a lit room that is the candidate out of frame; in the dark, nothing can be told.
      if (this.brightness(video) >= DARK_LUMA) bucket.clear += 1
      this.remember({ present: false, eye: false, smile: 0 })
    }
    this.buckets.set(second, bucket)
  }

  private samplePose(pose: PoseLandmarker, video: HTMLVideoElement, now: number, bucket: Bucket): void {
    let landmarks: NormalizedLandmark[] | undefined
    const started = performance.now()
    try {
      landmarks = pose.detectForVideo(video, now).landmarks?.[0]
    } catch {
      return
    }
    this.timePose(performance.now() - started)
    const aspect = video.videoWidth / Math.max(1, video.videoHeight)
    const seen = landmarks
      ? readPose(landmarks, aspect)
      : { body: false, hands: false, handsFace: false, full: false }
    this.addBody(bucket, landmarks ? poseFeatures(landmarks, aspect) : null)
    bucket.poses += 1
    if (seen.body) bucket.body += 1
    if (seen.hands) bucket.hands += 1
    if (seen.handsFace) bucket.handsFace += 1
    if (seen.full) bucket.full += 1
    this.recentBodies.push(seen)
    // About three seconds: long enough that a passing gesture does not raise a warning.
    if (this.recentBodies.length > Math.ceil(3 * this.poseHz)) this.recentBodies.shift()
  }

  /** A device too slow for body tracking on every sample drops to every other one, for the rest of the session. */
  private timePose(ms: number): void {
    this.poseTimings.push(ms)
    if (this.poseTimings.length > POSE_TIMINGS) this.poseTimings.shift()
    if (this.poseEvery === 1 && this.poseTimings.length >= POSE_TIMINGS && p95(this.poseTimings) > SLOW_POSE_MS) {
      this.poseEvery = POSE_EVERY_SLOW
    }
  }

  /** Adds one body sample's numbers to its second: sums for the means, and its slot in the per-sample lists. */
  private addBody(bucket: Bucket, features: PoseFeatures | null): void {
    const hz = this.poseHz
    bucket.sx ??= Array<number | null>(hz).fill(null)
    bucket.lw ??= Array<Point | null>(hz).fill(null)
    bucket.rw ??= Array<Point | null>(hz).fill(null)
    if (!features) {
      this.lastPose = null
      return
    }
    const slot = Math.min(bucket.sx.length - 1, poseSlot(this.mediaMs(), hz))
    bucket.sx[slot] = features.sx
    bucket.lw[slot] = features.lw
    bucket.rw[slot] = features.rw
    bucket.shoulders += 1
    bucket.tilt += features.tilt
    bucket.shoulderW += features.shoulderW
    if (features.neck !== null) {
      bucket.necks += 1
      bucket.neck += features.neck
    }
    bucket.handPath += wristTravel(this.lastPose, features)
    this.lastPose = features
  }

  private lumaCanvas: HTMLCanvasElement | null = null

  /**
   * Average brightness (0-255) of the face — the box around its landmarks — or of the whole frame.
   * Measured on a tiny copy of the frame, on the device, and discarded like everything else.
   */
  private brightness(video: HTMLVideoElement, face?: NormalizedLandmark[]): number {
    const w = LUMA_WIDTH
    const h = Math.max(1, Math.round((w * video.videoHeight) / Math.max(1, video.videoWidth)))
    this.lumaCanvas ??= document.createElement('canvas')
    const canvas = this.lumaCanvas
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return 255
    try {
      context.drawImage(video, 0, 0, w, h)
    } catch {
      return 255
    }
    let [x0, y0, x1, y1] = [0, 0, w, h]
    if (face?.length) {
      const xs = face.map((l) => l.x)
      const ys = face.map((l) => l.y)
      x0 = Math.max(0, Math.floor(Math.min(...xs) * w))
      y0 = Math.max(0, Math.floor(Math.min(...ys) * h))
      x1 = Math.min(w, Math.ceil(Math.max(...xs) * w))
      y1 = Math.min(h, Math.ceil(Math.max(...ys) * h))
      if (x1 - x0 < 2 || y1 - y0 < 2) [x0, y0, x1, y1] = [0, 0, w, h]
    }
    const { data } = context.getImageData(x0, y0, x1 - x0, y1 - y0)
    let sum = 0
    for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    return data.length ? sum / (data.length / 4) : 255
  }

  private remember(sample: { present: boolean; eye: boolean; smile: number }): void {
    this.recent.push(sample)
    if (this.recent.length > SAMPLES_PER_SECOND * 2) this.recent.shift()
  }

  /** Stops sampling and returns the per-second measurements. */
  stop(): FaceSecond[] {
    this.stopped = true
    window.clearInterval(this.timer)
    if (this.video) {
      this.video.pause()
      this.video.srcObject = null
      this.video = null
    }
    return [...this.buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([t, b]) => ({
        t,
        present: round2(b.present / b.samples),
        eye: b.judged ? round2(b.eye / b.judged) : 0,
        clear: round2(b.clear / b.samples),
        smile: b.present ? round2(b.smile / b.present) : 0,
        move: b.present ? round2(b.move / b.present) : 0,
        ...(this.options.speakerSeat && b.spoken ? { toSpeaker: round2(b.toSpeaker / b.spoken) } : {}),
        ...(b.poses
          ? {
              body: round2(b.body / b.poses),
              hands: round2(b.hands / b.poses),
              handsFace: round2(b.handsFace / b.poses),
              full: round2(b.full / b.poses),
            }
          : {}),
        ...bodyNumbers(b),
      }))
  }
}
