import { useCallback, useEffect, useRef, useState } from 'react'
import { LEADERSHIP_SCENARIOS, type LeadershipBriefing } from '@/data/practice'
import { useCamera } from '@/lib/useCamera'
import { cn } from '@/lib/utils'
import { useInterviewRoom } from '@/modules/interview/live/useInterviewRoom'
import type { AvatarRenderer } from '@/platform/avatar/types'
import { useAppStore } from '@/state/useAppStore'
import { Button } from '../ui/Button'
import { IconMic, IconMicOff, IconPhoneOff, IconVideo, IconVideoOff } from '../ui/Icon'
import { AvatarTile } from './AvatarTile'

/**
 * Leadership practice: a video call, like Zoom, that the user leads with their team.
 *
 * Laura, Marcus and Nadia are on camera with their own live, lip-synced faces; the model plays
 * all three (backend `modules/leadership`), the one who speaks most in its own voice and the
 * others through hand-overs. The user's camera is their own tile. Nothing here is shared with
 * the interview call (`VirtualCall`): it only borrows the live-session plumbing.
 */

type Member = { name: string; role: string; avatar: string }

/**
 * A team call's faces are one stream (`lr_<lead>` on the face server): the three webcams tiled in a
 * 1280x720 frame, lip-synced for whoever is speaking. Where each person sits in it, as the (x, y) of
 * their 640x360 tile; each call tile shows only its own quarter.
 */
