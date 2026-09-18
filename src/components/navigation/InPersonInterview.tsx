import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PANEL, interviewerFor } from '@/data/interviewers'
import { ARRIVAL, RECEPTION_STILL, ROOM_PHOTO, type Orientation } from '@/data/inPersonMedia'
import type { SessionSetup } from '@/data/practice'
import { useCamera } from '@/lib/useCamera'
import { cn } from '@/lib/utils'
import { CodePane } from '@/modules/interview/live/CodePane'
import { CUT_BACK_MS, shotFor, type Speaker } from '@/modules/interview/live/shots'
import { useInterviewRoom, type InterviewRoom } from '@/modules/interview/live/useInterviewRoom'
import type { LiveInterviewControls } from '@/modules/interview/live/useLiveInterview'
import type { AvatarRenderer } from '@/platform/avatar/types'
import { isLiveInPerson, useAppStore } from '@/state/useAppStore'
import { Button } from '../ui/Button'
import { IconCode } from '../ui/Icon'
import { AvatarTile } from './AvatarTile'
import { LeaveArrow, LiveOverlay, SceneCaption } from './LivePanels'

/**
 * A live interview in person, the way a visit goes: the firm's glass doors, a tap of the pass,
 * the walk in, the receptionist's welcome while the interviewer comes down, then the meeting
 * room from the candidate's chair. The interviewers are people recorded seated at a desk (our
 * LiveTalking server lip-syncs them and plays them writing notes while the candidate answers),
 * shown whole and cutting to whoever speaks.
 * Nothing on screen but a way out: no call controls, timers or meters.
 */

/** A beat after the welcome and the interviewer's arrival before walking to the room. */
const TAKE_SEAT_DELAY_MS = 1200

type Arrival = 'door' | 'walking' | 'greeting' | 'waiting'

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

/** Resolves once the candidate is seated in the meeting room. */
function useSeatedGate(seated: boolean) {
  const seatedRef = useRef(seated)
  seatedRef.current = seated
  const waiters = useRef<(() => void)[]>([])
  useEffect(() => {
    if (seated) waiters.current.splice(0).forEach((release) => release())
  }, [seated])
  return useCallback(
    () => (seatedRef.current ? Promise.resolve() : new Promise<void>((resolve) => waiters.current.push(resolve))),
    [],
  )
}

/** Who is talking now, held briefly after they stop. */
function useSpeaker(live: LiveInterviewControls): Speaker {
  const { interviewerSpeaking, panelSpeaker } = live.state
  const now: Speaker = panelSpeaker
    ? { kind: 'colleague', name: panelSpeaker }
    : interviewerSpeaking
      ? { kind: 'lead' }
      : null
  const key = now ? (now.kind === 'lead' ? 'lead' : now.name) : ''
  const [held, setHeld] = useState<Speaker>(now)
  useEffect(() => {
    if (now) {
      setHeld(now)
      return
    }
    const timer = window.setTimeout(() => setHeld(null), CUT_BACK_MS)
    return () => window.clearTimeout(timer)
    // `now` is rebuilt every render; `key` is what changes.
  }, [key])
  return held
}

/** The live in-person interview on screen now, if any: from the front door until leaving the room. */
export function inPersonHere(state: {
  view: string
  interiorZone: string
  session: SessionSetup | null
  selectedId: string | null
}): { session: SessionSetup; sessionId: string; zone: 'door' | 'reception' | 'meeting' } | null {
  const { view, interiorZone, session, selectedId } = state
  if (view !== 'interior' || !session || session.locationId !== selectedId || !isLiveInPerson(session)) return null
  if (interiorZone !== 'door' && interiorZone !== 'reception' && interiorZone !== 'meeting') return null
  return { session, sessionId: session.interview!.sessionId!, zone: interiorZone }
}

export function InPersonInterview() {
  const view = useAppStore((s) => s.view)
  const interiorZone = useAppStore((s) => s.interiorZone)
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  const here = inPersonHere({ view, interiorZone, session, selectedId })
  if (!here) return null
  return <InPersonRoom key={here.sessionId} {...here} />
}

