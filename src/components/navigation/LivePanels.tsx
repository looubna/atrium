import { type ReactNode, useEffect, useState } from 'react'
import type { SessionSetup } from '@/data/practice'
import { cn } from '@/lib/utils'
import type { BlueprintRound } from '@/modules/interview/api'
import { nextRound, roundMinutes, startRound } from '@/modules/interview/journey/rounds'
import type { LiveFailure, LiveInterviewControls } from '@/modules/interview/live/useLiveInterview'
import type { VideoUpload } from '@/modules/interview/live/videoUploads'
import { ApiError } from '@/platform/api/client'
import { useAppStore } from '@/state/useAppStore'
import { Button } from '../ui/Button'
import { IconArrowLeft, IconMic } from '../ui/Icon'

/** Leaving mid-session asks once; the question goes away on its own. */
const CONFIRM_LEAVE_MS = 4000

/** The parts of a live session shared by the video call, the meeting room and the exam room. */

/** Which kind of live session a screen is running: it only changes the words. */
export type LiveKind = 'interview' | 'exam' | 'debate'

const FAILURE_TEXT: Record<LiveKind, Record<LiveFailure, string>> = {
  interview: {
    mic_denied: 'Microphone access is blocked. Allow it in Settings to talk with your interviewer.',
    unsupported: "This device can't run a live interview. Update your browser or iOS and try again.",
    forbidden: 'Accept recording and AI processing in your account before starting a live interview.',
    email_unverified: 'Your email address is not verified yet. Open the link we sent you, then start the interview again.',
    origin_blocked: 'This address is not allowed to open a live session. Open the app from an allowed address (ALLOWED_ORIGINS on the API).',
    not_found: 'This interview session no longer exists. Set it up again from the Company panel.',
    conflict: 'Another live interview is open, or this one has already finished.',
    quota: "You've used this month's live interview minutes.",
    unavailable: 'The interviewer is unavailable right now. Try again in a moment.',
  },
  debate: {
    mic_denied: 'Microphone access is blocked. Allow it in Settings to argue out loud.',
    unsupported: "This device can't run a live debate. Update your browser or iOS and try again.",
    forbidden: 'Accept recording and AI processing in your account before starting a debate.',
    email_unverified: 'Your email address is not verified yet. Open the link we sent you, then start the debate again.',
    origin_blocked: 'This address is not allowed to open a live session. Open the app from an allowed address (ALLOWED_ORIGINS on the API).',
    not_found: 'This debate no longer exists. Set it up again from the University panel.',
    conflict: 'Another live session is open, or this debate has already finished.',
    quota: "You've used this month's live minutes.",
    unavailable: 'Your opponent is unavailable right now. Try again in a moment.',
  },
  exam: {
    mic_denied: 'Microphone access is blocked. Allow it in Settings to answer your examiner.',
    unsupported: "This device can't run a live exam. Update your browser or iOS and try again.",
    forbidden: 'Accept recording and AI processing in your account before starting a live exam.',
    email_unverified: 'Your email address is not verified yet. Open the link we sent you, then start the exam again.',
    origin_blocked: 'This address is not allowed to open a live session. Open the app from an allowed address (ALLOWED_ORIGINS on the API).',
    not_found: 'This exam no longer exists. Set it up again from the University panel.',
    conflict: 'Another live session is open, or this exam has already finished.',
    quota: "You've used this month's live minutes.",
    unavailable: 'Your examiner is unavailable right now. Try again in a moment.',
  },
}

