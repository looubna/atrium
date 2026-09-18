import type { FaceLandmarker } from '@mediapipe/tasks-vision'

/**
 * On-device face measurements during an interview: whether the candidate looks
 * at the camera, smiles, and how much their head moves. Frames are analysed on
 * the device and discarded; only per-second numbers are kept and uploaded.
 */

/** Served by the app itself (see vite.config.ts), so it works offline and inside the iOS app. */
const WASM_BASE = '/models/mediapipe/wasm'
const MODEL_PATH = '/models/mediapipe/face_landmarker.task'
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

/** One second of the interview, as fractions of that second's samples. */
export interface FaceSecond {
  /** Seconds on the session's media clock. */
  t: number
  /** A face was found. */
  present: number
  /** Looking at the camera, while present. */
  eye: number
  /** Average smile strength (0..1), while present. */
  smile: number
  /** Restless head movement, while present. */
  move: number
  /** In-person panels: turned toward the seat of whoever was speaking, while present. */
  toSpeaker?: number
}

/** Where a speaker sits on screen, from the candidate's point of view. */
export type Seat = -1 | 0 | 1

export interface FaceTrackerOptions {
  /** `camera`: eye contact is looking into the lens (a video call). `screen`: at the people on screen (in person). */
  setting?: 'camera' | 'screen'
  /** The seat of whoever is speaking right now, or null when nobody is. */
  speakerSeat?: () => Seat | null
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

interface Bucket {
  samples: number
  present: number
  eye: number
  smile: number
  move: number
  /** Samples taken while someone was speaking, and how many faced their seat. */
  spoken: number
  toSpeaker: number
}

const round2 = (value: number) => Math.round(value * 100) / 100

export class FaceTracker {
  private readonly buckets = new Map<number, Bucket>()
  private video: HTMLVideoElement | null = null
  private timer: number | undefined
  private last: (HeadAngles & { at: number }) | null = null
  private stopped = false
  /** The most recent samples, for live feedback during a drill. */
  private readonly recent: { present: boolean; eye: boolean; smile: number }[] = []

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
    const bucket = this.buckets.get(second) ?? { samples: 0, present: 0, eye: 0, smile: 0, move: 0, spoken: 0, toSpeaker: 0 }
    bucket.samples += 1

    const matrix = result.facialTransformationMatrixes?.[0]?.data
    const shapes = result.faceBlendshapes?.[0]?.categories
    if (matrix && shapes) {
      const blend: Record<string, number> = {}
      for (const shape of shapes) blend[shape.categoryName] = shape.score
      const angles = headAngles(matrix)
      const looking = this.options.setting === 'screen' ? lookingAtScreen(angles, blend) : lookingAtCamera(angles, blend)
      const seat = this.options.speakerSeat?.() ?? null
      if (seat !== null) {
        bucket.spoken += 1
        if (facesSeat(angles.yaw, seat)) bucket.toSpeaker += 1
      }
      const smile = ((blend.mouthSmileLeft ?? 0) + (blend.mouthSmileRight ?? 0)) / 2
      bucket.present += 1
      if (looking) bucket.eye += 1
      bucket.smile += smile
      this.remember({ present: true, eye: looking, smile })
      if (this.last) {
        const seconds = Math.max(0.05, (now - this.last.at) / 1000)
        const speed = Math.hypot(angles.yaw - this.last.yaw, angles.pitch - this.last.pitch) / seconds
        if (speed > RESTLESS_DEGREES_PER_SECOND) bucket.move += 1
      }
      this.last = { ...angles, at: now }
    } else {
      this.last = null
      this.remember({ present: false, eye: false, smile: 0 })
    }
    this.buckets.set(second, bucket)
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
        eye: b.present ? round2(b.eye / b.present) : 0,
        smile: b.present ? round2(b.smile / b.present) : 0,
        move: b.present ? round2(b.move / b.present) : 0,
        ...(this.options.speakerSeat && b.spoken ? { toSpeaker: round2(b.toSpeaker / b.spoken) } : {}),
      }))
  }
}
