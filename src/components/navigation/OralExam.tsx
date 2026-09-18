import { useEffect, useMemo, useRef, useState } from 'react'
import { examinerFor } from '@/data/examiners'
import { ROOM_PHOTO, type Orientation } from '@/data/inPersonMedia'
import type { SessionSetup } from '@/data/practice'
import { useCamera } from '@/lib/useCamera'
import { cn } from '@/lib/utils'
import { Board } from '@/modules/exam/live/Board'
import { retryExamSession } from '@/modules/exam/api'
import { useInterviewRoom } from '@/modules/interview/live/useInterviewRoom'
import { ApiError } from '@/platform/api/client'
import { useAppStore } from '@/state/useAppStore'
import { Button } from '../ui/Button'
import { IconVideo, IconVideoOff } from '../ui/Icon'
import { LeaveArrow, LiveOverlay, SceneCaption } from './LivePanels'

/**
 * The oral exam itself, in the room the exam is actually held in.
 *
 * When the professor asks the questions, that is a desk with two chairs: their
 * face fills the screen and there is nothing else on it — no timer, no meters, no
 * captions to read instead of thinking. When the exam is worked at a board, the
 * screen is split: the professor on one side, the board the student writes on
 * (and the examiner reads as they write) on the other.
 *
 * The camera is only ever on if the student asked for feedback on how they come
 * across; it can be turned off here at any time.
 */

