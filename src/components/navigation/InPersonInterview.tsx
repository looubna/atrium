import { useEffect, useMemo, useRef, useState } from 'react'
import { PANEL_IN_PERSON, leadFor } from '@/data/interviewers'
import { ARRIVAL, ONE_FACE_ROOM, PANEL_FACE_ROOM, RECEPTION_STILL, type Orientation } from '@/data/inPersonMedia'
import type { SessionSetup } from '@/data/practice'
import { useCamera } from '@/lib/useCamera'
import { cn } from '@/lib/utils'
import { CodePane } from '@/modules/interview/live/CodePane'
import { CUT_BACK_MS, type Speaker } from '@/modules/interview/live/shots'
import { useInterviewRoom } from '@/modules/interview/live/useInterviewRoom'
import type { LiveInterviewControls } from '@/modules/interview/live/useLiveInterview'
import { isLiveInPerson, useAppStore } from '@/state/useAppStore'
import { Button } from '../ui/Button'
import { IconCode } from '../ui/Icon'
import { LeaveArrow, LiveOverlay, SceneCaption } from './LivePanels'
import { AvatarTile } from './AvatarTile'
import { RotateHint } from './RotateHint'
import { CameraCheck } from './CameraCheck'

/**
 * A live interview in person, the way a visit goes: the firm's glass doors, a tap of the pass,
 * the walk in, the receptionist's welcome while the interviewer comes down, then the meeting
 * room from the candidate's chair, where the camera stays for the whole interview.
 *
 * The room is the picture, and nothing is ever drawn over it. It is filmed once per speaker on
 * the same locked-off frame — everyone listening, the lead talking, a colleague talking — and the
 * take running is the one whose person has the floor, with their name under the frame. Every take
 * starts and ends on the photograph, so the change is invisible.
 * Nothing on screen but a way out: no call controls, timers or meters.
 */

/** A beat after the welcome and the interviewer's arrival before walking to the room. */
const TAKE_SEAT_DELAY_MS = 1200

/** How long a new face's name and role stay on screen, the way a call tile carries them. */
const NAME_PLATE_MS = 4000

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

/**
 * Whose voice is audible now, held briefly after they stop.
 *
 * On the voice actually playing, never on a turn merely queued: the room films one person per
 * speaker, so being a beat early means the wrong mouth moves.
 */