const ROOM_TILES: Record<string, [number, number]> = {
  'Laura Bennett': [0, 0],
  'Marcus Hale': [640, 0],
  'Nadia Karim': [0, 360],
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

/** Where the room video goes so that `tile` fills the box: scaled to cover it, centred on that quarter. */
function roomCrop(tile: [number, number], w: number, h: number): React.CSSProperties {
  const k = Math.max(w / 640, h / 360)
  return { width: 1280 * k, height: 720 * k, left: w / 2 - (tile[0] + 320) * k, top: h / 2 - (tile[1] + 180) * k }
}

const COLORS = ['#4a78ff', '#f0508f', '#a766f2']

const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .join('')

/** The leadership call on screen now, if any. */
export function leadershipHere(state: {
  view: string
  session: ReturnType<typeof useAppStore.getState>['session']
  selectedId: string | null
}) {
  const { view, session, selectedId } = state
  if (view !== 'call' || !session || session.locationId !== selectedId) return null
  const leadership = session.leadership
  return leadership?.sessionId ? { session, leadership, sessionId: leadership.sessionId } : null
}

export function LeadershipCall() {
  const view = useAppStore((s) => s.view)
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  const here = leadershipHere({ view, session, selectedId })
  if (!here) return null
  // A new call is a new session: the whole screen is rebuilt rather than reused.
  return (
    <Call
      key={here.sessionId}
      sessionId={here.sessionId}
      team={here.leadership.team ?? []}
      scenario={here.leadership.scenario}
      briefing={here.leadership.briefing}
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

/** A teammate: their live face once it streams, their initials until then (or if it never does). */
function TeammateTile({
  person,
  color,
  renderer,
  speaking,
  onLive,
  onFailed,
  onEnded,
  room,
  roomStream,
  onRoomStream,
}: {
  person: Member
  color: string
  renderer?: AvatarRenderer
  speaking: boolean
  onLive: (renderer: AvatarRenderer) => void
  onFailed: () => void
  onEnded: () => void
  /** On a team call: this person's quarter of the one room stream. */
  room?: [number, number]
  /** The room stream, for a tile that shows it without owning it (muted: the owner has the sound). */
  roomStream?: MediaStream | null
  /** The owner tile hands the stream on once it plays. */
  onRoomStream?: (stream: MediaStream) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const { w, h } = useSize(box)
  const mirror = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (mirror.current && roomStream) mirror.current.srcObject = roomStream
  }, [roomStream])
  const [live, setLive] = useState(false)
  const shown = live || Boolean(roomStream)
  const live_ = useCallback(
    (r: AvatarRenderer) => {
      setLive(true)
      onLive(r)
      const stream = box.current?.querySelector('video')?.srcObject
      if (stream instanceof MediaStream) onRoomStream?.(stream)
    },
    [onLive, onRoomStream],
  )
  const crop = room && w && h ? roomCrop(room, w, h) : undefined
  return (
    <div
      ref={box}
      className={cn(
        'relative min-h-0 overflow-hidden rounded-xl bg-[#1b1f27] transition-shadow duration-200',
        speaking ? 'ring-[3px] ring-jade-400' : 'ring-1 ring-white/10',
      )}
    >
      {!shown && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="grid size-20 place-items-center rounded-full text-[26px] font-semibold text-white" style={{ background: color }}>
            {initials(person.name)}
          </div>
        </div>
      )}
      {roomStream && crop && (
        <video ref={mirror} autoPlay muted playsInline className="pointer-events-none absolute max-w-none" style={crop} />
      )}
      {renderer && (
        // The face tile draws its own name and role; this tile's tag already says both, with who is talking.
        // On a team call it is the whole room, placed so that only this person's quarter shows.
        <div
          className={cn(
            // The face fills its tile (a tall tile on an upright phone too), cropped like the room under it.
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
            onLive={live_}
            onFailed={onFailed}
            onEnded={onEnded}
          />
        </div>
      )}
      <NameTag name={`${person.name} · ${person.role}`} speaking={speaking} />
    </div>
  )
}

/** The user's own tile: their camera, mirrored, or their initials with the camera off. */
function SelfTile({ stream, cameraOn, muted, small }: { stream: MediaStream | null; cameraOn: boolean; muted: boolean; small?: boolean }) {
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
        You (manager)
      </div>
    </div>
  )
}

function Control({ label, danger, active, onClick, children }: {
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
        danger ? 'w-16 bg-[#e5484d] text-white hover:bg-[#d13438]' : active ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-[#e5484d]/90 text-white hover:bg-[#e5484d]',
      )}
    >
      {children}
    </button>
  )
}

/** The manager's pre-read: what happened, who is on the call, and what the meeting is for. */
function Briefing({ briefing }: { briefing: LeadershipBriefing }) {
  return (
    <div className="text-left">
      <div className="eyebrow">Briefing · {briefing.title}</div>
      <p className="mt-1 text-[12px] text-mist">{briefing.company}</p>
      {briefing.situations.map((s, i) => (
        <section key={s.label} className="mt-3">
          <h3 className="text-[13px] font-semibold text-chalk">
            {briefing.situations.length > 1 ? `${i + 1}. ` : ''}
            {s.label}
          </h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-mist">{s.whatHappened}</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-chalk">
            <span className="font-semibold">Your goal: </span>
            {s.yourGoal}
          </p>
        </section>
      ))}
      <section className="mt-3">
        <h3 className="text-[13px] font-semibold text-chalk">On the call</h3>
        <ul className="mt-1 space-y-1.5">
          {briefing.people.map((p) => (
            <li key={p.name} className="text-[12.5px] leading-relaxed text-mist">
              <span className="font-semibold text-chalk">{p.name}</span>, {p.role}. {p.noticed}
            </li>
          ))}
        </ul>
      </section>
      <p className="mt-3 text-[11.5px] text-faint">{briefing.format} The call is recorded for your feedback.</p>
    </div>
  )
}

function Call({ sessionId, team, scenario, briefing }: {
  sessionId: string
  team: Member[]
  scenario?: string
  briefing?: LeadershipBriefing
}) {
  const leave = useAppStore((s) => s.leaveCall)
  const openFeedback = useAppStore((s) => s.openFeedback)
  const setSceneCovered = useAppStore((s) => s.setSceneCovered)
  const [cameraOn, setCameraOn] = useState(true)
  const [muted, setMuted] = useState(false)
  const [joined, setJoined] = useState(false)
  const camera = useCamera(joined && cameraOn)
  const room = useInterviewRoom({ sessionId, camera: camera.stream, module: 'leadership' })
  const { live, liveActive, avatar, avatarFailed } = room
  const { phase, panelSpeaker, interviewerSpeaking, timeLeftMs } = live.state
  const [lead, ...others] = team
  const oneToOne = others.length === 0
  // A team call's faces are one room stream; the lead's tile owns it, the others show it muted.
  const roomFace = Boolean(avatar?.avatar?.startsWith('lr_'))
  const [roomStream, setRoomStream] = useState<MediaStream | null>(null)
  const { leadFaceLive, colleagueLive } = room
  useEffect(() => {
    if (!roomFace || !leadFaceLive || !avatar) return
    // Their turns go through the room face too, named as theirs, so it paints their mouth.
    for (const [name, renderer] of Object.entries(avatar.panel)) colleagueLive(name, renderer)
  }, [roomFace, leadFaceLive, avatar, colleagueLive])
  const title = scenario ? (LEADERSHIP_SCENARIOS.find((s) => s.id === scenario)?.label ?? 'Leadership') : 'Weekly team call'

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

  // Who is talking: a named hand-over is that teammate; any other team voice is the lead.
  const speakingName = panelSpeaker ?? (interviewerSpeaking ? lead?.name : null)
  const leadRenderer = avatar && !avatarFailed ? avatar.renderer : undefined
  const tiles = team.map((person, i) => {
    const renderer = i === 0 ? leadRenderer : roomFace ? undefined : avatar?.panel[person.name]
    return (
      <TeammateTile
        key={person.name}
        person={person}
        color={COLORS[i % COLORS.length]}
        renderer={renderer}
        speaking={speakingName === person.name}
        onLive={i === 0 ? room.setFaceOnScreen : (r) => room.colleagueLive(person.name, r)}
        onFailed={i === 0 ? room.onAvatarFailed : () => room.colleagueFailed(person.name)}
        onEnded={room.onFaceEnded}
        room={roomFace ? ROOM_TILES[person.name] : undefined}
        roomStream={roomFace && i > 0 && !avatarFailed ? roomStream : undefined}
        onRoomStream={i === 0 ? setRoomStream : undefined}
      />
    )
  })
  const left = timeLeftMs !== null ? Math.max(0, Math.round(timeLeftMs / 1000)) : null

  return (
    <div className="anim-fade absolute inset-0 z-[46] flex flex-col bg-[#0f1115]" role="region" aria-label="Leadership call">
      {/* Top bar, as in a meeting app: what the meeting is and how long is left. */}
      <div className="flex items-center justify-between px-4 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] text-[12.5px] text-white/80">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[#e5484d]" aria-hidden />
          <span className="font-medium text-white">{title}</span>
          <span className="hidden text-white/50 sm:inline">· Northwind product team</span>
        </div>
        {left !== null && <span className="tabular-nums">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left</span>}
      </div>

      {/* The gallery. */}
      <div className="relative min-h-0 flex-1 px-3">
        {oneToOne ? (
          <div className="relative size-full">
            <div className="grid size-full">{tiles}</div>
            <div className="absolute bottom-3 right-3">
              <SelfTile stream={camera.stream} cameraOn={cameraOn} muted={muted} small />
            </div>
          </div>
        ) : (
          <div className="relative grid size-full grid-cols-1 gap-2 sm:grid-cols-2 sm:grid-rows-2 [@media(orientation:portrait)]:grid-cols-1 [@media(orientation:portrait)]:grid-rows-3">
            {tiles}
            {/* The user's own camera: the fourth tile, or a small picture-in-picture on an upright phone. */}
            <div className="contents [@media(orientation:portrait)]:hidden">
              <SelfTile stream={camera.stream} cameraOn={cameraOn} muted={muted} />
            </div>
            <div className="absolute bottom-2 right-2 hidden [@media(orientation:portrait)]:block">
              <SelfTile stream={camera.stream} cameraOn={cameraOn} muted={muted} small />
            </div>
          </div>
        )}

        {/* Before joining: the user opens the call, as the manager who called it. */}
        {!joined && (
          <div className="absolute inset-0 grid place-items-center bg-black/55 p-4 backdrop-blur-[2px]">
            <div className="glass flex max-h-[88%] w-full max-w-lg flex-col rounded-2xl p-5">
              <div className="min-h-0 overflow-y-auto pr-1">
                {briefing ? (
                  <Briefing briefing={briefing} />
                ) : (
                  <div className="text-center">
                    <div className="eyebrow">{title}</div>
                    <h2 className="mt-1 text-[16px] font-semibold text-chalk">Your team is waiting</h2>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-mist">
                      You called this meeting — open it when you join. The call is recorded for your feedback.
                    </p>
                  </div>
                )}
              </div>
              <Button variant="primary" className="mt-4 w-full shrink-0" onClick={join}>
                Join call
              </Button>
            </div>
          </div>
        )}

        {phase === 'failed' && (
          <div className="absolute inset-0 grid place-items-center bg-black/55 p-4">
            <div className="glass w-full max-w-sm rounded-2xl p-5 text-center">
              <h2 className="text-[15px] font-semibold text-chalk">The call dropped</h2>
              <p className="mt-2 text-[12.5px] text-mist">
                {live.state.failure === 'mic_denied' ? 'Allow the microphone to talk to your team.' : 'Your team could not be reached. Try again in a moment.'}
              </p>
              <Button variant="ghost" className="mt-4 w-full" onClick={leave}>
                Back
              </Button>
            </div>
          </div>
        )}

        {phase === 'ended' && (
          <div className="absolute inset-0 grid place-items-center bg-black/55 p-4">
            <div className="glass w-full max-w-sm rounded-2xl p-5 text-center">
              <div className="eyebrow">Call ended</div>
              <h2 className="mt-1 text-[16px] font-semibold text-chalk">How did you lead?</h2>
              <p className="mt-2 text-[12.5px] text-mist">Your call is being analysed. Feedback will be ready shortly.</p>
              <Button variant="primary" className="mt-4 w-full" onClick={() => openFeedback(sessionId)}>
                View feedback
              </Button>
              <Button variant="ghost" className="mt-2 w-full" onClick={leave}>
                Back to the city
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* The meeting controls. */}
      <div className="flex items-center justify-center gap-3 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+0.9rem)] pt-3">
        <Control label={muted ? 'Unmute' : 'Mute'} active={!muted} onClick={toggleMute}>
          {muted ? <IconMicOff width={18} height={18} /> : <IconMic width={18} height={18} />}
        </Control>
        <Control label={cameraOn ? 'Stop video' : 'Start video'} active={cameraOn} onClick={() => setCameraOn((on) => !on)}>
          {cameraOn ? <IconVideo width={18} height={18} /> : <IconVideoOff width={18} height={18} />}
        </Control>
        <Control label={liveActive ? 'End call' : 'Leave'} danger onClick={hangUp}>
          <IconPhoneOff width={18} height={18} />
        </Control>
      </div>
    </div>
  )
}
