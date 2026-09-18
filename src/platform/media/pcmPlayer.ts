import { PLAYBACK_RATE } from '../live/protocol'
import { int16ToFloat32 } from './downsample'

export interface PlayerEvents {
  /** The first chunk of an interviewer turn is scheduled to start at this media time. */
  onTurnStart: (turnSeq: number, mediaMs: number) => void
  /** Playback of a turn finished or was cut off, at this media time. */
  onTurnStop: (turnSeq: number, mediaMs: number) => void
  onSpeakingChange: (speaking: boolean) => void
}

/** Scheduling headroom before the first chunk of a turn plays. */
const BASE_LEAD_S = 0.04
/** A breath between two speakers when one turn is queued behind another. */
const TURN_GAP_S = 0.45

/**
 * Schedules the interviewer's 24 kHz PCM gaplessly on the shared AudioContext,
 * so playback times and microphone capture times use the same clock.
 * `output` feeds the session recorder; everything also reaches the speakers.
 *
 * A new turn is queued behind the one still playing (the lead interviewer's
 * hand-over line, then a panel colleague's question); cutting a turn short is
 * `flush()`'s job, on an interruption.
 */
export class PcmPlayer {
  /** Everything played, for the recording, whether or not it reaches the speakers. */
  readonly output: GainNode
  private nextTime = 0
  private readonly turns = new Map<number, Set<AudioBufferSourceNode>>()
  private speaking = false
  private leadS = BASE_LEAD_S

  /** Everything the candidate hears: the lead interviewer and every panel colleague. */
  private readonly speaker: GainNode

  constructor(
    private readonly ctx: AudioContext,
    private readonly mediaMsAt: (contextTime: number) => number,
    private readonly events: PlayerEvents,
  ) {
    this.output = ctx.createGain()
    this.speaker = ctx.createGain()
    this.speaker.connect(ctx.destination)
  }

  get isSpeaking(): boolean {
    return this.speaking
  }

  /** Returns when this chunk will start, on the AudioContext clock. */
  enqueue(turnSeq: number, pcm: Int16Array): number {
    if (pcm.length === 0) return this.ctx.currentTime
    const buffer = this.ctx.createBuffer(1, pcm.length, PLAYBACK_RATE)
    buffer.copyToChannel(int16ToFloat32(pcm), 0)
    let sources = this.turns.get(turnSeq)
    // A new speaker waits for whoever is still talking, then takes a breath.
    const gap = !sources && this.turns.size > 0 ? TURN_GAP_S : 0
    const start = Math.max(this.nextTime + gap, this.ctx.currentTime + this.leadS)

    if (!sources) {
      sources = new Set()
      this.turns.set(turnSeq, sources)
      this.events.onTurnStart(turnSeq, this.mediaMsAt(start))
    }

    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.output)
    source.connect(this.speaker)
    const turn = sources
    source.onended = () => {
      turn.delete(source)
      if (turn.size > 0 || this.turns.get(turnSeq) !== turn) return
      this.turns.delete(turnSeq)
      this.events.onTurnStop(turnSeq, this.mediaMsAt(this.ctx.currentTime))
      if (this.turns.size === 0) this.setSpeaking(false)
    }
    source.start(start)
    turn.add(source)
    this.nextTime = start + buffer.duration
    this.setSpeaking(true)
    return start
  }

  /** The candidate interrupted, or the server said the turn was cut: silence immediately. */
  flush(): void {
    if (this.turns.size === 0) return
    const stopped = [...this.turns.keys()]
    this.stopAll()
    const at = this.mediaMsAt(this.ctx.currentTime)
    for (const turnSeq of stopped) this.events.onTurnStop(turnSeq, at)
  }

  private stopAll(): void {
    for (const sources of this.turns.values()) {
      for (const source of sources) {
        source.onended = null
        try {
          source.stop()
        } catch {
          /* already stopped */
        }
      }
    }
    this.turns.clear()
    this.nextTime = this.ctx.currentTime
    this.setSpeaking(false)
  }

  private setSpeaking(speaking: boolean): void {
    if (speaking === this.speaking) return
    this.speaking = speaking
    this.events.onSpeakingChange(speaking)
  }

  dispose(): void {
    this.stopAll()
    this.output.disconnect()
    this.speaker.disconnect()
  }
}
