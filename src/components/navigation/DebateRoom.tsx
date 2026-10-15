import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEBATE_HALL, DEBATE_TAKES } from '@/data/debateMedia'
import type { Orientation } from '@/data/inPersonMedia'
import type { SessionSetup } from '@/data/practice'
import { DEBATE_DIFFICULTY_LABEL, DEBATE_FORMAT_LABEL } from '@/data/practice'
import { useCamera } from '@/lib/useCamera'
import { cn } from '@/lib/utils'
import {
  createDebateSession,
  debateAgain,
  FOCUS_LABELS,
  getPreparation,
  type AgainMode,
  type DebateFocus,
  type DebatePosition,
  type Preparation,
} from '@/modules/debate/api'
import { DebatePrep, Preparing } from '@/modules/debate/prep/DebatePrep'
import { preparationFailure } from '@/modules/debate/setup/DebateSetup'
import { CUT_BACK_MS } from '@/modules/interview/live/shots'
import { useInterviewRoom } from '@/modules/interview/live/useInterviewRoom'
import { ApiError } from '@/platform/api/client'
import { firebase, firebaseConfigured } from '@/platform/firebase'
import { useLiveDocument } from '@/platform/firestore/live'
import { useAppStore } from '@/state/useAppStore'
import { AvatarTile } from './AvatarTile'
import { LecternLaptop } from './LecternLaptop'
import { RoomTake } from './RoomTake'
import { Button } from '../ui/Button'
import { IconVideo, IconVideoOff } from '../ui/Icon'
import { LeaveArrow, LiveOverlay, SceneCaption } from './LivePanels'
import { CameraCheck } from './CameraCheck'

/**
 * The debate itself: the two of you across a table.
 *
 * Before it starts, this screen is the preparation view — the motion, your side, what you
 * should be ready to defend and where you will be pressed. Once it starts there is almost
 * nothing on screen: the motion and which side you are on, because forgetting that mid-
 * argument is the one thing that would ruin the exercise, and nothing else to read instead
 * of thinking.
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

const SIDE_LABEL: Record<DebatePosition, string> = { for: 'FOR', against: 'AGAINST' }

/** The debate on screen now, if any. */
export function debateHere(state: {
  view: string
  session: SessionSetup | null
  selectedId: string | null
}): { session: SessionSetup } | null {
  const { view, session, selectedId } = state
  if (view !== 'debate' || !session?.debate || session.locationId !== selectedId) return null
  return { session }
}

/**
 * Whether the opponent has the floor, held briefly after their voice stops.
 *
 * On the voice actually playing rather than a turn queued: the hall is filmed once per state, so
 * changing a beat early moves the wrong person's mouth.
 */
function useArguing(speaking: boolean): boolean {
  const [held, setHeld] = useState(speaking)
  useEffect(() => {
    if (speaking) {
      setHeld(true)
      return
    }
    const timer = window.setTimeout(() => setHeld(false), CUT_BACK_MS)
    return () => window.clearTimeout(timer)
  }, [speaking])
  return held
}

/**
 * The session a tap on "Begin" just created, whose microphone should open without a second tap.
 * Outside the component because creating the session re-keys the room (see `DebateRoom`).
 */
let startOnArrival: string | null = null

export function DebateRoom() {
  const view = useAppStore((s) => s.view)
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  const here = debateHere({ view, session, selectedId })
  if (!here) return null
  // A new attempt is a new session: the whole room is rebuilt rather than reused.
  const key = here.session.debate!.sessionId ?? here.session.debate!.prepId ?? 'new'
  return <Room key={key} session={here.session} />
}

