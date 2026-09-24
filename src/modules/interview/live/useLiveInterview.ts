import { useCallback, useEffect, useRef, useState } from 'react'
import captureWorkletUrl from '@/platform/media/pcm-capture.worklet.ts?worker&url'
import { appCheckToken } from '@/platform/appcheck'
import { websocketUrl } from '@/platform/env'
import { idToken } from '@/platform/firebase'
import { LiveClient } from '@/platform/live/liveClient'
import { CloseCode, ForbiddenReason, type EndReason, type ServerMessage } from '@/platform/live/protocol'
import type { AvatarRenderer } from '@/platform/avatar/types'
import { PcmPlayer, type SpeakerTone } from '@/platform/media/pcmPlayer'
import { setKeepAwake } from '@/platform/native'

export type LivePhase = 'idle' | 'starting' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'failed'

export type LiveFailure =
  | 'mic_denied'
  | 'unsupported'
  | 'forbidden'
  | 'email_unverified'
  | 'origin_blocked'
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
  /**
   * The lead's own voice is audible right now.
   *
   * Not the same as `interviewerSpeaking`, which turns on when a turn is *queued* — and a
   * colleague's question is queued behind the lead's hand-over, so for that stretch the lead
   * counts as speaking while the voice about to be heard is somebody else's. A tile can live
   * with that; a room that films one person per speaker cannot, because it would show the lead
   * talking and then jump. This one turns on when the audio actually starts playing.
   */
  leadVoicing: boolean
  /** Smoothed microphone level, 0..1, for a meter. */
  micLevel: number
  captions: Caption[]
  /** Remaining time from the server's limit, counted down locally. */
  timeLeftMs: number | null
  coding: boolean
  /** What the examiner has written on the board, when this session has one. */
  boardProblem: string | null
  headphones: boolean
  muted: boolean
}

