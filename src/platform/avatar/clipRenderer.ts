import type { AvatarRenderer, AvatarState } from './types'

/**
 * A face made of filmed clips, for when there is no lip-sync server.
 *
 * The person was filmed twice at one desk, one camera, one framing: talking, and
 * listening while they write. This plays whichever matches what they are doing and
 * cross-fades between them, so the examiner talks and moves through the whole exam
 * with no GPU, no server and nothing to pay per minute.
 *
 * What it does not do is match the mouth to the words — only the lip-sync server can.
 * So it sits *below* `LiveTalkingRenderer`: a real face when one is reachable, this
 * when one is not, and the still photograph only if the clips themselves fail to load.
 *
 * Both clips are drawn into a canvas and handed over as a MediaStream, exactly as the
 * WebRTC face is, so nothing downstream can tell the two apart.
 */

/** Long enough to read as a person changing what they are doing, short enough not to drag. */
const CROSSFADE_MS = 320
const FPS = 24

export interface ClipFace {
  talking: string
  listening: string
}

export class ClipRenderer implements AvatarRenderer {
  /** The clips are silent: `PcmPlayer` stays the one audible source, as with any mute face. */
  readonly providesAudio = false
  /** Nothing to line up: no mouth is being matched to the audio. */
  readonly videoLagMs = 0

  private readonly clips: ClipFace
  private talking: HTMLVideoElement | null = null
  private listening: HTMLVideoElement | null = null
  private frame = 0
  private disposed = false
  /** 0 = listening, 1 = talking. The cross-fade walks this between the two. */
  private mix = 0
  private target = 0
  private last = 0

  constructor(clips: ClipFace) {
    this.clips = clips
  }

  async attach(video: HTMLVideoElement): Promise<void> {
    if (this.disposed) throw new Error('renderer disposed')
    const [talking, listening] = await Promise.all([load(this.clips.talking), load(this.clips.listening)])
    if (this.disposed) {
      talking.remove()
      listening.remove()
      throw new Error('renderer disposed')
    }
    this.talking = talking
    this.listening = listening

    const canvas = document.createElement('canvas')
    canvas.width = listening.videoWidth || 1280
    canvas.height = listening.videoHeight || 720
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no 2d context')

    // First paint before the stream is handed over, so the element never shows a blank frame.
    this.paint(context)
    video.srcObject = canvas.captureStream(FPS)

    this.last = performance.now()
    const draw = (now: number) => {
      if (this.disposed) return
      const dt = (now - this.last) / 1000
      this.last = now
      // Ease towards the target rather than cutting: a hard swap between two takes reads
      // as a glitch, which is the same fault the face server's `enable_transition` fixes.
      const step = dt / (CROSSFADE_MS / 1000)
      this.mix = this.target > this.mix ? Math.min(this.target, this.mix + step) : Math.max(this.target, this.mix - step)
      this.paint(context)
      this.frame = requestAnimationFrame(draw)
    }
    this.frame = requestAnimationFrame(draw)
  }

  private paint(context: CanvasRenderingContext2D): void {
    const { width, height } = context.canvas
    // The quiet clip is the floor, the talking one fades in over it. Drawing both only
    // during the blend keeps the steady state at one draw per frame.
    if (this.mix < 1 && this.listening) context.drawImage(this.listening, 0, 0, width, height)
    if (this.mix > 0 && this.talking) {
      context.globalAlpha = this.mix
      context.drawImage(this.talking, 0, 0, width, height)
      context.globalAlpha = 1
    }
  }

  /** No lip-sync here: the audio is the player's business, and the clips are silent. */
  pushAudio(_turnSeq: number, _pcm: Int16Array): void {}

  /** The candidate cut in, so the examiner stops talking at once. */
  interrupt(): void {
    this.target = 0
  }

  setState(state: AvatarState): void {
    this.target = state === 'speaking' ? 1 : 0
  }

  dispose(): void {
    this.disposed = true
    if (this.frame) cancelAnimationFrame(this.frame)
    for (const clip of [this.talking, this.listening]) {
      if (!clip) continue
      clip.pause()
      clip.removeAttribute('src')
      clip.load()
      clip.remove()
    }
    this.talking = null
    this.listening = null
  }
}

/** A looping, muted, playing clip — or a rejection, which drops the call back to the still. */
async function load(src: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.src = src
  video.loop = true
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  // Off-screen rather than display:none: a hidden element is allowed to stop decoding.
  video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px'
  document.body.appendChild(video)

  await new Promise<void>((resolve, reject) => {
    const ok = () => {
      cleanup()
      resolve()
    }
    const fail = () => {
      cleanup()
      video.remove()
      reject(new Error(`clip failed to load: ${src}`))
    }
    const cleanup = () => {
      video.removeEventListener('canplay', ok)
      video.removeEventListener('error', fail)
    }
    video.addEventListener('canplay', ok)
    video.addEventListener('error', fail)
  })
  await video.play()
  return video
}
