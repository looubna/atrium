import { useCallback, useEffect, useRef, useState } from 'react'
import type { InterviewMode, MeetingBriefing, NegotiationBriefing, SalesBriefing } from '@/data/practice'
import { useCamera } from '@/lib/useCamera'
import { cn } from '@/lib/utils'
import type { FaceModule } from '@/modules/interview/api'
import { useInterviewRoom } from '@/modules/interview/live/useInterviewRoom'
import type { AvatarRenderer } from '@/platform/avatar/types'
import { useAppStore } from '@/state/useAppStore'
import { Button } from '../ui/Button'
import { IconMic, IconMicOff, IconPhoneOff, IconVideo, IconVideoOff } from '../ui/Icon'
import { AvatarTile } from './AvatarTile'

/**
 * Sales practice: the user sells to Claire (a prospect, a buyer, a client) or pitches Robert, Priya
 * and Kevin at a venture fund — online on a video call, or in person across a table.
 *
 * Everyone on the other side was filmed for sales only, and speaks with a live, lip-synced face;
 * the model plays them all (backend `modules/sales`), the lead in its own voice and the others
 * through hand-overs. Online is laid out like a meeting app with the user's camera as their own
 * tile; in person the screen is the room from the user's chair. The filmed loop under the face is
 * the same shot, so it shows while the face connects, and stays (voice only) if it never does.
 *
 * Negotiation (`NegotiationCall`) runs on the same screen and the same people, in other roles.
 */

type Person = { key: string; name: string; role: string }

const MEDIA = '/video/sales'
/** The shot for each kind of session: its filmed loop and first frame. */
const shot = (name: string) => ({
  loop: `${MEDIA}/${name}.mp4`,
  still: `${MEDIA}/${name}.jpg`,
})

/**
 * The investors' call is one 1280x720 stream (`sl_investors` on the face server): three webcams
 * tiled, lip-synced for whoever speaks. Where each sits in it, as the (x, y) of their 640x360 tile.
 */
const CALL_TILES: Record<string, [number, number]> = {
  robert: [0, 0],
  priya: [640, 0],
  kevin: [0, 360],
}

function useSize(ref: React.RefObject<HTMLElement>) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

/** Where the 1280x720 stream goes so that `tile` fills the box: scaled to cover it, centred on that quarter. */
function tileCrop(tile: [number, number], w: number, h: number): React.CSSProperties {
  const k = Math.max(w / 640, h / 360)
  return {
    width: 1280 * k,
    height: 720 * k,
    left: w / 2 - (tile[0] + 320) * k,
    top: h / 2 - (tile[1] + 180) * k,
  }
}

/** The sales session on screen now, if any. */
export function salesHere(state: {
  view: string
  session: ReturnType<typeof useAppStore.getState>['session']
  selectedId: string | null
}) {
  const { view, session, selectedId } = state
  if (view !== 'call' || !session || session.locationId !== selectedId) return null
  const sales = session.sales
  return sales?.sessionId ? { sales, sessionId: sales.sessionId } : null
}

export function SalesCall() {
  const view = useAppStore((s) => s.view)
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  const here = salesHere({ view, session, selectedId })
  if (!here) return null
  // A new session is a new screen: rebuilt rather than reused.
  const { sales } = here
  return (
    <LiveDealRoom
      key={here.sessionId}
      sessionId={here.sessionId}
      module="sales"
      mode={sales.mode}
      people={sales.people ?? []}
      briefing={sales.briefing}
      label="Sales session"
      after="How did you sell?"
    />
  )
}