/** Before joining, after a failure, and once the interview is over. */
export function LiveOverlay({
  live,
  session,
  videoUpload,
  onLeave,
  onFeedback,
  intro = true,
  kind = 'interview',
  nextSteps,
}: {
  live: LiveInterviewControls
  session: SessionSetup | null
  videoUpload?: VideoUpload
  onLeave: () => void
  onFeedback: () => void
  /** Show the "ready to join" card; off where the screen has its own way in (checking in at reception). */
  intro?: boolean
  kind?: LiveKind
  /** What to offer once it is over, when this screen has its own answer (an exam, for instance). */
  nextSteps?: ReactNode
}) {
  const { state } = live
  const card = (children: ReactNode) => (
    <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 p-4 backdrop-blur-[2px]">
      <div className="glass anim-rise w-full max-w-sm rounded-2xl p-5">{children}</div>
    </div>
  )

  if (state.phase === 'idle' || state.phase === 'starting') {
    if (!intro) return null
    return card(
      <>
        <div className="eyebrow">Live interview</div>
        <h2 className="mt-1 text-[16px] font-semibold text-chalk">Your interviewer is ready</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-mist">
          Answer out loud, ask for clarification, take a moment to think. The conversation (and your camera, if
          it's on) is recorded so your feedback can point to exact moments.
        </p>
        <div role="radiogroup" aria-label="Audio output" className="mt-4 grid grid-cols-2 gap-1.5">
          {[
            { id: false, label: 'Speaker' },
            { id: true, label: 'Headphones' },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={state.headphones === option.id}
              onClick={() => live.setHeadphones(option.id)}
              className={cn(
                'h-9 rounded-xl border text-[12.5px] font-medium transition-all duration-200',
                state.headphones === option.id
                  ? 'border-jade-400/40 bg-jade-500/15 text-jade-400'
                  : 'border-white/8 bg-white/4 text-mist hover:bg-white/8 hover:text-chalk',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10.5px] text-faint">
          {state.headphones
            ? 'You can talk over the interviewer at any time.'
            : 'Your mic pauses while the interviewer speaks; tap Interrupt to cut in.'}
        </p>
        <Button variant="primary" className="mt-4 w-full" disabled={state.phase === 'starting'} onClick={() => void live.start()}>
          <IconMic width={15} height={15} />
          {state.phase === 'starting' ? 'Opening microphone…' : 'Join interview'}
        </Button>
      </>,
    )
  }

  if (state.phase === 'failed') {
    return card(
      <>
        <h2 className="text-[15px] font-semibold text-chalk">
          {kind === 'exam'
            ? "The exam couldn't continue"
            : kind === 'debate'
              ? "The debate couldn't continue"
              : "The interview couldn't continue"}
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-mist">
          {FAILURE_TEXT[kind][state.failure ?? 'unavailable']}
        </p>
        <Button variant="ghost" className="mt-4 w-full" onClick={onLeave}>
          Back
        </Button>
      </>,
    )
  }

  if (state.phase === 'ended') {
    return card(
      <>
        <div className="eyebrow">
          {kind === 'exam' ? 'Exam complete' : kind === 'debate' ? 'Debate over' : 'Interview complete'}
        </div>
        <h2 className="mt-1 text-[16px] font-semibold text-chalk">
          {kind === 'exam'
            ? "That's the end of your exam"
            : kind === 'debate'
              ? "That's the debate"
              : "Thanks — that's a wrap"}
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-mist">
          {state.endReason === 'time_limit'
            ? `You reached the time limit for this ${
                kind === 'exam' ? 'exam' : kind === 'debate' ? 'debate' : 'round'
              }. `
            : state.endReason === 'quota_exhausted'
              ? "You've reached this month's live minutes. "
              : ''}
          Your recording is being analysed. Feedback with timestamped moments will be ready shortly.
        </p>
        {videoUpload && (
          <p className="mt-2 text-[11.5px] text-faint" role="status">
            {videoUpload.status === 'uploading'
              ? `Uploading your video… ${Math.round(videoUpload.progress * 100)}%`
              : videoUpload.status === 'done'
                ? 'Your video is uploaded.'
                : "Your video couldn't be uploaded. Feedback still uses the audio recording."}
          </p>
        )}
        {nextSteps ?? (session?.interview ? (
          <NextSteps session={session} onFeedback={onFeedback} onLeave={onLeave} />
        ) : (
          <>
            <Button variant="primary" className="mt-4 w-full" onClick={onFeedback}>
              View feedback
            </Button>
            <Button variant="ghost" className="mt-2 w-full" onClick={onLeave}>
              Back to the city
            </Button>
          </>
        ))}
      </>,
    )
  }
  return null
}

/** The one control on screen in a room you are sitting in: the way out, asking first mid-session. */
export function LeaveArrow({
  onLeave,
  confirm,
  what,
}: {
  onLeave: () => void
  /** Mid-session, leaving asks first; `what` names what would be left ("the exam"). */
  confirm: boolean
  what: string
}) {
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    if (!asking) return
    const timer = window.setTimeout(() => setAsking(false), CONFIRM_LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [asking])
  return (
    <div className="absolute left-4 top-[calc(env(safe-area-inset-top,0px)+0.9rem)] z-20 flex items-center gap-2">
      <button
        type="button"
        aria-label={confirm ? `Leave ${what}` : 'Leave'}
        onClick={() => (confirm && !asking ? setAsking(true) : onLeave())}
        className="grid size-10 place-items-center rounded-full border border-white/15 bg-black/35 text-chalk backdrop-blur-sm transition-colors hover:bg-black/55"
      >
        <IconArrowLeft width={18} height={18} />
      </button>
      {asking && (
        <button
          type="button"
          onClick={onLeave}
          className="anim-fade rounded-full border border-white/15 bg-black/55 px-3 py-2 text-[12px] font-medium text-chalk backdrop-blur-sm hover:bg-black/70"
        >
          {`Leave ${what}?`}
        </button>
      )}
    </div>
  )
}

/** A quiet line of text over the scene, like a caption in a film. */
export function SceneCaption({ children }: { children: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] z-10 flex justify-center px-4">
      <div key={children} className="anim-fade rounded-full bg-black/45 px-4 py-2 text-center text-[13px] text-chalk backdrop-blur-sm">
        {children}
      </div>
    </div>
  )
}

/**
 * What to do after a round: the next round of the journey, the same round again,
 * the journey's rounds, or the feedback — feedback is never in the way.
 */
export function NextSteps({
  session,
  onFeedback,
  onLeave,
}: {
  session: SessionSetup
  onFeedback: () => void
  onLeave: () => void
}) {
  const setSession = useAppStore((s) => s.setSession)
  const openJourney = useAppStore((s) => s.openJourney)
  const interview = session.interview!
  const { applicationId, blueprintId, roundId } = interview
  const inJourney = Boolean(applicationId && blueprintId && roundId)
  // undefined while looking it up; null when this was the last round.
  const [next, setNext] = useState<BlueprintRound | null | undefined>(inJourney ? undefined : null)
  const [pending, setPending] = useState<'next' | 'again' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!applicationId || !blueprintId || !roundId) return
    let live = true
    nextRound(applicationId, blueprintId, roundId)
      .then((round) => live && setNext(round))
      .catch(() => live && setNext(null))
    return () => {
      live = false
    }
  }, [applicationId, blueprintId, roundId])

  const go = async (kind: 'next' | 'again') => {
    setPending(kind)
    setError(null)
    try {
      const round =
        kind === 'next' && next
          ? next
          : roundId
            ? { id: roundId, title: interview.roundTitle ?? '', type: interview.roundType ?? '' }
            : null
      const minutes = kind === 'next' && next ? roundMinutes(next) : session.minutes
      setSession(await startRound(session, round, minutes))
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "You've reached a practice limit for now. Try again later."
          : 'Could not start the round. Try again in a moment.',
      )
    } finally {
      setPending(null)
    }
  }

  const toJourney = () =>
    openJourney({
      locationId: session.locationId,
      area: session.area,
      format: session.format,
      applicationId: applicationId!,
      blueprintId: blueprintId!,
      company: interview.company ?? '',
      roleTitle: interview.roleTitle ?? '',
    })

  return (
    <>
      {next && (
        <Button variant="primary" className="mt-4 w-full" disabled={pending !== null} onClick={() => void go('next')}>
          <span className="truncate">{pending === 'next' ? 'Preparing the next round…' : `Next round: ${next.title}`}</span>
        </Button>
      )}
      <Button
        variant={next ? 'ghost' : 'primary'}
        className={cn('w-full', next ? 'mt-2' : 'mt-4')}
        disabled={pending !== null || next === undefined}
        onClick={() => void go('again')}
      >
        {pending === 'again' ? 'Preparing…' : 'Practise this round again'}
      </Button>
      {inJourney && (
        <Button variant="ghost" className="mt-2 w-full" disabled={pending !== null} onClick={toJourney}>
          All rounds
        </Button>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="ghost" disabled={pending !== null} onClick={onFeedback}>
          View feedback
        </Button>
        <Button variant="ghost" disabled={pending !== null} onClick={onLeave}>
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

/** Connection state, mic level and the interrupt control while the interview is running. */
export function LiveStrip({ live, className }: { live: LiveInterviewControls; className?: string }) {
  const { state } = live
  if (state.phase !== 'live' && state.phase !== 'reconnecting' && state.phase !== 'connecting') return null
  return (
    <div className={cn('mt-2 flex items-end gap-2', className)}>
      {/* No live captions: like a real call, the candidate listens rather than reads. */}
      <div className="min-w-0 flex-1" aria-live="polite">
        {state.phase !== 'live' && (
          <div className="text-[12px] text-mist">{state.phase === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div className="h-full rounded-full bg-jade-400 transition-[width] duration-100" style={{ width: `${Math.round(state.micLevel * 100)}%` }} />
        </div>
        {state.interviewerSpeaking && !state.headphones && (
          <button
            type="button"
            onClick={live.interrupt}
            className="h-8 rounded-lg border border-white/10 bg-white/6 px-3 text-[12px] font-medium text-chalk transition-colors hover:bg-white/12"
          >
            Interrupt
          </button>
        )}
      </div>
    </div>
  )
}