function Room({ session }: { session: SessionSetup }) {
  const leave = useAppStore((s) => s.leaveDrill)
  const setSession = useAppStore((s) => s.setSession)
  const openFeedback = useAppStore((s) => s.openFeedback)
  const setSceneCovered = useAppStore((s) => s.setSceneCovered)
  const orientation = useOrientation()
  const debate = session.debate!

  const [sessionId, setSessionId] = useState(debate.sessionId ?? null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cameraOn, setCameraOn] = useState(Boolean(debate.camera))
  const [joined, setJoined] = useState(false)

  const camera = useCamera(joined && cameraOn)
  // Eye contact in the room means looking at your opponent, not into a lens.
  const tracker = useMemo(() => ({ setting: 'screen' as const }), [])
  const room = useInterviewRoom({ sessionId, camera: camera.stream, tracker, module: 'debate' })
  const { live, liveActive, avatar, avatarFailed, leadFaceLive } = room
  const { phase } = live.state

  // The prepared brief, watched live while the worker writes it.
  const uid = firebaseConfigured() ? firebase().auth.currentUser?.uid : undefined
  const prepPath =
    uid && debate.debateId && debate.prepId
      ? `users/${uid}/debates/${debate.debateId}/preparations/${debate.prepId}`
      : null
  const prep = useLiveDocument<Preparation & { id: string }>(prepPath, () =>
    getPreparation(debate.debateId!, debate.prepId!),
  )

  useEffect(() => {
    if (phase !== 'idle' && phase !== 'starting') setJoined(true)
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

  // Once the brief is ready the motion and the sides are settled: show what will be argued.
  const ready = prep?.status === 'ready'
  const motion = (ready && prep?.motion) || debate.motion
  const side = (ready && prep?.userPosition) || debate.position
  const theirs = (ready && prep?.aiPosition) || debate.aiPosition

  /** From the brief into the argument. Creates the live session on the first tap. */
  const begin = useCallback(async () => {
    setError(null)
    if (sessionId) {
      void live.start()
      return
    }
    setStarting(true)
    try {
      const created = await createDebateSession({
        debateId: debate.debateId,
        prepId: debate.prepId,
        camera: cameraOn,
      })
      startOnArrival = created.id
      setSessionId(created.id)
      setSession({
        ...session,
        debate: {
          ...debate,
          sessionId: created.id,
          motion: created.motion,
          position: created.userPosition,
          aiPosition: created.aiPosition,
          opponentName: created.opponentName,
        },
      })
      // The mic must open from this same tap, so the hook is started once the id lands.
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 429
          ? "You've reached a practice limit for now. Try again later."
          : 'Could not start the debate. Try again in a moment.',
      )
    } finally {
      setStarting(false)
    }
  }, [sessionId, live, debate, cameraOn, session, setSession])

  // A session created by the tap above: open the microphone as soon as it exists, so one tap
  // goes into the debate. Checked against `startOnArrival` rather than room state, because
  // storing the new session id re-keys `DebateRoom` and this room is rebuilt with it.
  //
  // Started from a timer the cleanup cancels, not from the effect body: a mount that is torn
  // down at once (StrictMode does this to every mount in development) would otherwise begin
  // opening the session, have that cancelled by the teardown, and leave the real mount with
  // nothing to start — which is the second tap the user had to make.
  useEffect(() => {
    if (!sessionId || sessionId !== startOnArrival || phase !== 'idle') return
    const timer = window.setTimeout(() => {
      startOnArrival = null
      void live.start()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [sessionId, phase, live])

  const speaking = live.state.interviewerSpeaking
  const opponent = debate.opponentName ?? 'Your opponent'
  const lastName = opponent.split(' ').slice(-1)[0]
  const before = phase === 'idle' || phase === 'starting'

  // Ending from the button goes straight on to the feedback once the session has closed. The
  // camera recording uploads on its own after the room is gone.
  const [feedbackOnEnd, setFeedbackOnEnd] = useState(false)
  const endForFeedback = useCallback(() => {
    setFeedbackOnEnd(true)
    live.end()
  }, [live])
  useEffect(() => {
    if (feedbackOnEnd && phase === 'ended' && sessionId) openFeedback(sessionId)
  }, [feedbackOnEnd, phase, sessionId, openFeedback])

  const roomPhoto = DEBATE_HALL[orientation]
  const takes = DEBATE_TAKES[orientation]
  // A take nobody filmed falls back to the hall listening, and that to the photograph, so a hall
  // with no footage at all still works.
  const [missing, setMissing] = useState<string[]>([])
  const filmed = useCallback((src: string) => !missing.includes(src), [missing])
  const onMissing = useCallback((src: string) => setMissing((gone) => (gone.includes(src) ? gone : [...gone, src])), [])
  const arguing = useArguing(speaking)
  // His face is painted onto this same hall footage, so once it is streaming it *is* the shot:
  // the bench, the audience, the lectern, and his mouth moving on his own words. Nothing cuts
  // and nothing zooms.
  //
  // It stays on screen the whole time it is live. The face is built from the calm take, so
  // between his sentences it shows him still with his mouth shut, and his mouth moves only on
  // the voice it is sent, in the same stream as that voice. It used to be shown only while a
  // level meter heard him, which mattered when the base clip mouthed words of its own; the
  // meter needs the browser's audio to be unlocked, and when it was not, the lip-synced picture
  // never came on at all.
  //
  // Except while its picture is frozen: the stream comes a long way at full size, and when video
  // is lost the browser holds the last frame while the voice (its own, lighter track) carries
  // on. For those moments the calm take — the same shot, mouth shut — stands in.
  const [faceStalled, setFaceStalled] = useState(false)
  const faceShown = Boolean(leadFaceLive) && !faceStalled
  const wanted = arguing && !faceShown ? takes.lead : takes.listen
  const running = filmed(wanted) ? wanted : takes.listen

  return (
    <div className="absolute inset-0 z-[45] bg-black" role="region" aria-label="Debate">
      <div className="absolute inset-0 overflow-hidden bg-[#0b0d12]">
        <img src={roomPhoto} alt="" className="absolute inset-0 size-full object-cover" />
        {/* The hall on the same locked-off frame: the bench listening while you argue, and the
            opponent speaking while they do. Both stay mounted, so the change between them is a
            change of which is showing rather than a clip being fetched. */}
        {[...new Set([takes.listen, takes.lead])].filter(filmed).map((src) => (
          <RoomTake key={src} src={src} poster={roomPhoto} running={src === running} onMissing={onMissing} />
        ))}
        {/* The same hall, streamed from the face server with his mouth on the words he is
            actually saying. Shown for as long as it is connected. */}
        {avatar && !avatarFailed && (
          <AvatarTile
            variant="closeup"
            renderer={avatar.renderer}
            name={avatar.name}
            role={avatar.role}
            speaking={speaking}
            shown={faceShown}
            onStall={setFaceStalled}
            onLive={room.setFaceOnScreen}
            onFailed={room.onAvatarFailed}
            onEnded={room.onFaceEnded}
          />
        )}
        {/* Before the debate the room sits behind the brief, so the text stays readable. */}
        <div
          className={cn(
            'absolute inset-0 transition-colors duration-500',
            before ? 'bg-black/80' : 'bg-gradient-to-t from-black/70 via-transparent to-black/40',
          )}
        />
      </div>

      {/* While it runs: the motion and your side, on the laptop at your own lectern. An upright
          phone crops the lectern out of the shot, so there it sits over the hall instead. */}
      {!before &&
        (orientation === 'landscape' ? (
          <LecternLaptop>
            <div className="flex size-full flex-col justify-center bg-gradient-to-br from-[#f4f6fa] to-[#dde3ec] px-12 text-[#1d2b44]">
              <div className="text-[17px] font-semibold uppercase tracking-[0.18em] text-[#5b6b85]">The motion</div>
              <div className="mt-3 text-[34px] font-semibold leading-[1.18]">{motion}</div>
              <div className="mt-6 flex items-center gap-4 text-[22px] font-semibold">
                <span className="rounded-lg bg-[#1f8a64] px-3 py-1 text-white">You: {SIDE_LABEL[side]}</span>
                <span className="text-[#4a5a74]">
                  {lastName}: {SIDE_LABEL[theirs]}
                </span>
              </div>
            </div>
          </LecternLaptop>
        ) : (
          <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+0.9rem)] z-10 flex justify-center px-16">
            <div className="max-w-md rounded-xl bg-black/45 px-3 py-2 text-center backdrop-blur-sm">
              <div className="text-[11.5px] leading-snug text-mist">{motion}</div>
              <div className="mt-1 flex items-center justify-center gap-2 text-[10.5px] font-semibold">
                <span className="text-jade-400">YOU: {SIDE_LABEL[side]}</span>
                <span className="text-faint">·</span>
                <span className="text-mist">
                  {lastName}: {SIDE_LABEL[theirs]}
                </span>
              </div>
            </div>
          </div>
        ))}

      {!before && speaking && <SceneCaption>{`${lastName} is speaking`}</SceneCaption>}

      <LeaveArrow onLeave={liveActive ? live.end : leave} confirm={liveActive} what="the debate" />

      {/* Turning the camera off mid-debate is one tap, and it is the only control while it runs. */}
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

      {/* Out of the debate and straight to the feedback on what was said so far. */}
      {liveActive && (
        <button
          type="button"
          onClick={endForFeedback}
          className="absolute bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] left-1/2 z-20 h-10 -translate-x-1/2 rounded-full border border-white/15 bg-black/45 px-5 text-[12.5px] font-medium text-chalk backdrop-blur-sm transition-colors hover:bg-black/65"
        >
          End &amp; see feedback
        </button>
      )}

      {/* In person: your own camera only until you are in frame and talking. */}
      {cameraOn && camera.stream && (
        <CameraCheck stream={camera.stream} framing={room.framingStatus} standing={false} micLevel={live.state.micLevel} />
      )}

      {/* Before it starts: the brief, or the wait for it. */}
      {before && (
        <div className="absolute inset-0 z-10 overflow-y-auto px-4 py-[calc(env(safe-area-inset-top,0px)+3.5rem)]">
          {prepPath && !ready ? (
            prep?.status === 'failed' ? (
              <div className="mx-auto w-full max-w-md text-center">
                <p className="text-[13px] font-medium text-[#fca5a5]">
                  {preparationFailure(prep.failureReason)}
                </p>
                <Button variant="ghost" className="mt-3" onClick={leave}>
                  Back
                </Button>
              </div>
            ) : (
              <Preparing prep={prep} />
            )
          ) : prepPath && prep ? (
            <DebatePrep prep={prep} onStart={() => void begin()} starting={starting || phase === 'starting'} />
          ) : (
            // Started straight from a topic: no brief, so this is the one way in.
            <StraightIn
              motion={motion}
              side={side}
              theirs={theirs}
              opponent={opponent}
              format={debate.format}
              difficulty={debate.difficulty}
              focus={debate.focus}
              starting={starting || phase === 'starting'}
              cameraError={camera.error}
              onStart={() => void begin()}
            />
          )}
          {error && (
            <p className="mx-auto mt-3 max-w-md text-center text-[12px] text-[#fca5a5]" role="alert">
              {error}
            </p>
          )}
        </div>
      )}


      <LiveOverlay
        live={live}
        session={session}
        kind="debate"
        videoUpload={room.videoUpload}
        onLeave={leave}
        onFeedback={() => sessionId && openFeedback(sessionId)}
        intro={false}
        nextSteps={
          sessionId ? (
            <DebateNextSteps
              session={session}
              sessionId={sessionId}
              onFeedback={() => openFeedback(sessionId)}
              onLeave={leave}
              onAgain={setSession}
            />
          ) : undefined
        }
      />
    </div>
  )
}

/** No brief: the motion, both sides, and the way in. */
function StraightIn({
  motion,
  side,
  theirs,
  opponent,
  format,
  difficulty,
  focus,
  starting,
  cameraError,
  onStart,
}: {
  motion: string
  side: DebatePosition
  theirs: DebatePosition
  opponent: string
  format: keyof typeof DEBATE_FORMAT_LABEL
  difficulty: keyof typeof DEBATE_DIFFICULTY_LABEL
  focus?: DebateFocus
  starting: boolean
  cameraError: string | null
  onStart: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-md text-center">
      <div className="eyebrow">The motion</div>
      <h2 className="mt-1 text-[17px] font-semibold leading-snug tracking-tight text-chalk">{motion}</h2>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <span className="rounded-lg border border-jade-400/40 bg-jade-500/15 px-2 py-1 text-[11.5px] font-semibold text-jade-400">
          You argue {SIDE_LABEL[side]}
        </span>
        <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11.5px] font-medium text-mist">
          {opponent} argues {SIDE_LABEL[theirs]}
        </span>
      </div>
      <p className="mt-3 text-[11px] text-faint">
        {[
          DEBATE_FORMAT_LABEL[format],
          DEBATE_DIFFICULTY_LABEL[difficulty],
          focus && focus !== 'none' ? `Focus: ${FOCUS_LABELS[focus]}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {cameraError && <p className="mt-2 text-[11.5px] text-[#fca5a5]">{cameraError}</p>}
      <Button variant="primary" className="mt-4 h-10 px-6" disabled={starting} onClick={onStart}>
        {starting ? 'One moment…' : `Begin against ${opponent.split(' ').slice(-1)[0]}`}
      </Button>
      <p className="mt-2 text-[11px] leading-relaxed text-mist">
        Open with your position and your strongest reason. Your opponent will argue back — answer what
        it actually objects to.
      </p>
    </div>
  )
}

/** After the debate: the four ways to go again (§31), the feedback, or out. */
function DebateNextSteps({
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
  const [pending, setPending] = useState<AgainMode | null>(null)
  const [error, setError] = useState<string | null>(null)

  const go = async (mode: AgainMode) => {
    setPending(mode)
    setError(null)
    try {
      const created = await debateAgain(sessionId, mode)
      onAgain({
        ...session,
        debate: {
          ...session.debate!,
          // A new attempt has no brief screen of its own: the motion is already settled.
          debateId: undefined,
          prepId: undefined,
          sessionId: created.id,
          motion: created.motion,
          position: created.userPosition,
          aiPosition: created.aiPosition,
          format: created.format,
          difficulty: created.difficulty,
          opponentName: created.opponentName,
        },
      })
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 429
          ? "You've reached a practice limit for now. Try again later."
          : 'Could not start another debate. Try again in a moment.',
      )
    } finally {
      setPending(null)
    }
  }

  const options: { mode: AgainMode; label: string; note: string }[] = [
    { mode: 'again', label: 'Debate this again', note: 'Same motion, same side, aimed at what went weakest' },
    { mode: 'switch', label: 'Argue the other side', note: 'The best test of whether you understood the case' },
    { mode: 'harder', label: 'A harder opponent', note: 'Deeper challenges and less forgiving reasoning' },
    { mode: 'focus', label: 'Practise one weakness', note: 'Your opponent leans on whatever needs work' },
  ]

  return (
    <>
      <Button variant="primary" className="mt-4 w-full" disabled={!!pending} onClick={onFeedback}>
        View feedback
      </Button>
      <div className="mt-3 grid gap-1.5">
        {options.map((option) => (
          <button
            key={option.mode}
            type="button"
            disabled={!!pending}
            onClick={() => void go(option.mode)}
            className="rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-left transition-all duration-200 hover:border-jade-400/40 hover:bg-jade-500/10 disabled:opacity-50"
          >
            <span className="block text-[12.5px] font-medium leading-tight text-chalk">
              {pending === option.mode ? 'Preparing…' : option.label}
            </span>
            <span className="mt-0.5 block text-[10.5px] leading-tight text-faint">{option.note}</span>
          </button>
        ))}
      </div>
      <Button variant="ghost" className="mt-2 w-full" disabled={!!pending} onClick={onLeave}>
        Back to the city
      </Button>
      {error && (
        <p className="mt-2 text-[12px] text-[#fca5a5]" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
