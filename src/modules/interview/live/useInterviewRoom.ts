import { useCallback, useEffect, useRef, useState } from 'react'
import { PANEL, PANEL_IN_PERSON } from '@/data/interviewers'
import { saveFaceMetrics, type FaceModule } from '@/modules/interview/api'
import type { AvatarRenderer } from '@/platform/avatar/types'
import { useAvatar, type FilmedFace } from '@/platform/avatar/useAvatar'
import { CameraRecorder, cameraRecordingSupported } from '@/platform/media/cameraRecorder'
import { FaceTracker, type FaceTrackerOptions, type Framing } from '@/platform/media/faceMetrics'
import { useLiveInterview } from './useLiveInterview'
import { uploadSessionVideo, useVideoUploads } from './videoUploads'

/** Fresh face sessions per call when the provider ends them (free plans cap a session at ~3 min). */
const MAX_FACE_RECONNECTS = 20

/**
 * How long the interview waits for the interviewer's face before going on without it.
 *
 * Nobody should sit in front of a still photograph wondering whether the app has hung, so this
 * is deliberately shorter than a face server's worst case rather than long enough to cover it.
 * Missing the deadline costs nothing: the interview opens on the room photo and the voice, and
 * the face joins the moment its session lands (`useAvatar` swaps the renderer in mid-call, the
 * same path a mid-interview reconnect takes). Waiting longer would only trade a face that
 * arrives a few seconds late for a candidate staring at a frozen screen.
 */
const FACE_JOIN_TIMEOUT_MS = 8_000

/**
 * Everything a live interview needs, wherever it happens (a video call or the meeting room):
 * the conversation, the interviewer's and colleagues' live faces (joining, failing, reconnecting
 * when the provider ends a session), the camera recording and the on-device face measurements.
 */
