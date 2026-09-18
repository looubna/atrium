/**
 * Records the candidate's camera during a live session. Video only: the server
 * already records both voices, and the feedback player keeps the video in sync
 * with that audio using `startedAtMediaMs` on the session's media clock.
 *
 * Chunks are held as Blobs, which browsers page to disk for large recordings.
 */

/** Preferred first: MP4 plays everywhere (Safari/iOS records only MP4). */
const TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

/** Mirrors the API's `max_video_bytes`. */
export const MAX_VIDEO_BYTES = 1024 ** 3
const VIDEO_BITS_PER_SECOND = 600_000
const TIMESLICE_MS = 5_000

export type VideoContentType = 'video/mp4' | 'video/webm'

export interface VideoRecording {
  blob: Blob
  contentType: VideoContentType
  startedAtMediaMs: number
}

export function pickVideoType(isTypeSupported: (type: string) => boolean): string | null {
  return TYPES.find((type) => isTypeSupported(type)) ?? null
}

export function cameraRecordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && pickVideoType((t) => MediaRecorder.isTypeSupported(t)) !== null
}

export class CameraRecorder {
  private readonly recorder: MediaRecorder
  private readonly chunks: Blob[] = []
  private bytes = 0
  readonly contentType: VideoContentType
  private readonly finished: Promise<VideoRecording | null>

  constructor(
    track: MediaStreamTrack,
    readonly startedAtMediaMs: number,
  ) {
    const mimeType = pickVideoType((t) => MediaRecorder.isTypeSupported(t))
    if (!mimeType) throw new Error('This device cannot record video')
    this.contentType = mimeType.startsWith('video/mp4') ? 'video/mp4' : 'video/webm'
    this.recorder = new MediaRecorder(new MediaStream([track]), { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND })

    this.finished = new Promise((resolve) => {
      this.recorder.onstop = () =>
        resolve(
          this.bytes > 0
            ? { blob: new Blob(this.chunks, { type: this.contentType }), contentType: this.contentType, startedAtMediaMs }
            : null,
        )
    })
    this.recorder.ondataavailable = (event) => {
      if (!event.data.size) return
      this.chunks.push(event.data)
      this.bytes += event.data.size
      // Stop before the upload limit; the next chunk would be at most a few seconds of video.
      if (this.bytes > MAX_VIDEO_BYTES * 0.97) void this.stop()
    }
    // Turning the camera off ends the track, which finishes the recording.
    track.addEventListener('ended', () => void this.stop(), { once: true })
    this.recorder.start(TIMESLICE_MS)
  }

  /** Finish and return the recording (null if nothing was captured). Safe to call repeatedly. */
  stop(): Promise<VideoRecording | null> {
    if (this.recorder.state !== 'inactive') this.recorder.stop()
    return this.finished
  }
}
