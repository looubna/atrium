import { useEffect, useRef, useState } from 'react'

export interface VoiceActivity {
  /** The microphone is open and being analysed. */
  available: boolean
  /** Access was refused or is impossible here (no API, or not a secure context). */
  denied: boolean
  /** Speech-level sound in the last few hundred milliseconds. */
  speaking: boolean
  /** Smoothed RMS level, 0..~0.3, for a small meter. */
  level: number
}

const IDLE: VoiceActivity = { available: false, denied: false, speaking: false, level: 0 }

/** RMS above this counts as the presenter talking (echo cancellation and noise suppression are on). */
const SPEECH_RMS = 0.02
/** Speech keeps counting for this long after the last loud sample, bridging gaps between words. */
const HANGOVER_MS = 350
/** State updates are throttled; the meter does not need 60 fps of React renders. */
const UPDATE_MS = 100

export interface VoiceOptions {
  /**
   * Also record while active (a Practice Center round). The recording is handed over
   * when listening stops; nothing is recorded unless this is set.
   */
  onRecording?: (recording: Blob) => void
  /** Pause the recording without closing the microphone. */
  paused?: boolean
}

const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

/**
 * Listens to the microphone while `active` and reports whether the user is
 * speaking. Unless `onRecording` is given, nothing is recorded or sent anywhere:
 * samples are read from an AnalyserNode and discarded.
 *
 * Browsers only allow microphone access in a secure context — localhost or
 * HTTPS. Over a plain http:// LAN address this reports `denied`.
 */
export function useVoiceActivity(active: boolean, options: VoiceOptions = {}): VoiceActivity {
  const [state, setState] = useState<VoiceActivity>(IDLE)
  const onRecording = useRef(options.onRecording)
  onRecording.current = options.onRecording
  const wantsRecording = Boolean(options.onRecording)
  const recorderRef = useRef<MediaRecorder | null>(null)

  useEffect(() => {
    const recorder = recorderRef.current
    if (!recorder) return
    if (options.paused && recorder.state === 'recording') recorder.pause()
    if (!options.paused && recorder.state === 'paused') recorder.resume()
  }, [options.paused])

  useEffect(() => {
    if (!active) {
      setState(IDLE)
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({ ...IDLE, denied: true })
      return
    }

    let cancelled = false
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let raf = 0

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop())
          return
        }
        stream = media
        if (wantsRecording && typeof MediaRecorder !== 'undefined') {
          const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
          // Speech needs little: 48 kbps keeps a three-minute answer around a megabyte.
          const recorder = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 48_000 })
          const parts: Blob[] = []
          recorder.ondataavailable = (event) => {
            if (event.data.size) parts.push(event.data)
          }
          recorder.onstop = () => {
            media.getTracks().forEach((t) => t.stop())
            onRecording.current?.(new Blob(parts, { type: recorder.mimeType || mimeType || 'audio/webm' }))
          }
          recorder.start(1000)
          recorderRef.current = recorder
        }
        ctx = new AudioContext()
        void ctx.resume()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        ctx.createMediaStreamSource(media).connect(analyser)

        const samples = new Float32Array(analyser.fftSize)
        let lastSpeech = 0
        let lastUpdate = 0
        let level = 0

        const tick = (now: number) => {
          analyser.getFloatTimeDomainData(samples)
          let sum = 0
          for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
          const rms = Math.sqrt(sum / samples.length)
          level = level * 0.8 + rms * 0.2
          if (rms > SPEECH_RMS) lastSpeech = now

          if (now - lastUpdate > UPDATE_MS) {
            lastUpdate = now
            const speaking = now - lastSpeech < HANGOVER_MS
            setState((s) =>
              s.available && s.speaking === speaking && Math.abs(s.level - level) < 0.004
                ? s
                : { available: true, denied: false, speaking, level },
            )
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      })
      .catch(() => {
        if (!cancelled) setState({ ...IDLE, denied: true })
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      const recorder = recorderRef.current
      recorderRef.current = null
      // The recorder stops the tracks once it has flushed the last piece.
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      else stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
    }
  }, [active, wantsRecording])

  return state
}
