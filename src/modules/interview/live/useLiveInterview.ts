import { useCallback, useEffect, useRef, useState } from 'react'
import captureWorkletUrl from '@/platform/media/pcm-capture.worklet.ts?worker&url'
import { appCheckToken } from '@/platform/appcheck'
import { websocketUrl } from '@/platform/env'
import { idToken } from '@/platform/firebase'
import { LiveClient } from '@/platform/live/liveClient'
import { CloseCode, type EndReason, type ServerMessage } from '@/platform/live/protocol'
import type { AvatarRenderer } from '@/platform/avatar/types'
import { PcmPlayer } from '@/platform/media/pcmPlayer'
import { setKeepAwake } from '@/platform/native'

export type LivePhase = 'idle' | 'starting' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'failed'

export type LiveFailure =
  | 'mic_denied'
  | 'unsupported'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'quota'
  | 'unavailable'

export interface Caption {
  speaker: 'interviewer' | 'candidate'
  text: string
  final: boolean
}

export interface LiveInterviewState {
  phase: LivePhase
  failure?: LiveFailure
  endReason?: EndReason
  /** Someone on the interviewer side is talking: the lead or a panel colleague. */
  interviewerSpeaking: boolean
  /** The panel colleague whose question is playing right now, if any. */
  panelSpeaker: string | null
  /** Smoothed microphone level, 0..1, for a meter. */
  micLevel: number
  captions: Caption[]
  /** Remaining time from the server's limit, counted down locally. */
  timeLeftMs: number | null
  coding: boolean
  headphones: boolean
  muted: boolean
}

const INITIAL: LiveInterviewState = {
  phase: 'idle',
  interviewerSpeaking: false,
  panelSpeaker: null,
  micLevel: 0,
  captions: [],
  timeLeftMs: null,
  coding: false,
  headphones: false,
  muted: false,
}

/** After the interviewer stops, keep the mic closed briefly so the speaker's tail doesn't echo back. */
const ECHO_TAIL_S = 0.3
/** A face speaks the words about a second after our clock schedules them; keep the mic closed that much longer. */
const FACE_VOICE_TAIL_S = 1.2
const NO_FACES: Record<string, AvatarRenderer> = {}
/** Hand a face its audio slightly early: it streams in pieces and needs a moment to start. */
const FACE_HANDOFF_EARLY_MS = 120
const MAX_CAPTIONS = 6

const FAILURE_BY_CLOSE: Record<number, LiveFailure> = {
  [CloseCode.FORBIDDEN]: 'forbidden',
  [CloseCode.NOT_FOUND]: 'not_found',
  [CloseCode.CONFLICT]: 'conflict',
  [CloseCode.QUOTA]: 'quota',
}

export interface LiveInterviewControls {
  state: LiveInterviewState
  /** Must be called from a user gesture (tap): opens the mic and audio output. */
  start: () => Promise<void>
  end: () => void
  /** Silence the interviewer now and open the mic. */
  interrupt: () => void
  setHeadphones: (on: boolean) => void
  setMuted: (on: boolean) => void
  sendCodeSnapshot: (language: string, text: string) => void
  /** Microphone plus interviewer audio, for the session recording. */
  recordingStream: MediaStream | null
  /** Current position on the session's media clock. */
  mediaMs: () => number
}

function appendCaption(captions: Caption[], next: Caption): Caption[] {
  const last = captions[captions.length - 1]
  if (last && last.speaker === next.speaker && !last.final) {
    const text = next.final ? next.text || last.text : last.text + next.text
    return [...captions.slice(0, -1), { speaker: next.speaker, text, final: next.final }]
  }
  if (!next.text.trim()) return captions
  return [...captions, next].slice(-MAX_CAPTIONS)
}

/**
 * The candidate's side of a live interview. One AudioContext drives capture,
 * playback and the recording mix, so every timestamp shares one media clock.
 *
 * Without headphones the microphone is gated while the interviewer speaks
 * (plus a short tail): the phone's speaker would otherwise be heard by the mic
 * and interrupt the interviewer. `interrupt()` lets the candidate cut in.
 */