function useSpeaker(live: LiveInterviewControls): Speaker {
  const { leadVoicing, panelSpeaker } = live.state
  const now: Speaker = panelSpeaker
    ? { kind: 'colleague', name: panelSpeaker }
    : leadVoicing
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
  // Still on screen while the building fades out ('exiting'): otherwise the bare 3D room shows
  // for the length of the fade after the interview ends.
  if ((view !== 'interior' && view !== 'exiting') || !session || session.locationId !== selectedId || !isLiveInPerson(session)) return null
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
  // Always the room's own interviewer: the candidate can see whose chair it is.
  const lead = leadFor(interview.roundType, true)
  // Everyone else at the table, whether or not they ever ask anything: the one who sits in and
  // takes notes still says hello, and is still named the first time the candidate hears her.
  const table = panel ? PANEL_IN_PERSON : []
  const arrivalMedia = ARRIVAL[orientation]

  // From the pass on, the camera measures presence on the device (the browser shows it's on).
  const [started, setStarted] = useState(false)
  const camera = useCamera(started)
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
  // The call connects on the way in; the interviewer opens the moment the candidate sits down.
  // The interviewers are live, lip-synced faces: one to one, Evelyn at her desk; as a panel, the
  // three of them at the table, one face that paints whoever is speaking.
  const room = useInterviewRoom({ sessionId, camera: camera.stream, openWhen: seated, loaderAfterOpen: true, tracker })
  const { live, liveActive, avatar } = room
  // Their room and their faces, unless there is no face today: then the filmed room, voice only.
  const faceRoom = !room.avatarUnavailable && !room.avatarFailed
  const faceMedia = panel ? PANEL_FACE_ROOM : ONE_FACE_ROOM
  // At the table the colleagues speak through the same face as the lead, each under their own name.
  const { leadFaceLive, colleagueLive } = room
  useEffect(() => {
    if (!leadFaceLive || !avatar) return
    for (const [name, renderer] of Object.entries(avatar.panel)) colleagueLive(name, renderer)
  }, [leadFaceLive, avatar, colleagueLive])
  const { phase } = live.state
  // Nobody's face has to join any more, so what the candidate waits for at reception is the
  // interview itself being connected — the same beat, now measuring something real.
  const arrived = phase === 'live' || phase === 'reconnecting'
  useEffect(() => {
    if (phase !== 'idle' && phase !== 'starting') setStarted(true)
  }, [phase])

  // Arriving: the door, the walk in, the welcome, then waiting for the interviewer.
  const [arrival, setArrival] = useState<Arrival>(zone === 'door' ? 'door' : 'waiting')
  const scan = () => {
    if (arrival !== 'door') return  // a second tap must not open a second session
    // The tap on the reader is also what lets the microphone open and the welcome be heard.
    void live.start()
    scanPass()
    setArrival('walking')
  }
  useEffect(() => {
    if (zone !== 'reception' || arrival !== 'waiting' || !arrived) return
    const timer = window.setTimeout(takeSeat, TAKE_SEAT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [zone, arrival, arrived, takeSeat])

  const speaker = useSpeaker(live)
  speakerRef.current = speaker
  // Everyone in the room, the lead first: one shape, so a cut, a still and a name plate never
  // have to ask which kind of person they are looking at.
  const cast = [
    { key: 'lead', name: lead.name, role: lead.role },
    ...table.map((m) => ({ key: m.name, name: m.name, role: m.role })),
  ]
  // Who is talking, if anyone: theirs is the take that runs.
  const onScreen = speaker?.kind === 'colleague' ? speaker.name : speaker?.kind === 'lead' ? 'lead' : null
  // Everyone is in the room from the moment the candidate sits down, so each is named the first
  // time they speak, and after that they are simply someone the candidate has met.
  const [met, setMet] = useState<string[]>([])
  const introducing =
    seated && liveActive && onScreen && !met.includes(onScreen) ? cast.find((p) => p.key === onScreen) : undefined
  const introducingKey = introducing?.key
  useEffect(() => {
    if (!introducingKey) return
    const timer = window.setTimeout(() => setMet((names) => [...names, introducingKey]), NAME_PLATE_MS)
    return () => window.clearTimeout(timer)
  }, [introducingKey])
  const coding = liveActive && live.state.coding
  const [boardOpen, setBoardOpen] = useState(false)

  // The photos and footage cover the whole screen: no need to draw the 3D building under them.
  useEffect(() => {
    setSceneCovered(true)
    return () => setSceneCovered(false)
  }, [setSceneCovered])

  const speaking = speaker?.kind === 'lead' ? lead.name : speaker?.kind === 'colleague' ? speaker.name : null
  const leadFirst = lead.name.split(' ')[0]
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
          {(arrival === 'walking' || arrival === 'greeting') && (
            <div className="absolute right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] z-10">
              <button
                type="button"
                onClick={() => setArrival('waiting')}
                className="rounded-full border border-white/25 bg-black/45 px-4 py-2 text-[12.5px] font-medium text-white/85 backdrop-blur-sm transition-colors hover:bg-black/65"
              >
                Skip
              </button>
            </div>
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
              {arrived ? `${leadFirst} is here. Follow them to the meeting room.` : `${leadFirst} is on the way down…`}
            </SceneCaption>
          )}
        </div>
      )}

      {/* The meeting room. The takes stay mounted from the pass on, so changing between them
          is a change of which is showing rather than a clip being fetched. */}
      <div
        className={cn('absolute inset-0 overflow-hidden', seated ? 'opacity-100' : 'pointer-events-none opacity-0')}
      >
        <div className="absolute inset-0 bg-[#0b0d12]" />
        {/* The room from the candidate's chair: the photograph, and over it the one take whose
            person has the floor. Every take is that same frame, so there is no cut to see and
            nothing is drawn into the picture that was not filmed in it. */}
        {/* The room is always the filmed scene the live face is made from; the face joins over it. */}
        <img src={faceMedia.still} alt="" className="absolute inset-0 size-full object-cover" />
        <video
          src={faceMedia.loop}
          poster={faceMedia.still}
          autoPlay
          loop
          muted
          playsInline
          disablePictureInPicture
          className="absolute inset-0 size-full object-cover"
        />
        {faceRoom && avatar && (
          <AvatarTile
            variant="closeup"
            renderer={avatar.renderer}
            name={avatar.name}
            role={avatar.role}
            speaking={live.state.interviewerSpeaking}
            shown
            onLive={room.setFaceOnScreen}
            onFailed={room.onAvatarFailed}
            onEnded={room.onFaceEnded}
          />
        )}
        {introducing && (
          <div className="anim-fade pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-10">
            <div className="text-[13px] font-semibold text-chalk">{introducing.name}</div>
            <div className="text-[11.5px] text-mist">{introducing.role}</div>
          </div>
        )}
        {seated && speaking && !introducing && !(faceRoom && room.leadFaceLive) && <SceneCaption>{`${speaking.split(' ')[0]} is speaking`}</SceneCaption>}
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

      {/* Your own camera only until you are in frame and talking: in a room, nobody watches themselves. */}
      {seated && liveActive && (
        <CameraCheck stream={camera.stream} framing={room.framingStatus} standing={false} micLevel={live.state.micLevel} />
      )}

      {/* The panel is one wide shot: upright, only the middle seat fits. */}
      {seated && panel && <RotateHint who="the whole panel" />}

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