export function InPersonRoom({
  session,
  sessionId,
  zone,
}: {
  session: SessionSetup
  sessionId: string
  zone: 'door' | 'reception' | 'meeting'
}) {
  const leaveInterior = useAppStore((s) => s.leaveInterior)
  const openFeedback = useAppStore((s) => s.openFeedback)
  const scanPass = useAppStore((s) => s.scanPass)
  const takeSeat = useAppStore((s) => s.takeSeat)
  const setSceneCovered = useAppStore((s) => s.setSceneCovered)
  const orientation = useOrientation()
  const seated = zone === 'meeting'
  const interview = session.interview!
  const panel = interview.panel === 'panel'
  const lead = interviewerFor(interview.roundType)
  const colleagues = panel ? PANEL.filter((m) => m.onCamera) : []
  const roomPhoto = ROOM_PHOTO[panel ? 'panel' : 'one'][orientation]
  const arrivalMedia = ARRIVAL[orientation]

  // From the pass on, the camera measures presence on the device (the browser shows it's on).
  const [started, setStarted] = useState(false)
  const camera = useCamera(started)
  const beforeConnect = useSeatedGate(seated)
  const speakerRef = useRef<Speaker>(null)
  const tracker = useMemo(
    () => ({
      setting: 'screen' as const,
      // Whoever speaks fills the screen.
      speakerSeat: panel ? () => (speakerRef.current ? 0 : null) : undefined,
    }),
    // The panel doesn't change within an interview.
    [panel],
  )
  const room = useInterviewRoom({ sessionId, camera: camera.stream, beforeConnect, tracker })
  const { live, liveActive, avatar, avatarFailed, faceSettled } = room
  const { phase } = live.state
  useEffect(() => {
    if (phase !== 'idle' && phase !== 'starting') setStarted(true)
  }, [phase])

  // Arriving: the door, the walk in, the welcome, then waiting for the interviewer.
  const [arrival, setArrival] = useState<Arrival>(zone === 'door' ? 'door' : 'waiting')
  const scan = () => {
    // The tap on the reader is also what lets the microphone open and the welcome be heard.
    void live.start()
    scanPass()
    setArrival('walking')
  }
  useEffect(() => {
    if (zone !== 'reception' || arrival !== 'waiting' || !faceSettled) return
    const timer = window.setTimeout(takeSeat, TAKE_SEAT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [zone, arrival, faceSettled, takeSeat])

  const speaker = useSpeaker(live)
  const shot = shotFor(speaker, {
    lead: room.leadFaceLive,
    colleagues: Object.fromEntries(colleagues.map((m) => [m.name, m.name in room.panelFaces])),
  })
  speakerRef.current = speaker
  const coding = liveActive && live.state.coding
  const [boardOpen, setBoardOpen] = useState(false)

  // The photos and footage cover the whole screen: no need to draw the 3D building under them.
  useEffect(() => {
    setSceneCovered(true)
    return () => setSceneCovered(false)
  }, [setSceneCovered])

  // A voice with no face on screen (their face couldn't join): say who is talking.
  const faceless =
    speaker?.kind === 'lead'
      ? room.leadFaceLive
        ? null
        : (avatar?.name ?? lead.name)
      : speaker?.kind === 'colleague' && !(speaker.name in room.panelFaces)
        ? speaker.name
        : null
  const leadFirst = (avatar?.name ?? lead.name).split(' ')[0]
  const leave = seated && liveActive ? live.end : leaveInterior

  return (
    <div
      className="absolute inset-0 z-[44] bg-black"
      aria-label={seated ? 'Meeting room' : zone === 'door' ? 'Entrance' : 'Reception'}
    >
      {/* Arriving */}
      {!seated && (
        <div className="absolute inset-0">
          <img src={RECEPTION_STILL[orientation]} alt="" className="absolute inset-0 size-full object-cover" />
          {arrival === 'door' && <img src={arrivalMedia.door} alt="" className="absolute inset-0 size-full object-cover" />}
          {arrival === 'walking' && (
            <video
              src={arrivalMedia.walkIn}
              poster={arrivalMedia.door}
              autoPlay
              muted
              playsInline
              onEnded={() => setArrival('greeting')}
              onError={() => setArrival('greeting')}
              className="absolute inset-0 size-full object-cover"
            />
          )}
          {arrival === 'greeting' && (
            <video
              src={arrivalMedia.greeting}
              autoPlay
              playsInline
              onEnded={() => setArrival('waiting')}
              onError={() => setArrival('waiting')}
              className="absolute inset-0 size-full object-cover"
            />
          )}
          {arrival === 'door' && (
            <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] z-10 flex justify-center px-4">
              <button
                type="button"
                onClick={scan}
                className="anim-rise rounded-full border border-[#d6b77a]/50 bg-black/50 px-5 py-2.5 text-[13.5px] font-medium text-[#f3e4c4] backdrop-blur-sm transition-colors hover:bg-black/70"
              >
                Tap your pass to go in
              </button>
            </div>
          )}
          {arrival === 'waiting' && phase !== 'failed' && (
            <SceneCaption>
              {faceSettled ? `${leadFirst} is here. Follow them to the meeting room.` : `${leadFirst} is on the way down…`}
            </SceneCaption>
          )}
        </div>
      )}

      {/* The meeting room. Faces stay mounted from the pass on, so seating them never restarts a stream. */}
      <div
        className={cn('absolute inset-0 overflow-hidden', seated ? 'opacity-100' : 'pointer-events-none opacity-0')}
      >
        <div className="absolute inset-0 bg-[#0b0d12]" />
        <img src={roomPhoto} alt="" className="absolute inset-0 size-full object-cover" />
        {avatar && !avatarFailed && (
          <AvatarTile
            variant="closeup"
            renderer={avatar.renderer}
            name={avatar.name}
            role={avatar.role}
            shown={shot.kind === 'closeup' && shot.who === 'lead'}
            onLive={room.setFaceOnScreen}
            onFailed={room.onAvatarFailed}
            onEnded={room.onFaceEnded}
          />
        )}
        {colleagues.map((member) => {
          const face = room.colleagueFace(member.name)
          return face ? (
            <Colleague
              key={member.name}
              name={member.name}
              role={member.role}
              renderer={face}
              shown={shot.kind === 'closeup' && shot.who === member.name}
              room={room}
            />
          ) : null
        })}
        {seated && faceless && <SceneCaption>{`${faceless.split(' ')[0]} is speaking`}</SceneCaption>}
        {seated && coding && boardOpen && (
          <div className="absolute inset-x-3 bottom-20 top-16 z-10 flex sm:inset-x-8">
            <CodePane live={live} />
          </div>
        )}
        {seated && coding && (
          <button
            type="button"
            onClick={() => setBoardOpen((open) => !open)}
            aria-pressed={boardOpen}
            className="absolute right-4 top-[calc(env(safe-area-inset-top,0px)+0.9rem)] z-20 flex h-10 items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-3.5 text-[12px] text-chalk backdrop-blur-sm hover:bg-black/55"
          >
            <IconCode width={15} height={15} />
            {boardOpen ? 'Hide whiteboard' : 'Whiteboard'}
          </button>
        )}
      </div>

      <LeaveArrow onLeave={leave} confirm={seated && liveActive} what="the interview" />

      {/* The next round, already in the room. */}
      {seated && (phase === 'idle' || phase === 'starting') && (
        <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] z-10 flex justify-center px-4">
          <Button variant="primary" className="h-10 px-6" disabled={phase === 'starting'} onClick={() => void live.start()}>
            {phase === 'starting' ? 'One moment…' : `Begin with ${leadFirst}`}
          </Button>
        </div>
      )}

      {(seated || phase === 'failed') && (
        <LiveOverlay
          live={live}
          session={session}
          videoUpload={room.videoUpload}
          onLeave={leaveInterior}
          onFeedback={() => openFeedback(sessionId)}
          intro={false}
        />
      )}
    </div>
  )
}

function Colleague({
  room,
  name,
  ...props
}: { room: InterviewRoom; name: string; role: string; renderer: AvatarRenderer; shown: boolean }) {
  const { colleagueLive, colleagueFailed, onFaceEnded } = room
  const onLive = useCallback((r: AvatarRenderer) => colleagueLive(name, r), [colleagueLive, name])
  const onFailed = useCallback(() => colleagueFailed(name), [colleagueFailed, name])
  return <AvatarTile variant="closeup" name={name} {...props} onLive={onLive} onFailed={onFailed} onEnded={onFaceEnded} />
}