function NameTag({ name, speaking }: { name: string; speaking?: boolean }) {
  return (
    <div className="absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1.5 rounded-md bg-black/55 px-2 py-0.5 text-[11.5px] font-medium text-white">
      {speaking && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-jade-400" aria-hidden />}
      <span className="truncate">{name}</span>
    </div>
  )
}

/** A looping filmed shot, placed like the live face over it. */
function Loop({
  src,
  poster,
  style,
  className,
}: {
  src: string
  poster: string
  style?: React.CSSProperties
  className?: string
}) {
  return (
    <video
      src={src}
      poster={poster}
      autoPlay
      loop
      muted
      playsInline
      disablePictureInPicture
      className={cn('pointer-events-none absolute', className)}
      style={style}
    />
  )
}

/**
 * One person on the call. Their filmed loop until the live face streams (or if it never does);
 * on the investors' call, their quarter of the one shared stream.
 */
function PersonTile({
  person,
  shotName,
  tile,
  renderer,
  mirror,
  speaking,
  onLive,
  onFailed,
  onEnded,
  onStream,
}: {
  person: Person
  shotName: string
  /** On the investors' call: this person's quarter of the stream. */
  tile?: [number, number]
  /** The owner of the stream (the lead): the live face itself. */
  renderer?: AvatarRenderer
  /** Everyone else on a shared stream: a muted copy of it (the owner has the sound). */
  mirror?: MediaStream | null
  speaking: boolean
  onLive?: (renderer: AvatarRenderer) => void
  onFailed?: () => void
  onEnded?: () => void
  onStream?: (stream: MediaStream) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const { w, h } = useSize(box)
  const copy = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (copy.current && mirror) copy.current.srcObject = mirror
  }, [mirror])
  const live = useCallback(
    (r: AvatarRenderer) => {
      onLive?.(r)
      // The face's own video is the one playing a stream rather than a file.
      const stream = box.current?.querySelector('video:not([src])')
      const src = stream instanceof HTMLVideoElement ? stream.srcObject : null
      if (src instanceof MediaStream) onStream?.(src)
    },
    [onLive, onStream],
  )
  const crop = tile ? (w && h ? tileCrop(tile, w, h) : undefined) : undefined
  const media = shot(shotName)
  return (
    <div
      ref={box}
      className={cn(
        'relative min-h-0 overflow-hidden rounded-xl bg-[#1b1f27] transition-shadow duration-200',
        speaking ? 'ring-[3px] ring-jade-400' : 'ring-1 ring-white/10',
      )}
    >
      {(!tile || crop) && (
        <Loop
          src={media.loop}
          poster={media.still}
          style={crop}
          className={crop ? 'max-w-none' : 'inset-0 size-full object-cover'}
        />
      )}
      {mirror && crop && (
        <video ref={copy} autoPlay muted playsInline className="pointer-events-none absolute max-w-none" style={crop} />
      )}
      {renderer && onLive && onFailed && (!tile || crop) && (
        // The face tile draws its own name; this tile's tag already says it, with who is talking.
        <div
          className={cn(
            // The face fills its tile (a tall tile on an upright phone too), cropped like the loop under it.
            'absolute [&>div]:!h-full [&>div]:!rounded-none [&>div]:!ring-0 [&_.bg-gradient-to-t]:hidden',
            crop ? 'max-w-none' : 'inset-0',
          )}
          style={crop}
        >
          <AvatarTile
            renderer={renderer}
            name={person.name}
            role={person.role}
            speaking={speaking}
            onLive={live}
            onFailed={onFailed}
            onEnded={onEnded}
          />
        </div>
      )}
      <NameTag name={`${person.name} · ${person.role}`} speaking={speaking} />
    </div>
  )
}

/** The user's own tile: their camera, mirrored, or a note with the camera off. */
function SelfTile({
  stream,
  cameraOn,
  muted,
  small,
}: {
  stream: MediaStream | null
  cameraOn: boolean
  muted: boolean
  small?: boolean
}) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (video.current) video.current.srcObject = stream
  }, [stream])
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl bg-[#1b1f27] ring-1 ring-white/10',
        small ? 'h-28 w-44 shadow-lg sm:h-36 sm:w-56' : 'min-h-0',
      )}
    >
      {cameraOn && stream ? (
        <video ref={video} autoPlay muted playsInline className="size-full -scale-x-100 object-cover" />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-[13px] text-white/60">Camera off</div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/55 px-2 py-0.5 text-[11.5px] font-medium text-white">
        {muted && <IconMicOff width={11} height={11} className="text-[#fca5a5]" />}
        You
      </div>
    </div>
  )
}

