import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionSetup } from '@/data/practice'
import { useCamera } from '@/lib/useCamera'
import { cn } from '@/lib/utils'
import { PROFESSOR } from '@/modules/admission/professor'
import { formatClock } from '@/modules/interview/api'
import { useInterviewRoom } from '@/modules/interview/live/useInterviewRoom'
import { useAppStore } from '@/state/useAppStore'
import { Button } from '../ui/Button'
import { IconMic, IconMicOff, IconPhoneOff, IconVideo, IconVideoOff } from '../ui/Icon'
import { AvatarTile } from './AvatarTile'
import { FramingHint } from './FramingHint'
import { LiveOverlay } from './LivePanels'

/**
 * The scholarship or admission interview: a video call with a professor from the committee.
 *
 * He has read the candidate's application — the backend hands him the researched opportunity,
 * the candidate's own claims in their own words, and the questions the preparation predicted —
 * so what he asks is about this person, not a template. The screen is a call and nothing more:
 * his face, the candidate's own camera, and the three controls a call has.
 */

/** The scholarship call on screen now, if any. */
export function admissionHere(state: {
  view: string
  session: SessionSetup | null
  selectedId: string | null
}): { session: SessionSetup; sessionId: string } | null {
  const { view, session, selectedId } = state
  if (view !== 'admission' || !session || session.locationId !== selectedId) return null
  const sessionId = session.admission?.sessionId
  return sessionId ? { session, sessionId } : null
}

/**
 * Sessions this page has already joined. The candidate tapped "Start the interview" to get here,
 * so the call joins by itself — once: coming back to a finished call must not dial it again.
 */
const joined = new Set<string>()

export function AdmissionCall() {
  const view = useAppStore((s) => s.view)
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  const here = admissionHere({ view, session, selectedId })
  if (!here) return null
  // A new attempt is a new session: the whole call is rebuilt rather than reused.
  return <Call key={here.sessionId} {...here} />
}

