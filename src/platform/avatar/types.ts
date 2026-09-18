/**
 * A face for the interviewer.
 *
 * Gemini Live stays the brain and the voice: the renderer only ever receives a
 * copy of the interviewer audio that `PcmPlayer` is already scheduling. The
 * candidate's microphone and camera never reach a renderer. A renderer that
 * speaks the audio itself (`providesAudio`) is the one audible stream, and
 * `PcmPlayer` runs silently as the clock.
 *
 * Our LiveTalking server implements this today; any other face would too.
 */

/** What the interviewer is doing, in words a renderer can map to its own controls. */
export type AvatarState = 'neutral' | 'listening' | 'speaking' | 'thinking'

export interface AvatarRenderer {
  /** Connects and streams the face into this element. Rejects if the provider is unavailable. */
  attach(video: HTMLVideoElement): Promise<void>

  /**
   * A chunk of the interviewer's turn, 24 kHz PCM16 as it arrives from the gateway.
   * The renderer converts to whatever its provider needs. Called only while attached.
   */
  pushAudio(turnSeq: number, pcm: Int16Array): void

  /** The candidate cut in: stop the mouth now and drop anything still queued. */
  interrupt(): void

  setState(state: AvatarState): void

  /**
   * True when the provider speaks the audio itself, on a track locked to the face
   * it renders. Then that track is what the candidate hears and `PcmPlayer` runs
   * silently as the clock and the recording feed — lips and voice cannot drift.
   */
  readonly providesAudio: boolean

  /**
   * How far the face lags the audio, in milliseconds, for a provider that does not
   * speak for itself. Playback is delayed by this much so lips and sound line up.
   */
  readonly videoLagMs: number

  /**
   * Called if the provider ends the face mid-call (out of credit, network, provider
   * restart). Returns an unsubscribe function. Not called after `dispose()`.
   */
  onEnded?(listener: (reason: string) => void): () => void

  dispose(): void
}

/** A renderer that failed at any point is replaced by `noneRenderer`, and the interview continues. */
export type AvatarFailure = 'unsupported' | 'unavailable' | 'quota' | 'consent'