const INITIAL: LiveInterviewState = {
  phase: 'idle',
  interviewerSpeaking: false,
  panelSpeaker: null,
  leadVoicing: false,
  micLevel: 0,
  captions: [],
  timeLeftMs: null,
  coding: false,
  boardProblem: null,
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
/**
 * How often to ask a face whether it is still speaking, while a turn waits for it to finish.
 * Matches the renderer's own meter: polling faster only re-reads the same `isVoicing` window.
 */
const FACE_QUIET_POLL_MS = 40
/**
 * How long to let a face begin before believing its silence. `PcmPlayer` can reach the nominal
 * end of a turn before the face has uttered a word of it — the handoff is scheduled on our clock
 * and the face then buffers, decodes and paces to 25 fps — and a face that has not started yet
 * reads exactly like one that has finished.
 *
 * Sized for a renderer that does not reach 25 fps: MuseTalk on an L4 measures about 16
 * (`scratch/musetalk-test/results/`), so it runs roughly a third behind and a few seconds of
 * question can pass before the first word arrives. Believing the silence there ends the turn
 * before it has been spoken, the server sends the next one, and the question the candidate was
 * listening to is flushed mid-sentence.
 */
const FACE_START_GRACE_MS = 4_000
/**
 * A face that never goes quiet must not strand the interview. The server waits on this report
 * before letting anyone else speak, on the same loop that carries the interviewer's own audio, so
 * every extra second here is the whole interview holding its breath. A face whose level meter has
 * stopped working never reports quiet at all, and a minute of that reads as the interviewer having
 * given up. The turn's audio has already finished by the time we are polling; this is only slack
 * for a face still catching up.
 */
const FACE_QUIET_TIMEOUT_MS = 12_000
/**
 * How long a face must stay quiet before its turn counts as finished, on top of the renderer's
 * own 250 ms `isVoicing` window — so a little under half a second of real silence. Enough for the
 * breath between sentences, and no more: every millisecond here is dead air the candidate hears
 * between the hand-over and the colleague who answers it.
 *
 * A renderer behind real time delivers its audio in bursts, so `isVoicing` drops to false between
 * bursts of a sentence it is still speaking; 200 ms of that was short enough to call a turn
 * finished mid-question.
 */
const FACE_QUIET_HOLD_MS = 600
const MAX_CAPTIONS = 6

const FAILURE_BY_CLOSE: Record<number, LiveFailure> = {
  [CloseCode.FORBIDDEN]: 'forbidden',
  [CloseCode.NOT_FOUND]: 'not_found',
  [CloseCode.CONFLICT]: 'conflict',
  [CloseCode.QUOTA]: 'quota',
}

/**
 * What went wrong, from the close code and the gateway's own reason.
 *
 * 4403 covers everything the account is not allowed to do, and those are not one message: being
 * asked to accept recording when the recording consent is already given, and the address is what
 * needs verifying, is how someone ends up stuck with nothing to fix.
 */
function failureFor(code: number | undefined, reason: string | undefined): LiveFailure {
  if (code === CloseCode.FORBIDDEN) {
    if (reason === ForbiddenReason.EMAIL_UNVERIFIED) return 'email_unverified'
    if (reason === ForbiddenReason.ORIGIN) return 'origin_blocked'
  }
  return (code !== undefined && FAILURE_BY_CLOSE[code]) || 'unavailable'
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
  /** The board as a JPEG (base64, no data: prefix): what the student wrote by hand. */
  sendBoardImage: (jpegBase64: string) => void
  /** With `holdOpening`: the candidate is in place, so the interviewer may open now. */
  begin: () => void
  /** A presentation: the speaker takes questions (the server holds the audience silent until then). */
  release: () => void
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
  /**
   * Connect as soon as possible but keep the interviewer quiet until `begin()`: the connection
   * is made while the candidate is still on their way in, so it is off the wait when they sit.
   */
  holdOpening = false,
  /** How the voice is shaped for the speakers; the default is the interview voices'. */
  speakerTone?: SpeakerTone,
): LiveInterviewControls {
  const [state, setState] = useState<LiveInterviewState>(INITIAL)
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null)
  // The face usually arrives after the call starts, so callbacks read it through a ref.
  const avatarRef = useRef<AvatarRenderer | null>(avatar)

  const ctxRef = useRef<AudioContext | null>(null)
  const clientRef = useRef<LiveClient | null>(null)
  const beganRef = useRef(false)
  const speakerToneRef = useRef(speakerTone)
  const holdOpeningRef = useRef(holdOpening)
  holdOpeningRef.current = holdOpening
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

  /**
   * Which session the audio belongs to. A teardown moves it on, so anything still being opened
   * when it happens knows it is already orphaned.
   */
  const generationRef = useRef(0)

  const teardown = useCallback(() => {
    generationRef.current += 1
    cleanupRef.current?.()
    cleanupRef.current = null
  }, [])

  /** A start that has begun but not yet finished wiring itself up. */
  const startingRef = useRef(false)

  const open = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      patch({ phase: 'failed', failure: 'unsupported' })
      return
    }
    patch({ ...INITIAL, phase: 'starting', headphones: headphonesRef.current })
    beganRef.current = false

    // iOS/Safari: keep speaker output while the mic is open instead of dropping to the earpiece.
    const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (audioSession) audioSession.type = 'play-and-record'

    const generation = generationRef.current
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

    // Torn down while the microphone was being granted. `cleanupRef` is not set yet, so the
    // teardown found nothing to close and this context would otherwise outlive the room that
    // asked for it — an orphaned graph holds the audio device open and the microphone live, and
    // is exactly the buzz that nothing on screen can stop.
    if (generationRef.current !== generation) {
      stream.getTracks().forEach((track) => track.stop())
      void ctx.close()
      if (ctxRef.current === ctx) ctxRef.current = null
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
      holdOpening: holdOpeningRef.current,
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
      onStatus: (status, code, reason) => {
        if (status === 'failed') {
          patch({ phase: 'failed', failure: failureFor(code, reason) })
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
          case 'board_write':
            patch({ boardProblem: message.text })
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
    if (beganRef.current) client.begin()

    const panelTimers = new Set<number>()
    // Turns waiting on a face to stop speaking. Kept apart from `panelTimers`, which the
    // tile logic clears wholesale on every turn start.
    const quietPolls = new Set<number>()
    const player = new PcmPlayer(ctx, toMediaMs, {
      onTurnStart: (turnSeq, at) => {
        client.send({ type: 'playback_started', turnSeq, mediaMs: Math.round(at) })
        const colleague = panelTurnsRef.current.get(turnSeq)
        // Say whose voice it is when it actually starts, not when it was queued: this turn may
        // be waiting behind one still playing.
        const timer = window.setTimeout(() => {
          panelTimers.delete(timer)
          patch({ panelSpeaker: colleague ?? null, leadVoicing: colleague === undefined })
        }, Math.max(0, at - toMediaMs(ctx.currentTime)))
        panelTimers.add(timer)
      },
      onTurnStop: (turnSeq, at) => {
        lastPlaybackEndRef.current = ctx.currentTime
        const colleague = panelTurnsRef.current.get(turnSeq)
        const face = colleague === undefined ? avatarRef.current : panelFacesRef.current[colleague]
        const done = (endedAt: number) => {
          client.send({ type: 'playback_stopped', turnSeq, mediaMs: Math.round(endedAt) })
          // Nobody's voice is audible until the next turn's own timer says so.
          panelTurnsRef.current.delete(turnSeq)
          panelTimers.forEach((timer) => window.clearTimeout(timer))
          panelTimers.clear()
          patch({ panelSpeaker: null, leadVoicing: false })
        }
        // A turn a face spoke is not over when our clock says so. `PcmPlayer` schedules every
        // turn back to back and reaches the end of this one on time whether or not the face did;
        // the face runs behind by however far its renderer has fallen back. Reporting the nominal
        // end is what lets the server start the next speaker over the top of one still talking —
        // the lead's face finishing a sentence while a colleague's question plays. So the turn
        // ends when the voice the candidate actually hears stops.
        if (!face?.providesAudio || !face.isVoicing) {
          done(at)
          return
        }
        const startedAt = ctx.currentTime
        let heard = false
        let quietSince: number | null = null
        const finish = (poll: number) => {
          quietPolls.delete(poll)
          window.clearInterval(poll)
          done(toMediaMs(ctx.currentTime))
        }
        const poll = window.setInterval(() => {
          const waited = (ctx.currentTime - startedAt) * 1000
          if (face.isVoicing?.()) {
            heard = true
            quietSince = null
          } else if (heard) {
            // Sentence gaps read as silence, so quiet has to hold before it means finished.
            quietSince ??= ctx.currentTime
            if ((ctx.currentTime - quietSince) * 1000 >= FACE_QUIET_HOLD_MS) finish(poll)
            return
          } else if (waited > FACE_START_GRACE_MS) {
            finish(poll) // it never began: nothing of this turn is audible to talk over
            return
          }
          if (waited > FACE_QUIET_TIMEOUT_MS) finish(poll)
        }, FACE_QUIET_POLL_MS)
        quietPolls.add(poll)
      },
      onSpeakingChange: (speaking) => {
        if (!speaking) pendingAvatarRef.current?.()
        patch({ interviewerSpeaking: speaking, ...(speaking ? {} : { leadVoicing: false, panelSpeaker: null }) })
      },
    }, speakerToneRef.current)
    playerRef.current = player
    player.setAudible(!avatarRef.current?.providesAudio)

    const mix = ctx.createMediaStreamDestination()
    source.connect(mix)
    player.output.connect(mix)
    setRecordingStream(mix.stream)

    let seq = 0
    let level = 0
    let lastLevelUpdate = 0
    let lastFaceVoice = -Infinity
    capture.port.onmessage = (event: MessageEvent<{ pcm: Int16Array; startTime: number }>) => {
      const { pcm, startTime } = event.data
      const faceVoiced = Boolean(avatarRef.current?.providesAudio) || Object.keys(panelFacesRef.current).length > 0
      const tail = ECHO_TAIL_S + (faceVoiced ? FACE_VOICE_TAIL_S : 0)
      // A face speaks behind our clock by however far its renderer has fallen behind, so the
      // clock's tail alone can reopen the mic mid-sentence. Also hold it while one is audible.
      const faces = [avatarRef.current, ...Object.values(panelFacesRef.current)]
      if (faces.some((face) => face?.isVoicing?.())) lastFaceVoice = ctx.currentTime
      const echoWindow =
        player.isSpeaking ||
        ctx.currentTime - lastPlaybackEndRef.current < tail ||
        // The same tail as the clock's, not the bare one: `isVoicing` reads a 250 ms window of a
        // stream that arrives in bursts when the renderer is behind real time, so it drops to
        // false between bursts of a sentence it is still speaking. A 300 ms hold reopens the
        // microphone into the room while the face is audible, the server hears its own voice as
        // the candidate cutting in, and the turn is cut off mid-sentence.
        ctx.currentTime - lastFaceVoice < tail

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
      quietPolls.forEach((t) => window.clearInterval(t))
      quietPolls.clear()
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
    // Left the call (or it was torn down) while waiting for the interviewer's face. `cleanup` has
    // run by now if that happened, so the context is already closed; returning only avoids
    // connecting a socket for a room nobody is in.
    if (cleanupRef.current !== cleanup || generationRef.current !== generation) return
    client.connect()
  }, [patch, sessionId, teardown])

  /**
   * Open the session, once.
   *
   * `cleanupRef` is not set until the audio graph, the microphone and the worklet have all been
   * awaited, so it cannot be the only guard: two calls inside that window both pass it, and the
   * first context and microphone are then orphaned — running, audible and unreachable for the
   * rest of the session. Two copies of the interviewer a few milliseconds apart is a continuous
   * buzz that nothing on screen can stop. This flag is set before any await.
   */
  const start = useCallback(async () => {
    if (!sessionId || cleanupRef.current || startingRef.current) return
    startingRef.current = true
    try {
      await open()
    } finally {
      startingRef.current = false
    }
  }, [open, sessionId])

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
    sendBoardImage: useCallback(
      (jpegBase64: string) =>
        clientRef.current?.send({ type: 'board_image', mediaMs: Math.round(mediaMs()), jpegBase64 }),
      [mediaMs],
    ),
    begin: useCallback(() => {
      beganRef.current = true
      clientRef.current?.begin()
    }, []),
    /** A presentation: the speaker takes questions (the server holds the audience silent until then). */
    release: useCallback(() => clientRef.current?.send({ type: 'release' }), []),
    recordingStream,
    mediaMs,
  }
}