function Control({
  label,
  danger,
  active,
  onClick,
  children,
}: {
  label: string
  danger?: boolean
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'grid size-11 place-items-center rounded-full transition-colors',
        danger
          ? 'w-16 bg-[#e5484d] text-white hover:bg-[#d13438]'
          : active
            ? 'bg-white/10 text-white hover:bg-white/20'
            : 'bg-[#e5484d]/90 text-white hover:bg-[#e5484d]',
      )}
    >
      {children}
    </button>
  )
}

/** The pre-read: who the user is, the facts, their own position, who is there, and the goal. */
function Briefing({ briefing }: { briefing: SalesBriefing | NegotiationBriefing | MeetingBriefing }) {
  return (
    <div className="text-left">
      <div className="eyebrow">Briefing · {briefing.title}</div>
      <p className="mt-1 text-[12px] text-mist">{'seller' in briefing ? briefing.seller : briefing.you}</p>
      <section className="mt-3">
        <h3 className="text-[13px] font-semibold text-chalk">{briefing.org}</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-mist">{briefing.about}</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-mist">{briefing.situation}</p>
        {'position' in briefing && (
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-mist">
            <span className="font-semibold text-chalk">Your position: </span>
            {briefing.position}
          </p>
        )}
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-chalk">
          <span className="font-semibold">Your goal: </span>
          {briefing.goal}
        </p>
      </section>
      {/* A meeting's briefing also says what to discuss; the others have none, and show nothing here. */}
      {'points' in briefing && briefing.points && briefing.points.length > 0 && (
        <section className="mt-3">
          <h3 className="text-[13px] font-semibold text-chalk">What to discuss</h3>
          <ol className="mt-1 list-decimal space-y-1 pl-4 text-[12.5px] leading-relaxed text-mist">
            {briefing.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ol>
        </section>
      )}
      <section className="mt-3">
        <h3 className="text-[13px] font-semibold text-chalk">Who you meet</h3>
        <ul className="mt-1 space-y-1.5">
          {briefing.people.map((p) => (
            <li key={p.name} className="text-[12.5px] leading-relaxed text-mist">
              <span className="font-semibold text-chalk">{p.name}</span>, {p.role}. {p.known}
            </li>
          ))}
        </ul>
      </section>
      <p className="mt-3 text-[11.5px] text-faint">{briefing.format} The conversation is recorded for your feedback.</p>
    </div>
  )
}

/**
 * One live conversation with Claire, or with Robert, Priya and Kevin: a video call online, the room in
 * person. The screen for sales and for negotiation; which of them is played is the backend `module`'s.
 */
export function LiveDealRoom({
  sessionId,
  module,
  mode,
  people,
  briefing,
  label,
  after,
}: {
  sessionId: string
  module: FaceModule
  mode: InterviewMode
  /** Who is on the other side, the one who speaks first. A group is Robert, Priya and Kevin. */
  people: Person[]
  briefing?: SalesBriefing | NegotiationBriefing | MeetingBriefing
  label: string
  /** The question on the card when it ends ("How did you sell?"). */
  after: string
}) {
  const leave = useAppStore((s) => s.leaveCall)
  const openFeedback = useAppStore((s) => s.openFeedback)
  const setSceneCovered = useAppStore((s) => s.setSceneCovered)
  const inRoom = mode === 'in-person'
  const [lead] = people
  const investors = people.length > 1
  const [cameraOn, setCameraOn] = useState(true)
  const [muted, setMuted] = useState(false)
  const [joined, setJoined] = useState(false)
  const camera = useCamera(joined && cameraOn)
  const room = useInterviewRoom({
    sessionId,
    camera: camera.stream,
    module,
  })
  const { live, liveActive, avatar, avatarFailed } = room
  const { phase, panelSpeaker, interviewerSpeaking, timeLeftMs } = live.state
  // Several people are one face stream: their turns go through it too, named as theirs, so it
  // paints their mouth. The lead's tile owns the stream; the others show a muted copy of it.
  const { leadFaceLive, colleagueLive } = room
  useEffect(() => {
    if (!leadFaceLive || !avatar) return
    for (const [name, renderer] of Object.entries(avatar.panel)) colleagueLive(name, renderer)
  }, [leadFaceLive, avatar, colleagueLive])
  const [stream, setStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    setSceneCovered(true)
    return () => setSceneCovered(false)
  }, [setSceneCovered])
  useEffect(() => {
    if (camera.error) setCameraOn(false)
  }, [camera.error])

  const join = () => {
    setJoined(true)
    void live.start()
  }
  const toggleMute = () => {
    live.setMuted(!muted)
    setMuted(!muted)
  }
  const hangUp = () => (liveActive ? live.end() : leave())

  // Who is talking: a named hand-over is that person; any other voice from the other side is the lead.
  const speakingName = panelSpeaker ?? (interviewerSpeaking ? lead?.name : null)
  const renderer = avatar && !avatarFailed ? avatar.renderer : undefined
  const title = briefing?.title ?? label
  const org = briefing?.org
  const left = timeLeftMs !== null ? Math.max(0, Math.round(timeLeftMs / 1000)) : null
  const clock = left !== null ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left` : null

  const roomShot = shot(investors ? 'room_investors' : 'room_buyer')
  const speaking = people.find((p) => p.name === speakingName)

  return (
    <div
      className="anim-fade absolute inset-0 z-[46] flex flex-col bg-[#0f1115]"
      role="region"
      aria-label={label}
    >
      {inRoom ? (
        // In person: the room from the seller's chair, the whole screen, and nothing drawn into it.
        <div className="absolute inset-0 overflow-hidden">
          <img src={roomShot.still} alt="" className="absolute inset-0 size-full scale-110 object-cover blur-xl" />
          {/* Three people across a table do not fit an upright phone cropped to fill it: there the
              shot is shown whole, over a blur of itself. */}
          <div
            className={cn(
              'absolute inset-0',
              investors &&
                '[@media(orientation:portrait)]:inset-auto [@media(orientation:portrait)]:inset-x-0 [@media(orientation:portrait)]:top-1/2 [@media(orientation:portrait)]:aspect-video [@media(orientation:portrait)]:-translate-y-1/2',
            )}
          >
            <img src={roomShot.still} alt="" className="absolute inset-0 size-full object-cover" />
            <Loop src={roomShot.loop} poster={roomShot.still} className="inset-0 size-full object-cover" />
            {renderer && (
              <AvatarTile
                variant="closeup"
                renderer={renderer}
                name={lead?.name ?? ''}
                role={lead?.role ?? ''}
                speaking={interviewerSpeaking || Boolean(panelSpeaker)}
                shown
                onLive={room.setFaceOnScreen}
                onFailed={room.onAvatarFailed}
                onEnded={room.onFaceEnded}
              />
            )}
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/50 to-transparent px-4 pb-6 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] text-[12.5px] text-white/85">
            <span className="font-medium">
              {title}
              {org && <span className="text-white/60"> · {org}</span>}
            </span>
            {clock && <span className="tabular-nums">{clock}</span>}
          </div>
          {joined && speaking && investors && (
            <div className="pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] flex justify-center">
              <span className="rounded-full bg-black/55 px-3 py-1 text-[12px] font-medium text-white">
                {speaking.name} · {speaking.role}
              </span>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Top bar, as in a meeting app: what the meeting is and how long is left. */}
          <div className="flex items-center justify-between px-4 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] text-[12.5px] text-white/80">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#e5484d]" aria-hidden />
              <span className="font-medium text-white">{title}</span>
              {org && <span className="hidden text-white/50 sm:inline">· {org}</span>}
            </div>
            {clock && <span className="tabular-nums">{clock}</span>}
          </div>
          <div className="relative min-h-0 flex-1 px-3">
            {investors ? (
              <div className="relative grid size-full grid-cols-1 gap-2 sm:grid-cols-2 sm:grid-rows-2 [@media(orientation:portrait)]:grid-cols-1 [@media(orientation:portrait)]:grid-rows-3">
                {people.map((person, i) => (
                  <PersonTile
                    key={person.key}
                    person={person}
                    shotName="call_investors"
                    tile={CALL_TILES[person.key]}
                    renderer={i === 0 ? renderer : undefined}
                    mirror={i > 0 && renderer ? stream : undefined}
                    speaking={speakingName === person.name}
                    onLive={room.setFaceOnScreen}
                    onFailed={room.onAvatarFailed}
                    onEnded={room.onFaceEnded}
                    onStream={setStream}
                  />
                ))}
                {/* The user's own camera: the fourth tile, or a small picture-in-picture on an upright phone. */}
                <div className="contents [@media(orientation:portrait)]:hidden">
                  <SelfTile stream={camera.stream} cameraOn={cameraOn} muted={muted} />
                </div>
                <div className="absolute bottom-2 right-2 hidden [@media(orientation:portrait)]:block">
                  <SelfTile stream={camera.stream} cameraOn={cameraOn} muted={muted} small />
                </div>
              </div>
            ) : (
              <div className="relative size-full">
                <div className="grid size-full">
                  {lead && (
                    <PersonTile
                      person={lead}
                      shotName="call_buyer"
                      renderer={renderer}
                      speaking={speakingName === lead.name}
                      onLive={room.setFaceOnScreen}
                      onFailed={room.onAvatarFailed}
                      onEnded={room.onFaceEnded}
                    />
                  )}
                </div>
                <div className="absolute bottom-3 right-3">
                  <SelfTile stream={camera.stream} cameraOn={cameraOn} muted={muted} small />
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Before joining: the briefing, then in. */}
      {!joined && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="glass flex max-h-[88%] w-full max-w-lg flex-col rounded-2xl p-5">
            <div className="min-h-0 overflow-y-auto pr-1">
              {briefing ? (
                <Briefing briefing={briefing} />
              ) : (
                <div className="text-center">
                  <div className="eyebrow">{title}</div>
                  <h2 className="mt-1 text-[16px] font-semibold text-chalk">{lead?.name ?? 'They'} is ready</h2>
                </div>
              )}
            </div>
            <Button variant="primary" className="mt-4 w-full shrink-0" onClick={join}>
              {inRoom ? 'Go in' : 'Join call'}
            </Button>
          </div>
        </div>
      )}

      {phase === 'failed' && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 p-4">
          <div className="glass w-full max-w-sm rounded-2xl p-5 text-center">
            <h2 className="text-[15px] font-semibold text-chalk">The session dropped</h2>
            <p className="mt-2 text-[12.5px] text-mist">
              {live.state.failure === 'mic_denied'
                ? 'Allow the microphone to talk.'
                : 'They could not be reached. Try again in a moment.'}
            </p>
            <Button variant="ghost" className="mt-4 w-full" onClick={leave}>
              Back
            </Button>
          </div>
        </div>
      )}

      {phase === 'ended' && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 p-4">
          <div className="glass w-full max-w-sm rounded-2xl p-5 text-center">
            <div className="eyebrow">{inRoom ? 'Meeting over' : 'Call ended'}</div>
            <h2 className="mt-1 text-[16px] font-semibold text-chalk">{after}</h2>
            <p className="mt-2 text-[12.5px] text-mist">
              Your conversation is being analysed. Feedback will be ready shortly.
            </p>
            <Button variant="primary" className="mt-4 w-full" onClick={() => openFeedback(sessionId)}>
              View feedback
            </Button>
            <Button variant="ghost" className="mt-2 w-full" onClick={leave}>
              Back to the city
            </Button>
          </div>
        </div>
      )}

      {/* The controls: a meeting app's online; in person just the microphone, the camera and a way out. */}
      <div
        className={cn(
          'flex items-center justify-center gap-3 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+0.9rem)] pt-3',
          inRoom && 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent pt-10',
        )}
      >
        <Control label={muted ? 'Unmute' : 'Mute'} active={!muted} onClick={toggleMute}>
          {muted ? <IconMicOff width={18} height={18} /> : <IconMic width={18} height={18} />}
        </Control>
        <Control
          label={cameraOn ? 'Stop video' : 'Start video'}
          active={cameraOn}
          onClick={() => setCameraOn((on) => !on)}
        >
          {cameraOn ? <IconVideo width={18} height={18} /> : <IconVideoOff width={18} height={18} />}
        </Control>
        <Control label={liveActive ? (inRoom ? 'End meeting' : 'End call') : 'Leave'} danger onClick={hangUp}>
          <IconPhoneOff width={18} height={18} />
        </Control>
      </div>
    </div>
  )
}