export function useLiveInterview(
  sessionId: string | null,
  /**
   * The interviewer's face, when there is one. It receives a copy of the same audio
   * the player schedules; if it speaks for itself, the player runs silently so the
   * voice comes from the track that matches the lips. Passing null changes nothing.
   */
  avatar: AvatarRenderer | null = null,
  /** Panel colleagues whose own faces are on screen, by name; they speak their own questions. */
  panelFaces: Record<string, AvatarRenderer> = NO_FACES,
  /**
   * Resolves when the call may connect: the interviewer's face has joined (or won't).
   * The interviewer speaks as soon as the call connects, so its face must be there first.
   */
  beforeConnect?: () => Promise<void>,
): LiveInterviewControls {
  const [state, setState] = useState<LiveInterviewState>(INITIAL)
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null)
  // The face usually arrives after the call starts, so callbacks read it through a ref.
  const avatarRef = useRef<AvatarRenderer | null>(avatar)

  const ctxRef = useRef<AudioContext | null>(null)
  const clientRef = useRef<LiveClient | null>(null)
  const playerRef = useRef<PcmPlayer | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const t0Ref = useRef(0)
  const headphonesRef = useRef(false)
  const mutedRef = useRef(false)
  const lastPlaybackEndRef = useRef(0)
  const reconnectPendingRef = useRef(false)
  const deadlineRef = useRef<number | null>(null)
  // Turns the server voiced for a panel colleague, by turn number.
  const panelTurnsRef = useRef(new Map<number, string>())
  const panelFacesRef = useRef(panelFaces)
  panelFacesRef.current = panelFaces
  const dropFaceHandoffsRef = useRef<(() => void) | null>(null)
  const beforeConnectRef = useRef(beforeConnect)
  beforeConnectRef.current = beforeConnect

  const patch = useCallback((update: Partial<LiveInterviewState>) => setState((s) => ({ ...s, ...update })), [])

  const pendingAvatarRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const apply = () => {
      pendingAvatarRef.current = null
      avatarRef.current = avatar
      // A face that speaks for itself becomes the voice; ours keeps the clock and the recording.
      playerRef.current?.setAudible(!avatar?.providesAudio)
    }
    // A face arriving mid-sentence takes over at the next turn, so the words already
    // queued on our speaker are not cut off. Losing the face switches back at once.
    if (avatar && playerRef.current?.isSpeaking) pendingAvatarRef.current = apply
    else apply()
  }, [avatar])

  const mediaMs = useCallback(() => {
    const ctx = ctxRef.current
    return ctx ? Math.max(0, (ctx.currentTime - t0Ref.current) * 1000) : 0
  }, [])

  const teardown = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
  }, [])

  const start = useCallback(async () => {
    if (!sessionId || cleanupRef.current) return
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      patch({ phase: 'failed', failure: 'unsupported' })
      return
    }
    patch({ ...INITIAL, phase: 'starting', headphones: headphonesRef.current })

    // iOS/Safari: keep speaker output while the mic is open instead of dropping to the earpiece.
    const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (audioSession) audioSession.type = 'play-and-record'

    const ctx = new AudioContext({ latencyHint: 'interactive' })
    ctxRef.current = ctx
    let stream: MediaStream
    try {
      await ctx.resume()
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
      await ctx.audioWorklet.addModule(captureWorkletUrl)
    } catch (error) {
      void ctx.close()
      ctxRef.current = null
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      patch({ phase: 'failed', failure: denied ? 'mic_denied' : 'unsupported' })
      return
    }

    const source = ctx.createMediaStreamSource(stream)
    const capture = new AudioWorkletNode(ctx, 'pcm-capture')
    const sink = ctx.createGain()
    sink.gain.value = 0
    source.connect(capture)
    capture.connect(sink).connect(ctx.destination)

    t0Ref.current = ctx.currentTime
    const toMediaMs = (contextTime: number) => Math.max(0, (contextTime - t0Ref.current) * 1000)

    // Face hand-offs still waiting for their moment; dropped when the interviewer is cut off.
    const faceTimers = new Set<number>()
    // Per turn: its pieces waiting for the turn to start, or 'started' once the face has it.
    const faceTurns = new Map<number, Int16Array[] | 'started'>()
    const dropFaceHandoffs = () => {
      faceTimers.forEach((timer) => window.clearTimeout(timer))
      faceTimers.clear()
      // A cut-off turn stays cut off: its late pieces must not restart the face.
      for (const seq of faceTurns.keys()) faceTurns.set(seq, [])
    }
    dropFaceHandoffsRef.current = dropFaceHandoffs
    const client = new LiveClient({
      url: websocketUrl(`/api/v1/sessions/${sessionId}/live`),
      idToken,
      appCheckToken,
      onAudio: ({ turnSeq, pcm }) => {
        const player = playerRef.current
        if (!player) return
        const colleague = panelTurnsRef.current.get(turnSeq)
        // The lead's face, a colleague's own face, or nobody's (our speaker plays it).
        const face = colleague === undefined ? avatarRef.current : panelFacesRef.current[colleague]
        const route = colleague === undefined ? 'lead' : face ? 'silent' : 'always'
        const start = player.enqueue(turnSeq, pcm, route)
        if (!face) return
        // Audio arrives faster than it is spoken, and a face starts speaking whatever it is given
        // at once. So each turn is handed over when it is due (faces never talk over each other),
        // and from then on every piece goes straight through: the face buffers ahead, and a busy
        // page can't starve it mid-sentence.
        const handoff = faceTurns.get(turnSeq)
        if (handoff === 'started') {
          face.pushAudio(turnSeq, pcm)
          return
        }
        if (handoff) {
          handoff.push(pcm)
          return
        }
        const due = (start - ctx.currentTime) * 1000 - FACE_HANDOFF_EARLY_MS
        if (due <= 0) {
          faceTurns.set(turnSeq, 'started')
          face.pushAudio(turnSeq, pcm)
          return
        }
        const waiting = [pcm]
        faceTurns.set(turnSeq, waiting)
        const timer = window.setTimeout(() => {
          faceTimers.delete(timer)
          faceTurns.set(turnSeq, 'started')
          waiting.forEach((piece) => face.pushAudio(turnSeq, piece))
        }, due)
        faceTimers.add(timer)
        for (const seq of faceTurns.keys()) if (seq < turnSeq - 8) faceTurns.delete(seq)
      },
      onStatus: (status, code) => {
        if (status === 'failed') {
          patch({ phase: 'failed', failure: (code !== undefined && FAILURE_BY_CLOSE[code]) || 'unavailable' })
          teardown()
        } else if (status === 'ended') {
          patch({ phase: 'ended' })
          teardown()
        } else {
          patch({ phase: status === 'live' ? 'live' : status })
        }
      },
      onMessage: (message: ServerMessage) => {
        switch (message.type) {
          case 'ready':
            deadlineRef.current = performance.now() + (message.maxDurationMs - message.elapsedMs)
            patch({ coding: message.coding })
            break
          case 'caption':
            setState((s) => ({ ...s, captions: appendCaption(s.captions, message) }))
            break
          case 'panel_speaker':
            panelTurnsRef.current.set(message.turnSeq, message.name)
            break
          case 'interrupted':
            dropFaceHandoffs()
            playerRef.current?.flush()
            avatarRef.current?.interrupt()
            Object.values(panelFacesRef.current).forEach((face) => face.interrupt())
            break
          case 'turn_complete':
            if (reconnectPendingRef.current) {
              reconnectPendingRef.current = false
              clientRef.current?.reconnectNow()
            }
            break
          case 'time_left':
            deadlineRef.current = performance.now() + message.ms
            break
          case 'reconnect_soon':
            reconnectPendingRef.current = true
            break
          case 'ended':
            patch({ endReason: message.reason })
            break
        }
      },
    })
    clientRef.current = client

    const panelTimers = new Set<number>()
    const player = new PcmPlayer(ctx, toMediaMs, {
      onTurnStart: (turnSeq, at) => {
        client.send({ type: 'playback_started', turnSeq, mediaMs: Math.round(at) })
        const colleague = panelTurnsRef.current.get(turnSeq)
        if (colleague) {
          // Light their tile when their voice actually starts, after the lead's line.
          const timer = window.setTimeout(() => {
            panelTimers.delete(timer)
            patch({ panelSpeaker: colleague })
          }, Math.max(0, at - toMediaMs(ctx.currentTime)))
          panelTimers.add(timer)
        }
      },
      onTurnStop: (turnSeq, at) => {
        lastPlaybackEndRef.current = ctx.currentTime
        client.send({ type: 'playback_stopped', turnSeq, mediaMs: Math.round(at) })
        if (panelTurnsRef.current.delete(turnSeq)) {
          panelTimers.forEach((timer) => window.clearTimeout(timer))
          panelTimers.clear()
          patch({ panelSpeaker: null })
        }
      },
      onSpeakingChange: (speaking) => {
        if (!speaking) pendingAvatarRef.current?.()
        patch({ interviewerSpeaking: speaking })
      },
    })
    playerRef.current = player
    player.setAudible(!avatarRef.current?.providesAudio)

    const mix = ctx.createMediaStreamDestination()
    source.connect(mix)
    player.output.connect(mix)
    setRecordingStream(mix.stream)

    let seq = 0
    let level = 0
    let lastLevelUpdate = 0
    capture.port.onmessage = (event: MessageEvent<{ pcm: Int16Array; startTime: number }>) => {
      const { pcm, startTime } = event.data
      const faceVoiced = Boolean(avatarRef.current?.providesAudio) || Object.keys(panelFacesRef.current).length > 0
      const tail = ECHO_TAIL_S + (faceVoiced ? FACE_VOICE_TAIL_S : 0)
      const echoWindow = player.isSpeaking || ctx.currentTime - lastPlaybackEndRef.current < tail
      const gated = mutedRef.current || (!headphonesRef.current && echoWindow)
      client.sendAudio(seq++, toMediaMs(startTime), gated ? new Int16Array(pcm.length) : pcm)

      let sum = 0
      for (let i = 0; i < pcm.length; i += 4) sum += (pcm[i] / 0x8000) ** 2
      level = level * 0.7 + Math.sqrt(sum / (pcm.length / 4)) * 0.3
      const now = performance.now()
      if (now - lastLevelUpdate > 120) {
        lastLevelUpdate = now
        patch({ micLevel: gated ? 0 : Math.min(1, level * 4) })
      }
    }

    // iOS suspends audio for calls, Siri or backgrounding; resume when the app returns.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && ctx.state !== 'running') void ctx.resume()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => {
      if (deadlineRef.current !== null) patch({ timeLeftMs: Math.max(0, deadlineRef.current - performance.now()) })
    }, 500)

    cleanupRef.current = () => {
      window.clearInterval(timer)
      panelTimers.forEach((t) => window.clearTimeout(t))
      dropFaceHandoffs()
      dropFaceHandoffsRef.current = null
      panelTurnsRef.current.clear()
      document.removeEventListener('visibilitychange', onVisible)
      capture.port.onmessage = null
      client.close()
      player.dispose()
      source.disconnect()
      capture.disconnect()
      stream.getTracks().forEach((track) => track.stop())
      void ctx.close()
      ctxRef.current = null
      clientRef.current = null
      playerRef.current = null
      setRecordingStream(null)
      void setKeepAwake(false)
    }

    const cleanup = cleanupRef.current
    patch({ phase: 'connecting' })
    void setKeepAwake(true)
    await beforeConnectRef.current?.().catch(() => {})
    // Left the call (or it was torn down) while waiting for the interviewer's face.
    if (cleanupRef.current !== cleanup) return
    client.connect()
  }, [patch, sessionId, teardown])

  // A different session (or leaving the call) releases the mic, audio and socket.
  useEffect(() => {
    setState({ ...INITIAL, headphones: headphonesRef.current })
    return teardown
  }, [sessionId, teardown])

  return {
    state,
    start,
    end: useCallback(() => clientRef.current?.end(), []),
    interrupt: useCallback(() => {
      dropFaceHandoffsRef.current?.()
      playerRef.current?.flush()
      avatarRef.current?.interrupt()
      Object.values(panelFacesRef.current).forEach((face) => face.interrupt())
    }, []),
    setHeadphones: useCallback(
      (on: boolean) => {
        headphonesRef.current = on
        patch({ headphones: on })
      },
      [patch],
    ),
    setMuted: useCallback(
      (on: boolean) => {
        mutedRef.current = on
        patch({ muted: on })
      },
      [patch],
    ),
    sendCodeSnapshot: useCallback(
      (language: string, text: string) =>
        clientRef.current?.send({ type: 'code_snapshot', mediaMs: Math.round(mediaMs()), language, text }),
      [mediaMs],
    ),
    recordingStream,
    mediaMs,
  }
}
