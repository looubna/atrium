import { PLAYBACK_RATE } from '../live/protocol'
import { int16ToFloat32 } from './downsample'

export interface PlayerEvents {
  /** The first chunk of an interviewer turn is scheduled to start at this media time. */
  onTurnStart: (turnSeq: number, mediaMs: number) => void
  /** Playback of a turn finished or was cut off, at this media time. */
  onTurnStop: (turnSeq: number, mediaMs: number) => void
  onSpeakingChange: (speaking: boolean) => void
}

export type PlaybackRoute = 'lead' | 'always' | 'silent'

/** Scheduling headroom when the interviewer has no face to wait for. */
const BASE_LEAD_S = 0.04
/**
 * A breath between two speakers when one turn is queued behind another. Short: on a panel this
 * sits on top of the wait for the previous face to fall silent, and a hand-over that pauses
 * before the colleague answers it reads as the app hesitating, not as turn-taking.
 */
const TURN_GAP_S = 0.25

/**
 * The voices as they reach the speakers. Gemini's voices peak near full scale, and the deep ones
 * (Alnilam, Charon) put most of that into the low bass: through laptop or phone speakers that
 * rattles the driver, a buzz like a phone vibrating on the desk under every sentence. Below
 * ~110 Hz a small speaker only distorts, so it goes; the compressor catches the peaks and the
 * gain leaves headroom. The recording (`output`) keeps the untouched voice.
 */
const SPEAKER_HIGHPASS_HZ = 110
const SPEAKER_GAIN = 0.7

/**
 * How the voice is shaped for the speakers. The default suits the interview voices; a screen
 * whose voice sits hot in the low mids (the Language Center's tutor peaks near full scale with
 * ~40% of its energy at 150-300 Hz, which rattles a phone speaker on loud syllables) can ask for
 * more headroom and a dip in that band. The recording is never shaped.
 */
export interface SpeakerTone {
  highpassHz: number
  gain: number
  /**
   * Where the compressor starts, dBFS; null for none. A compressor fast enough to catch peaks
   * (3 ms) also reshapes the voice's own cycles when it works all the time, and that distortion
   * (about 5% on the tutor's voice, measured) is heard as a buzz. A clean voice with headroom
   * set by `gain` needs none.
   */
  thresholdDb: number | null
  /** A dip centred on 250 Hz, in dB (0 = none). */
  lowMidCutDb: number
}

export const DEFAULT_SPEAKER_TONE: SpeakerTone = {
  highpassHz: SPEAKER_HIGHPASS_HZ,
  gain: SPEAKER_GAIN,
  thresholdDb: -12,
  lowMidCutDb: 0,
}

/**
 * Schedules the interviewer's 24 kHz PCM gaplessly on the shared AudioContext,
 * so playback times and microphone capture times use the same clock.
 * `output` feeds the session recorder; what reaches the speakers is routed per turn.
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

  /** The lead interviewer's voice: silenced while an avatar speaks it instead. */
  private readonly speaker: GainNode
  /** Voices only this player can give (panel colleagues): always audible. */
  private readonly direct: GainNode
  /** High-pass, compressor and trim that both routes above share on the way to the speakers. */
  private readonly voice: AudioNode[]

  constructor(
    private readonly ctx: AudioContext,
    private readonly mediaMsAt: (contextTime: number) => number,
    private readonly events: PlayerEvents,
    tone: SpeakerTone = DEFAULT_SPEAKER_TONE,
  ) {
    this.output = ctx.createGain()
    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = tone.highpassHz
    highpass.Q.value = 0.7
    const trim = ctx.createGain()
    trim.gain.value = tone.gain
    const chain: AudioNode[] = [highpass]
    if (tone.lowMidCutDb) {
      const dip = ctx.createBiquadFilter()
      dip.type = 'peaking'
      dip.frequency.value = 250
      dip.Q.value = 1
      dip.gain.value = -Math.abs(tone.lowMidCutDb)
      chain.push(dip)
    }
    if (tone.thresholdDb !== null) {
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = tone.thresholdDb
      limiter.knee.value = 6
      limiter.ratio.value = 4
      limiter.attack.value = 0.003
      limiter.release.value = 0.15
      chain.push(limiter)
    }
    chain.push(trim)
    chain.reduce((from, to) => from.connect(to))
    trim.connect(ctx.destination)
    this.voice = chain
    this.speaker = ctx.createGain()
    this.speaker.connect(highpass)
    this.direct = ctx.createGain()
    this.direct.connect(highpass)
  }

  /** False while another source (an avatar) is the voice the candidate hears. */
  setAudible(audible: boolean): void {
    this.speaker.gain.value = audible ? 1 : 0
  }

  get isSpeaking(): boolean {
    return this.speaking
  }

  /**
   * Holds playback back by the time an avatar needs to render the matching lip
   * movement, so the voice and the face line up. 0 restores plain audio timing.
   * Takes effect on the next turn; the current turn keeps its schedule.
   */
  setLead(ms: number): void {
    this.leadS = BASE_LEAD_S + Math.max(0, ms) / 1000
  }

  /**
   * `route`: 'lead' follows `setAudible`; 'always' is heard even while an avatar has the
   * lead's voice (a colleague with no face); 'silent' is only recorded (a colleague whose
   * own face speaks it).
   */
  /** Returns when this chunk will start, on the AudioContext clock. */
  enqueue(turnSeq: number, pcm: Int16Array, route: PlaybackRoute = 'lead'): number {
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
    if (route !== 'silent') source.connect(route === 'always' ? this.direct : this.speaker)
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
    this.direct.disconnect()
    this.voice.forEach((node) => node.disconnect())
  }
}