function useOrientation(): Orientation {
  const read = (): Orientation => (window.innerHeight > window.innerWidth ? 'portrait' : 'landscape')
  const [orientation, setOrientation] = useState<Orientation>(read)
  useEffect(() => {
    const on = () => setOrientation(read())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return orientation
}

/** The oral exam on screen now, if any. */
export function examHere(state: {
  view: string
  session: SessionSetup | null
  selectedId: string | null
}): { session: SessionSetup; sessionId: string } | null {
  const { view, session, selectedId } = state
  if (view !== 'exam' || !session || session.locationId !== selectedId) return null
  const sessionId = session.exam?.sessionId
  return sessionId ? { session, sessionId } : null
}

export function OralExam() {
  const view = useAppStore((s) => s.view)
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  const here = examHere({ view, session, selectedId })
  if (!here) return null
  // A new attempt is a new session: the whole room is rebuilt rather than reused.
  return <ExamRoom key={here.sessionId} {...here} />
}

export function ExamRoom({ session, sessionId }: { session: SessionSetup; sessionId: string }) {
  const leave = useAppStore((s) => s.leaveDrill)
  const setSession = useAppStore((s) => s.setSession)
  const openFeedback = useAppStore((s) => s.openFeedback)
  const setSceneCovered = useAppStore((s) => s.setSceneCovered)
  const orientation = useOrientation()
  const exam = session.exam!
  const board = exam.style === 'board_work'
  const examiner = examinerFor(exam.style)
  const roomPhoto = ROOM_PHOTO.one[orientation]

  const [cameraOn, setCameraOn] = useState(Boolean(exam.camera))
  const [started, setStarted] = useState(false)
  const camera = useCamera(started && cameraOn)
  // Eye contact in the room means looking at the examiner, not into a lens.
  const tracker = useMemo(() => ({ setting: 'screen' as const }), [])
  const room = useInterviewRoom({ sessionId, camera: camera.stream, tracker })
  const { live, liveActive } = room
  const { phase } = live.state

  useEffect(() => {
    if (phase !== 'idle' && phase !== 'starting') setStarted(true)
  }, [phase])
  // A blocked or missing camera switches the offer back off rather than nagging.
  useEffect(() => {
    if (camera.error) setCameraOn(false)
  }, [camera.error])
  // The room photo covers the screen: no need to draw the 3D city under it.
  useEffect(() => {
    setSceneCovered(true)
    return () => setSceneCovered(false)
  }, [setSceneCovered])

  const name = examiner.name
  // The examiner has no face: the room photo carries the scene and the voice does the rest.
  const faceless = live.state.interviewerSpeaking

  const professor = (
    <div className="relative size-full overflow-hidden bg-[#0b0d12]">
      <img src={roomPhoto} alt="" className="absolute inset-0 size-full object-cover" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8">
        <div className="text-[12.5px] font-semibold text-chalk">{name}</div>
        <div className="text-[11px] text-mist">{exam.subject || 'Oral exam'}</div>
      </div>
    </div>
  )

  return (
    <div className="absolute inset-0 z-[45] bg-black" role="region" aria-label="Oral exam">
      {board ? (
        <div className={cn('absolute inset-0 flex gap-2 p-2', orientation === 'portrait' ? 'flex-col' : 'flex-row')}>
          <div
            className={cn(
              'relative min-h-0 overflow-hidden rounded-2xl',
              orientation === 'portrait' ? 'h-[42%]' : 'w-[42%]',
            )}
          >
            {professor}
          </div>
          <Board live={live} className="min-h-0 flex-1" />
        </div>
      ) : (
        <div className="absolute inset-0">{professor}</div>
      )}

      {faceless && <SceneCaption>{`${name.split(' ').slice(-1)[0]} is speaking`}</SceneCaption>}

      <LeaveArrow onLeave={liveActive ? live.end : leave} confirm={liveActive} what="the exam" />

      {/* Turning the camera off mid-exam is one tap, and it is the only control while it runs. */}
      {(cameraOn || liveActive) && (
        <button
          type="button"
          aria-pressed={cameraOn}
          aria-label={cameraOn ? 'Turn the camera off' : 'Turn the camera on'}
          onClick={() => setCameraOn((on) => !on)}
          className="absolute right-4 top-[calc(env(safe-area-inset-top,0px)+0.9rem)] z-20 grid size-10 place-items-center rounded-full border border-white/15 bg-black/35 text-chalk backdrop-blur-sm transition-colors hover:bg-black/55"
        >
          {cameraOn ? <IconVideo width={17} height={17} /> : <IconVideoOff width={17} height={17} />}
        </button>
      )}

      {cameraOn && camera.stream && <SelfView stream={camera.stream} />}

      {/* Sitting down: the one way in, with the camera choice still open. */}
      {(phase === 'idle' || phase === 'starting') && (
        <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] z-10 flex flex-col items-center gap-2 px-4">
          {camera.error && <p className="text-[11.5px] text-[#fca5a5]">{camera.error}</p>}
          <Button
            variant="primary"
            className="h-10 px-6"
            disabled={phase === 'starting'}
            onClick={() => void live.start()}
          >
            {phase === 'starting' ? 'One moment…' : `Begin with ${name.split(' ').slice(-1)[0]}`}
          </Button>
          <p className="max-w-sm text-center text-[11px] leading-relaxed text-mist">
            {board
              ? 'Work each problem on the board and say what you are doing; your examiner reads it as you write.'
              : 'Answer out loud. Take a moment to think — silence is normal in an exam.'}
          </p>
        </div>
      )}

      <LiveOverlay
        live={live}
        session={session}
        kind="exam"
        videoUpload={room.videoUpload}
        onLeave={leave}
        onFeedback={() => openFeedback(sessionId)}
        intro={false}
        nextSteps={
          <ExamNextSteps
            session={session}
            sessionId={sessionId}
            onFeedback={() => openFeedback(sessionId)}
            onLeave={leave}
            onAgain={setSession}
          />
        }
      />
    </div>
  )
}

/** The student's own camera, small and out of the way, mirrored like a selfie view. */
function SelfView({ stream }: { stream: MediaStream }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const element = video.current
    if (!element) return
    element.srcObject = stream
    element.play().catch(() => {})
  }, [stream])
  return (
    <div className="absolute bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] right-4 z-10 h-24 w-[4.5rem] overflow-hidden rounded-xl bg-black ring-1 ring-white/15 sm:h-28 sm:w-20">
      <video ref={video} autoPlay muted playsInline className="size-full -scale-x-100 object-cover" />
    </div>
  )
}

/** After the exam: sit it again with new questions, read the feedback, or leave. */
function ExamNextSteps({
  session,
  sessionId,
  onFeedback,
  onLeave,
  onAgain,
}: {
  session: SessionSetup
  sessionId: string
  onFeedback: () => void
  onLeave: () => void
  onAgain: (session: SessionSetup) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const again = async () => {
    setPending(true)
    setError(null)
    try {
      const created = await retryExamSession(sessionId)
      onAgain({ ...session, exam: { ...session.exam!, sessionId: created.id, style: created.examStyle } })
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "You've reached a practice limit for now. Try again later."
          : 'Could not start another exam. Try again in a moment.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Button variant="primary" className="mt-4 w-full" disabled={pending} onClick={() => void again()}>
        {pending ? 'Preparing…' : 'Sit this exam again'}
      </Button>
      <p className="mt-1.5 text-[10.5px] text-faint">
        New questions on the same material, aimed at whatever went weakest this time.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="ghost" disabled={pending} onClick={onFeedback}>
          View feedback
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onLeave}>
          Back to the city
        </Button>
      </div>
      {error && (
        <p className="mt-2 text-[12px] text-[#fca5a5]" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