function Call({ session, sessionId }: { session: SessionSetup; sessionId: string }) {
  const leave = useAppStore((s) => s.leaveDrill)
  const openFeedback = useAppStore((s) => s.openFeedback)
  const setSceneCovered = useAppStore((s) => s.setSceneCovered)
  const admission = session.admission!

  const [cameraOn, setCameraOn] = useState(Boolean(admission.camera))
  const [started, setStarted] = useState(false)
  const camera = useCamera(started && cameraOn)
  // A video call: eye contact is looking into the lens, as the professor sees it. (Looking
  // anywhere on the screen counted before, which scored someone looking away at 99%.)
  const tracker = useMemo(() => ({ setting: 'camera' as const }), [])
  // If the lip-sync server is down, he still talks and moves from his own footage.
  const filmed = useMemo(() => ({ avatarId: PROFESSOR.avatarId, name: PROFESSOR.name, role: PROFESSOR.role }), [])
  const room = useInterviewRoom({ sessionId, camera: camera.stream, tracker, module: 'admission', filmed })
  const { live, liveActive, avatar, avatarFailed } = room
  const { phase, timeLeftMs, muted } = live.state
  const speaking = live.state.interviewerSpeaking

  useEffect(() => {
    if (phase !== 'idle' && phase !== 'starting') setStarted(true)
  }, [phase])
  useEffect(() => {
    if (camera.error) setCameraOn(false)
  }, [camera.error])
  useEffect(() => {
    setSceneCovered(true)
    return () => setSceneCovered(false)
  }, [setSceneCovered])

  // Join as the call opens. From a timer the cleanup cancels, so a mount that is torn down at
  // once (StrictMode, in development) cannot start a session and strand the real one.
  useEffect(() => {
    if (phase !== 'idle' || joined.has(sessionId)) return
    const timer = window.setTimeout(() => {
      joined.add(sessionId)
      void live.start()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [phase, sessionId, live])

  // Hanging up goes straight on to the feedback once the session has closed.
  const [feedbackOnEnd, setFeedbackOnEnd] = useState(false)
  const hangUp = useCallback(() => {
    setFeedbackOnEnd(true)
    live.end()
  }, [live])
  useEffect(() => {
    if (feedbackOnEnd && phase === 'ended') openFeedback(sessionId)
  }, [feedbackOnEnd, phase, sessionId, openFeedback])

  const [still, setStill] = useState(`/faces/${PROFESSOR.avatarId}.jpg`)
  const name = avatar?.name ?? PROFESSOR.name

  return (
    <div className="absolute inset-0 z-[45] flex flex-col bg-[#0b0d12]" role="region" aria-label="Interview call">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.8rem)]">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-chalk">{admission.opportunity}</div>
          <div className="text-[11px] text-mist">Interview with the selection committee</div>
        </div>
        {timeLeftMs !== null && liveActive && (
          <div className="shrink-0 rounded-md bg-white/8 px-2 py-1 font-mono text-[11.5px] text-chalk">
            {formatClock(timeLeftMs)}
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1 px-3 pb-3">
        {/* The professor: his face once it streams, his photograph until then. */}
        <div
          className={cn(
            'relative size-full overflow-hidden rounded-2xl bg-black ring-1 transition-shadow',
            speaking ? 'ring-2 ring-jade-400/80' : 'ring-white/10',
          )}
        >
          <img src={still} alt="" onError={() => setStill('')} className="absolute inset-0 size-full object-cover" />
          {avatar && !avatarFailed && (
            <AvatarTile
              variant="closeup"
              renderer={avatar.renderer}
              name={avatar.name}
              role={avatar.role}
              speaking={speaking}
              shown
              onLive={room.setFaceOnScreen}
              onFailed={room.onAvatarFailed}
              onEnded={room.onFaceEnded}
            />
          )}
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-[12px] font-medium text-white">
            {speaking && <span className="size-1.5 animate-pulse rounded-full bg-jade-400" aria-hidden />}
            <span>{name}</span>
            <span className="text-mist">· {PROFESSOR.role}</span>
          </div>
        </div>

        {/* The candidate's own camera, like any call. */}
        <SelfTile stream={camera.stream} cameraOn={cameraOn && Boolean(camera.stream)} muted={muted} />
      </div>

      {/* The call's controls. */}
      <div className="flex items-center justify-center gap-3 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-1">
        <Control
          label={muted ? 'Unmute' : 'Mute'}
          off={muted}
          disabled={!liveActive}
          onClick={() => live.setMuted(!muted)}
        >
          {muted ? <IconMicOff width={18} height={18} /> : <IconMic width={18} height={18} />}
        </Control>
        <Control label={cameraOn ? 'Turn camera off' : 'Turn camera on'} off={!cameraOn} onClick={() => setCameraOn((on) => !on)}>
          {cameraOn ? <IconVideo width={18} height={18} /> : <IconVideoOff width={18} height={18} />}
        </Control>
        {liveActive ? (
          <button
            type="button"
            onClick={hangUp}
            className="flex h-11 items-center gap-2 rounded-full bg-[#e5484d] px-5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#d13d42]"
          >
            <IconPhoneOff width={18} height={18} />
            End &amp; see feedback
          </button>
        ) : (
          (phase === 'idle' || phase === 'starting') && (
            <Button variant="primary" className="h-11 px-5" disabled={phase === 'starting'} onClick={() => void live.start()}>
              {phase === 'starting' ? 'Joining…' : 'Join the call'}
            </Button>
          )
        )}
      </div>

      <FramingHint framing={room.framing} />

      <LiveOverlay
        live={live}
        session={session}
        kind="interview"
        videoUpload={room.videoUpload}
        onLeave={leave}
        onFeedback={() => openFeedback(sessionId)}
        intro={false}
        nextSteps={
          <>
            <Button variant="primary" className="mt-4 w-full" onClick={() => openFeedback(sessionId)}>
              View feedback
            </Button>
            <Button variant="ghost" className="mt-2 w-full" onClick={leave}>
              Back to the city
            </Button>
          </>
        }
      />
    </div>
  )
}

function Control({
  label,
  off,
  disabled,
  onClick,
  children,
}: {
  label: string
  off?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={!off}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-11 place-items-center rounded-full border transition-colors disabled:opacity-40',
        off ? 'border-[#e5484d]/50 bg-[#e5484d]/20 text-[#fca5a5]' : 'border-white/15 bg-white/8 text-chalk hover:bg-white/14',
      )}
    >
      {children}
    </button>
  )
}

/** The candidate's own camera, mirrored like a selfie view; their initial when it is off. */
function SelfTile({ stream, cameraOn, muted }: { stream: MediaStream | null; cameraOn: boolean; muted: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const element = video.current
    if (!element || !stream) return
    element.srcObject = stream
    element.play().catch(() => {})
  }, [stream])
  return (
    <div className="absolute bottom-6 right-6 h-28 w-40 overflow-hidden rounded-xl bg-[#1a2033] ring-1 ring-white/15 sm:h-32 sm:w-48">
      {cameraOn ? (
        <video ref={video} autoPlay muted playsInline className="size-full -scale-x-100 object-cover" />
      ) : (
        <div className="grid size-full place-items-center text-[13px] font-medium text-mist">You</div>
      )}
      <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10.5px] text-white">
        {muted && <IconMicOff width={11} height={11} className="text-[#fca5a5]" />}
        You
      </div>
    </div>
  )
}