export function useInterviewRoom({
  sessionId,
  camera,
  beforeConnect,
  openWhen,
  tracker,
  module = 'interview',
  faces = true,
  filmed = null,
}: {
  /** The live session, or null when no interview runs here. */
  sessionId: string | null
  /** The candidate's camera, when on: recorded for feedback and measured on the device. */
  camera: MediaStream | null
  /** Resolves when the interviewer may start talking (besides their face having joined). */
  beforeConnect?: () => Promise<void>
  /**
   * When given, the call connects as soon as the face has joined, but the interviewer only
   * opens once this is true (the candidate has sat down): the connection is made on the way in.
   */
  openWhen?: boolean
  tracker?: FaceTrackerOptions
  /** Which module's session this is: it decides whose face joins. */
  module?: FaceModule
  /**
   * False where nobody's face is ever drawn — the meeting room, which is filmed footage of the
   * people in it. No face is asked for, so none is waited for and none of the provider's minutes
   * are spent on a stream nothing would show.
   */
  faces?: boolean
  /**
   * Who to fall back to filmed clips for when the lip-sync server is unreachable: the
   * person still talks and moves, just without their mouth matching the words.
   */
  filmed?: FilmedFace | null
}) {
  // The interviewer's face. If the provider fails at any point we drop it for the rest
  // of the interview and fall back; the interview itself carries on.
  const [avatarFailed, setAvatarFailed] = useState(false)
  // The face becomes the interviewer's voice only once it is on screen; until then (and
  // if it never arrives) the interview plays through our own speaker.
  const [faceOnScreen, setFaceOnScreen] = useState<AvatarRenderer | null>(null)
  useEffect(() => setAvatarFailed(false), [sessionId])
  const onAvatarFailed = useCallback(() => {
    setAvatarFailed(true)
    setFaceOnScreen(null)
  }, [])
  // Panel colleagues' own faces: on screen (and speaking their questions), or failed.
  const [panelFaces, setPanelFaces] = useState<Record<string, AvatarRenderer>>({})
  const [panelFailed, setPanelFailed] = useState<string[]>([])
  // Like a real meeting, the interviewer speaks only once their face has joined (or won't).
  const faceSettledRef = useRef(false)
  const faceWaiters = useRef<(() => void)[]>([])
  const beforeConnectRef = useRef(beforeConnect)
  beforeConnectRef.current = beforeConnect
  const waitForFace = useCallback(async () => {
    await beforeConnectRef.current?.()
    if (faceSettledRef.current) return
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, FACE_JOIN_TIMEOUT_MS)
      faceWaiters.current.push(() => {
        window.clearTimeout(timer)
        resolve()
      })
    })
  }, [])
  const live = useLiveInterview(
    sessionId,
    avatarFailed ? null : faceOnScreen,
    panelFaces,
    waitForFace,
    openWhen !== undefined,
  )
  const { begin } = live
  const callUp = ['connecting', 'live', 'reconnecting'].includes(live.state.phase)
  useEffect(() => {
    if (openWhen && callUp) begin()
  }, [openWhen, callUp, begin])
  const liveActive = ['connecting', 'live', 'reconnecting'].includes(live.state.phase)
  // Faces only while the interview runs: a face waiting in the lobby would spend provider minutes.
  // The provider ends face sessions after a few minutes (and on network trouble): faces that end
  // mid-interview reconnect with fresh sessions, a bounded number of times.
  const [faceGeneration, setFaceGeneration] = useState(0)
  useEffect(() => setFaceGeneration(0), [sessionId])
  const { avatar, unavailable: avatarUnavailable } = useAvatar(
    sessionId,
    faces && Boolean(sessionId) && liveActive,
    faceGeneration,
    module,
    filmed,
  )
  const avatarNow = useRef(avatar)
  avatarNow.current = avatar
  const reconnectedFrom = useRef<typeof avatar>(null)
  const onFaceEnded = useCallback(() => {
    const current = avatarNow.current
    if (!current || reconnectedFrom.current === current) return
    reconnectedFrom.current = current
    setFaceGeneration((generation) => {
      if (generation < MAX_FACE_RECONNECTS) return generation + 1
      setAvatarFailed(true)
      setPanelFailed([...PANEL, ...PANEL_IN_PERSON].map((member) => member.name))
      return generation
    })
  }, [])
  // A face that neither arrives nor fails must not strand the interview. `attach` can hang
  // indefinitely — an unreachable face server answers nothing at all — and everything waiting on
  // the face (the walk to the meeting room, the interviewer's first word) would wait with it.
  // Past the deadline the interview simply goes ahead without it; if the face does land later,
  // `faceOnScreen` swaps it in mid-call exactly as it would have.
  const [faceOverdue, setFaceOverdue] = useState(false)
  useEffect(() => {
    setFaceOverdue(false)
    if (!sessionId || !liveActive) return
    const timer = window.setTimeout(() => setFaceOverdue(true), FACE_JOIN_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [sessionId, liveActive, faceGeneration])
  // Nothing is waiting on a face that was never asked for.
  const faceSettled = !faces || Boolean(faceOnScreen) || avatarFailed || avatarUnavailable || faceOverdue
  faceSettledRef.current = faceSettled
  useEffect(() => {
    if (faceSettled) faceWaiters.current.splice(0).forEach((release) => release())
  }, [faceSettled])
  useEffect(() => {
    if (faceOnScreen && faceOnScreen !== avatar?.renderer) setFaceOnScreen(null)
  }, [avatar, faceOnScreen])
  useEffect(() => {
    setPanelFaces({})
    setPanelFailed([])
  }, [avatar])
  const colleagueLive = useCallback(
    (name: string, renderer: AvatarRenderer) =>
      setPanelFaces((faces) => (faces[name] === renderer ? faces : { ...faces, [name]: renderer })),
    [],
  )
  const colleagueFailed = useCallback((name: string) => {
    setPanelFaces((faces) => {
      if (!(name in faces)) return faces
      const { [name]: _gone, ...rest } = faces
      return rest
    })
    setPanelFailed((names) => (names.includes(name) ? names : [...names, name]))
  }, [])
  // A colleague's own face, while the provider keeps it going.
  const colleagueFace = (name: string) => (avatar && !panelFailed.includes(name) ? avatar.panel[name] : undefined)
  // On camera but not connected yet: joining, unless no face is coming at all.
  const colleagueJoining = (name: string) =>
    PANEL.some((m) => m.name === name && m.onCamera) &&
    !panelFailed.includes(name) &&
    !avatarUnavailable &&
    (!avatar || name in avatar.panel)
  const videoUpload = useVideoUploads((s) => (sessionId ? s.bySession[sessionId] : undefined))

  // Camera video for the feedback player: one clip per interview, from when the camera is on
  // during the conversation until it is turned off, the interview ends or the candidate leaves.
  const joined = live.state.phase === 'live' || live.state.phase === 'reconnecting'
  const recordedSessionRef = useRef<string | null>(null)
  const liveMediaMs = live.mediaMs
  useEffect(() => {
    const track = camera?.getVideoTracks()[0]
    if (!sessionId || !joined || !track || recordedSessionRef.current === sessionId) return
    if (!cameraRecordingSupported()) return
    let recorder: CameraRecorder
    try {
      recorder = new CameraRecorder(track, liveMediaMs())
    } catch {
      return
    }
    recordedSessionRef.current = sessionId
    const id = sessionId
    return () => {
      void recorder.stop().then((recording) => {
        if (recording) void uploadSessionVideo(id, recording)
      })
    }
  }, [camera, joined, sessionId, liveMediaMs])

  // Eye contact, smiling and head movement, measured on the device while the camera is on.
  // Frames never leave the device; only per-second numbers are saved for feedback.
  const trackedSessionRef = useRef<string | null>(null)
  const trackerRef = useRef(tracker)
  trackerRef.current = tracker
  // How the candidate sits in the frame, checked live so they can fix it while it still counts.
  const [framing, setFraming] = useState<Framing | null>(null)
  useEffect(() => {
    if (!sessionId || !joined || !camera || trackedSessionRef.current === sessionId) return
    trackedSessionRef.current = sessionId
    const id = sessionId
    const options = trackerRef.current
    const faces = new FaceTracker(camera, liveMediaMs, {
      setting: options?.setting,
      fullBody: options?.fullBody,
      // Read through the ref: who is speaking changes all interview long.
      speakerSeat: options?.speakerSeat && (() => trackerRef.current?.speakerSeat?.() ?? null),
    })
    void faces.start()
    const check = window.setInterval(() => setFraming(faces.framing()), 1000)
    return () => {
      window.clearInterval(check)
      setFraming(null)
      const seconds = faces.stop()
      if (seconds.length >= 20) void saveFaceMetrics(id, seconds).catch(() => {})
    }
  }, [camera, joined, sessionId, liveMediaMs])

  return {
    live,
    liveActive,
    /** A framing problem to tell the candidate about while the camera is on, or null. */
    framing: camera ? framing : null,
    avatar,
    avatarFailed,
    avatarUnavailable,
    faceSettled,
    /** The interview may go ahead: its face has joined, failed, or was never asked for. */
    ready: faceSettled,
    /** The lead's face is streaming on screen (and speaking for the interviewer). */
    leadFaceLive: Boolean(faceOnScreen) && !avatarFailed,
    setFaceOnScreen,
    onAvatarFailed,
    onFaceEnded,
    panelFaces,
    colleagueLive,
    colleagueFailed,
    colleagueFace,
    colleagueJoining,
    videoUpload,
  }
}

export type InterviewRoom = ReturnType<typeof useInterviewRoom>
