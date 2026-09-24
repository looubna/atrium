import { PLAYBACK_RATE } from '../live/protocol'

/**
 * The same care `PcmPlayer` takes on its speaker route, for a voice that reaches the speakers
 * some other way — a live face plays the words it is sent from its own stream, so they have to
 * be shaped before they leave. Gemini's deep voices peak near full scale with most of that in
 * the low bass, and a laptop or phone speaker rattles on it: a buzz like a phone vibrating on
 * the desk under every sentence. A second-order high-pass takes out what a small speaker can
 * only distort, and the trim leaves headroom. Stateful across chunks, so it runs per stream.
 */
export class SpeakerVoice {
  private readonly b0: number
  private readonly b1: number
  private readonly b2: number
  private readonly a1: number
  private readonly a2: number
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0

  constructor(
    cutoffHz = 110,
    private readonly gain = 0.7,
    rate = PLAYBACK_RATE,
  ) {
    // RBJ cookbook high-pass, Q = 1/sqrt(2).
    const w = (2 * Math.PI * cutoffHz) / rate
    const alpha = Math.sin(w) / Math.SQRT2
    const a0 = 1 + alpha
    const cos = Math.cos(w)
    this.b0 = (1 + cos) / 2 / a0
    this.b1 = -(1 + cos) / a0
    this.b2 = (1 + cos) / 2 / a0
    this.a1 = (-2 * cos) / a0
    this.a2 = (1 - alpha) / a0
  }

  process(pcm: Int16Array): Int16Array<ArrayBuffer> {
    const out = new Int16Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) {
      const x = pcm[i]
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
      this.x2 = this.x1
      this.x1 = x
      this.y2 = this.y1
      this.y1 = y
      out[i] = Math.max(-32768, Math.min(32767, Math.round(y * this.gain)))
    }
    return out
  }

  /** A cut-off voice: the next words start from rest, not from the tail of the last ones. */
  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0
  }
}
