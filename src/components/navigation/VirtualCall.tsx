import { type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PANEL, interviewerFor } from '@/data/interviewers'
import { MEETING_MEDIA_BASE } from '@/data/meeting'
import { describeSession } from '@/data/practice'
import { useCamera } from '@/lib/useCamera'
import { clock, useCountdown } from '@/lib/useCountdown'
import { cn } from '@/lib/utils'
import { useScreenShare } from '@/lib/useScreenShare'
import { CodePane } from '@/modules/interview/live/CodePane'
import { useInterviewRoom } from '@/modules/interview/live/useInterviewRoom'
import type { AvatarRenderer } from '@/platform/avatar/types'
import { AvatarTile } from './AvatarTile'
import { useAppStore } from '@/state/useAppStore'
import { LiveOverlay, LiveStrip } from './LivePanels'
import { SlideControls } from './SlideControls'
import {
  IconCode,
  IconMic,
  IconMicOff,
  IconPhoneOff,
  IconShareScreen,
  IconVideo,
  IconVideoOff,
} from '../ui/Icon'

/**
 * The meeting-room footage doubles as the colleagues' webcams: each tile frames
 * one person's face in the same looping clip, so they blink and look around.
 * Source pixels in the 1624×968 horizontal clip.
 */
const FOOTAGE = {
  src: `${MEETING_MEDIA_BASE}/landscape/idle.mp4`,
  poster: `${MEETING_MEDIA_BASE}/landscape/poster.jpg`,
  width: 1624,
  height: 968,
}

interface Colleague {
  name: string
  role: string
  color: string
  muted: boolean
  /** Face centre in the footage; without one, the camera is off and initials show. */
  face?: [number, number]
  /** Source pixels across the tile: smaller for someone further from the camera. */
  crop?: number
}

const PEOPLE: Colleague[] = [
  { name: 'Maya Chen', role: 'Head of Product', color: '#4a78ff', muted: false, face: [781, 384], crop: 250 },
  { name: 'Daniel Ortiz', role: 'Team Lead', color: '#f0508f', muted: true, face: [379, 373], crop: 360 },
  { name: 'Priya Nair', role: 'Senior Team Member', color: '#a766f2', muted: true, face: [1220, 385], crop: 360 },
  { name: 'Sam Wright', role: 'Sales', color: '#ec5a45', muted: false },
]

/**
 * A live panel interview: the lead's tile, then the panel. Colleagues on camera join
 * with their own live faces (never stand-in footage); the observer keeps the camera off.
 */
const PANEL_COLORS = ['#f0508f', '#a766f2', '#ec5a45']
const LIVE_PANEL: (Colleague & { onCamera: boolean })[] = PANEL.map((member, i) => ({
  name: member.name,
  role: member.role,
  color: PANEL_COLORS[i % PANEL_COLORS.length],
  muted: member.voice === null,
  onCamera: member.onCamera,
}))

const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('')

function useBoxSize(ref: RefObject<HTMLElement>) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}


/** What the presenter is sharing, shown large on the stage. */
function ScreenStage({ stream }: { stream: MediaStream }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = video.current
    if (!v) return
    v.srcObject = stream
    v.play().catch(() => {})
  }, [stream])
  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl bg-black ring-1 ring-jade-400/40">
      <video ref={video} autoPlay muted playsInline className="absolute inset-0 h-full w-full object-contain" />
      <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 text-[10.5px] font-medium text-chalk">
        <span className="size-1.5 animate-pulse rounded-full bg-[#f87171]" />
        You are sharing your screen
      </div>
    </div>
  )
}

function NameTag({ label, muted, compact }: { label: string; muted?: boolean; compact?: boolean }) {
  return (
    <div className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-1">
      <span
        className={cn(
          'truncate rounded-md bg-black/45 px-1.5 py-0.5 font-medium text-chalk',
          compact ? 'text-[9.5px]' : 'text-[11px]',
        )}
      >
        {label}
      </span>
      {muted && <IconMicOff width={12} height={12} className="shrink-0 text-[#f87171]" />}
    </div>
  )
}

function TileFrame({ children, speaking }: { children: ReactNode; speaking?: boolean }) {
  return (
    <div
      className={cn(
        'relative grid min-h-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#1a2440] to-[#0e1628] ring-1',
        speaking ? 'ring-2 ring-jade-400/80' : 'ring-white/8',
      )}
    >
      {children}
    </div>
  )
}

function InitialsTile({ label, role, color, muted, dimmed, compact, speaking }: {
  label: string
  role?: string
  color: string
  muted?: boolean
  dimmed?: boolean
  compact?: boolean
  speaking?: boolean
}) {
  return (
    <TileFrame speaking={speaking}>
      <span
        className={cn(
          'grid place-items-center rounded-full font-semibold text-white transition-opacity',
          compact ? 'size-9 text-[12px]' : 'size-16 text-[20px]',
          dimmed && 'opacity-40',
        )}
        style={{ background: color }}
      >
        {initials(label)}
      </span>
      {!compact && role && <div className="absolute left-2.5 top-2 truncate text-[10px] text-faint">{role}</div>}
      <NameTag label={label} muted={muted} compact={compact} />
    </TileFrame>
  )
}

/** A colleague on camera: their face, cropped from the looping meeting footage. */
function PersonTile({ person, compact, speaking }: { person: Colleague; compact?: boolean; speaking?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const { w, h } = useBoxSize(box)
  const [failed, setFailed] = useState(false)
  const [cx, cy] = person.face!

  if (failed) {
    return <InitialsTile label={compact ? person.name.split(' ')[0] : person.name} role={person.role} color={person.color} muted={person.muted} compact={compact} />
  }

  // Frame head and shoulders like a webcam: `crop` source pixels across the tile (a
  // little more down a tall tile), but always at least 230 pixels of height so a
  // short tile keeps the whole head; the face a little above centre, never showing
  // past the edge of the footage.
  const crop = person.crop ?? 360
  const k = w && h
    ? Math.max(Math.min(Math.max(w / crop, h / (crop * 1.15)), h / 230), w / FOOTAGE.width, h / FOOTAGE.height)
    : 0
  const vw = FOOTAGE.width * k
  const vh = FOOTAGE.height * k
  const left = Math.min(0, Math.max(w - vw, w / 2 - cx * k))
  const top = Math.min(0, Math.max(h - vh, h * 0.42 - cy * k))

  return (
    <div
      ref={box}
      className={cn(
        'relative min-h-0 overflow-hidden rounded-2xl bg-[#0e1628] transition-shadow duration-200',
        speaking ? 'ring-2 ring-jade-400/80' : 'ring-1 ring-white/8',
      )}
    >
      {k > 0 && (
        <video
          src={FOOTAGE.src}
          poster={FOOTAGE.poster}
          autoPlay
          loop
          muted
          playsInline
          disablePictureInPicture
          onError={() => setFailed(true)}
          className="pointer-events-none absolute max-w-none"
          style={{ width: vw, height: vh, left, top }}
        />
      )}
      {!compact && <div className="absolute left-2.5 top-2 truncate rounded bg-black/30 px-1 text-[10px] text-chalk/80">{person.role}</div>}
      <NameTag label={compact ? person.name.split(' ')[0] : person.name} muted={person.muted} compact={compact} />
    </div>
  )
}

/** The presenter: their own camera when switched on, mirrored like a selfie view. */
function SelfTile({ stream, cameraOn, muted, error, compact }: {
  stream: MediaStream | null
  cameraOn: boolean
  muted: boolean
  error: string | null
  compact?: boolean
}) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = video.current
    if (!v) return
    v.srcObject = stream
    if (stream) v.play().catch(() => {})
  }, [stream])

  if (!cameraOn || !stream) {
    return (
      <TileFrame>
        <span className={cn('grid place-items-center rounded-full bg-jade-400 font-semibold text-ink-900', compact ? 'size-9 text-[12px]' : 'size-16 text-[20px]')}>
          You
        </span>
        {!compact && (
          <div className="absolute left-2.5 top-2 truncate text-[10px] text-faint">
            {error ?? (cameraOn ? 'Starting camera…' : 'Camera off')}
          </div>
        )}
        <NameTag label="You" muted={muted} compact={compact} />
      </TileFrame>
    )
  }

  return (
    <div className="relative min-h-0 overflow-hidden rounded-2xl bg-black ring-2 ring-jade-400/70">
      <video ref={video} autoPlay muted playsInline className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
      <NameTag label="You" muted={muted} compact={compact} />
    </div>
  )
}

function ColleagueTile({ person, compact, speaking }: { person: Colleague; compact?: boolean; speaking?: boolean }) {
  return person.face ? (
    <PersonTile person={person} compact={compact} speaking={speaking} />
  ) : (
    <InitialsTile label={compact ? person.name.split(' ')[0] : person.name} role={person.role} color={person.color} muted={person.muted} compact={compact} />
  )
}

/** A panel colleague's own live face; tells the call when it is on screen or has failed. */
function ColleagueFace({
  person,
  renderer,
  speaking,
  compact,
  onLive,
  onFailed,
  onEnded,
}: {
  person: Colleague
  renderer: AvatarRenderer
  speaking: boolean
  compact?: boolean
  onLive: (name: string, renderer: AvatarRenderer) => void
  onFailed: (name: string) => void
  onEnded: () => void
}) {
  const live = useCallback((r: AvatarRenderer) => onLive(person.name, r), [onLive, person.name])
  const failed = useCallback(() => onFailed(person.name), [onFailed, person.name])
  return (
    <AvatarTile
      renderer={renderer}
      name={person.name}
      role={person.role}
      speaking={speaking}
      compact={compact}
      onLive={live}
      onFailed={failed}
      onEnded={onEnded}
    />
  )
}

/** Like a video call before the other side joins: an empty tile and a quiet status. */
function WaitingTile({ message, compact }: { message: string; compact?: boolean }) {
  return (
    <TileFrame>
      <div className="flex flex-col items-center gap-3 px-3 text-center">
        <div className="flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 animate-pulse rounded-full bg-mist" style={{ animationDelay: `${i * 200}ms` }} />
          ))}
        </div>
        {!compact && <div className="text-[12.5px] text-mist">{message}</div>}
      </div>
    </TileFrame>
  )
}

/** A title slide with a small chart — what the user is presenting. */
function SharedSlide({ slide }: { slide?: string }) {
  if (slide) {
    return (
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl bg-black ring-1 ring-jade-400/40">
        <img src={slide} alt="Current slide" className="absolute inset-0 h-full w-full object-contain" />
        <div className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-0.5 text-[10.5px] font-medium text-chalk">Presenting your slides</div>
      </div>
    )
  }
  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl bg-gradient-to-br from-[#1d3f6e] to-[#10233f] ring-1 ring-white/10">
      <div className="absolute left-3 top-3 rounded-md bg-black/40 px-2 py-0.5 text-[10.5px] font-medium text-chalk">
        Presenting your slides
      </div>
      <div className="absolute inset-0 grid place-items-center p-6">
        <div className="w-full max-w-md">
          <div className="h-3 w-2/3 rounded-full bg-[#f4eee5]" />
          <div className="mt-2 h-2 w-1/3 rounded-full bg-jade-400" />
          <div className="mt-6 flex h-24 items-end gap-2">
            {[40, 65, 50, 85, 72].map((h, i) => (
              <div
                key={i}
                className={cn('flex-1 rounded-t-md', i === 3 ? 'bg-jade-400' : 'bg-white/20')}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** A phone on its side: little height, so shared content goes beside the guests, not above them. */
function useShortLandscape() {
  const get = () => window.innerWidth > window.innerHeight && window.innerHeight < 600
  const [v, setV] = useState(get)
  useEffect(() => {
    const on = () => setV(get())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return v
}

function Control({
  label,
  on = true,
  danger,
  onClick,
  compact,
  children,
}: {
  label: string
  on?: boolean
  danger?: boolean
  onClick: () => void
  /** Icon only, smaller: for a phone on its side. */
  compact?: boolean
  children: ReactNode
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cn('group flex flex-col items-center gap-1', compact ? 'w-11' : 'w-16')}>
      <span
        className={cn(
          'grid place-items-center rounded-full transition-all duration-200 group-active:scale-95',
          compact ? 'size-9' : 'size-12',
          danger
            ? 'bg-[#e5484d] text-white hover:bg-[#f0595e]'
            : on
              ? 'bg-white/10 text-chalk hover:bg-white/15'
              : 'bg-chalk text-ink-900',
        )}
      >
        {children}
      </span>
      {!compact && <span className="text-[10.5px] text-mist">{label}</span>}
    </button>
  )
}

/**
 * A virtual presentation: straight into a video call rather than the building.
 * Colleagues on camera (faces from the meeting footage, one with the camera
 * off), the session timer, and the usual controls. The user's own camera turns
 * on only when they start their video, and their screen is shared only through
 * the browser's picker; the microphone is never touched.
 */
export function VirtualCall() {
  const view = useAppStore((s) => s.view)
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  const leave = useAppStore((s) => s.leaveCall)
  const openFeedback = useAppStore((s) => s.openFeedback)
  const mine = session && session.locationId === selectedId ? session : null
  const timer = useCountdown((mine?.minutes ?? 0) * 60)

  const [muted, setMuted] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const inCall = view === 'call'
  // A live AI interview: the interviewer actually listens and speaks.
  const liveSessionId = inCall ? (mine?.interview?.sessionId ?? null) : null
  const isLive = Boolean(liveSessionId)
  const camera = useCamera(inCall && cameraOn)
  const {
    live,
    liveActive,
    avatar,
    avatarFailed,
    avatarUnavailable,
    setFaceOnScreen,
    onAvatarFailed,
    onFaceEnded,
    colleagueLive,
    colleagueFailed,
    colleagueFace,
    colleagueJoining: joiningByName,
    videoUpload,
  } = useInterviewRoom({ sessionId: liveSessionId, camera: camera.stream })
  const colleagueJoining = (p: Colleague) => joiningByName(p.name)
  // Coding and system-design rounds get the shared editor, open by default.
  const coding = isLive && liveActive && live.state.coding
  const [codeOpen, setCodeOpen] = useState(true)
  const showCode = coding && codeOpen
  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    live.setMuted(next)
  }
  const share = useScreenShare(inCall)
  const sharing = share.mode !== 'off'
  const slide = useAppStore((s) => (s.deck ? s.deck.slides[s.slideIndex] : undefined))
  // Uploaded slides are presented on the stage like a share.
  const presenting = sharing || Boolean(slide) || showCode
  // Who is on the call: an interviewer or a panel; one prospect or client; a panel of
  // investors on camera; everyone for a presentation.
  const panelOnCamera = PEOPLE.filter((p) => p.face)
  const guests = mine?.interview
    ? mine.interview.panel === 'panel'
      ? isLive
        ? [PEOPLE[0], ...LIVE_PANEL]
        : panelOnCamera
      : PEOPLE.slice(0, 1)
    : mine?.negotiation
      ? PEOPLE.slice(0, 1)
      : mine?.meeting
        ? PEOPLE
        : mine?.sales
      ? mine.sales.type === 'investor-pitch'
        ? panelOnCamera
        : PEOPLE.slice(0, 1)
      : PEOPLE
  const shortLandscape = useShortLandscape()
  // Sharing on a phone on its side: the shared screen takes the width, guests shrink to a rail.
  const wideShare = presenting && shortLandscape

  // A blocked or missing camera switches the button back off.
  useEffect(() => {
    if (camera.error) setCameraOn(false)
  }, [camera.error])

  if (!inCall) return null

  const leadSpeaking = live.state.interviewerSpeaking && !live.state.panelSpeaker
  // Small tiles beside a shared screen. In a live interview the lead has no stand-in
  // footage; panel colleagues on camera keep their faces.
  const railTile = (p: Colleague, i: number) =>
    !isLive ? (
      <ColleagueTile key={p.name} person={p} compact />
    ) : i === 0 && avatar && !avatarFailed ? (
      <AvatarTile
        key={p.name}
        renderer={avatar.renderer}
        name={avatar.name}
        role={avatar.role}
        speaking={leadSpeaking}
        compact
        onLive={setFaceOnScreen}
        onFailed={onAvatarFailed}
        onEnded={onFaceEnded}
      />
    ) : i > 0 && colleagueFace(p.name) ? (
      <ColleagueFace
        key={p.name}
        person={p}
        renderer={colleagueFace(p.name)!}
        speaking={live.state.panelSpeaker === p.name}
        compact
        onLive={colleagueLive}
        onFailed={colleagueFailed}
        onEnded={onFaceEnded}
      />
    ) : i > 0 && colleagueJoining(p) ? (
      <WaitingTile key={p.name} message="" compact />
    ) : (
      <InitialsTile
        key={p.name}
        label={(i === 0 ? interviewerFor(mine?.interview?.roundType).name : p.name).split(' ')[0]}
        color={p.color}
        muted={i > 0 && p.muted}
        speaking={i === 0 ? leadSpeaking : live.state.panelSpeaker === p.name}
        compact
      />
    )

  const you = (compact?: boolean) => (
    <SelfTile stream={camera.stream} cameraOn={cameraOn} muted={muted} error={camera.error} compact={compact} />
  )

  return (
    <div className="anim-fade absolute inset-0 z-[45] flex flex-col bg-[#070b14] hud-inset">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={cn('min-w-0 flex-1', wideShare && 'flex items-center gap-3')}>
          <div className="flex shrink-0 items-center gap-2 text-[10.5px] font-semibold tracking-[0.14em] text-jade-400">
            <span className="size-1.5 animate-pulse rounded-full bg-jade-400" />
            {isLive ? 'LIVE · INTERVIEW' : 'LIVE · VIDEO CALL'}
          </div>
          <div className={cn('truncate font-medium text-chalk', wideShare ? 'text-[12px]' : 'mt-0.5 text-[13px]')}>
            {mine ? describeSession(mine) : 'Video call'}
          </div>
        </div>
        {isLive && live.state.timeLeftMs !== null && (
          <div className={cn('glass flex shrink-0 items-center rounded-xl px-3', wideShare ? 'py-1' : 'py-1.5')}>
            <span
              className={cn(
                'font-semibold tabular-nums',
                wideShare ? 'text-[14px]' : 'text-[16px]',
                live.state.timeLeftMs < 60_000 ? 'text-[#fca5a5]' : 'text-chalk',
              )}
            >
              {clock(Math.ceil(live.state.timeLeftMs / 1000))}
            </span>
          </div>
        )}
        {mine && !isLive && (
          <div className={cn('glass flex shrink-0 items-center gap-2 rounded-xl pl-3 pr-1.5', wideShare ? 'py-1' : 'py-1.5')}>
            <span className={cn('font-semibold tabular-nums', wideShare ? 'text-[14px]' : 'text-[16px]', timer.done ? 'text-jade-400' : 'text-chalk')}>
              {timer.done ? 'Done' : clock(timer.left)}
            </span>
            <button
              type="button"
              onClick={timer.toggle}
              className="h-7 rounded-lg bg-jade-500 px-2.5 text-[12px] font-semibold text-ink-900 transition-colors hover:bg-jade-400"
            >
              {timer.label}
            </button>
          </div>
        )}
      </div>

      {/* Stage */}
      <div className={cn('flex min-h-0 flex-1 gap-2', wideShare ? 'mt-2 flex-row' : 'mt-3 flex-col')}>
        {presenting ? (
          <>
            {showCode ? (
              <CodePane live={live} compact={wideShare} />
            ) : share.mode === 'screen' && share.stream ? (
              <ScreenStage stream={share.stream} />
            ) : (
              <SharedSlide slide={slide} />
            )}
            {wideShare ? (
              // A narrow rail of small guest tiles beside the shared screen.
              <div className="grid w-[128px] shrink-0 auto-rows-fr grid-cols-2 gap-1">
                {guests.map((p, i) => railTile(p, i))}
                {you(true)}
              </div>
            ) : (
              // Under the shared screen: a thin strip, so the screen stays large.
              <div
                className="grid h-20 shrink-0 gap-1.5 sm:h-24"
                style={{ gridTemplateColumns: `repeat(${Math.max(guests.length + 1, 4)}, minmax(0, 1fr))` }}
              >
                {guests.map((p, i) => railTile(p, i))}
                {you(true)}
              </div>
            )}
          </>
        ) : (
          <div
            className={cn(
              'grid min-h-0 flex-1 auto-rows-fr gap-2',
              guests.length === 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 sm:grid-cols-3',
            )}
          >
            {guests.map((p, i) => {
              if (!isLive) return <ColleagueTile key={p.name} person={p} />
              // A live interview shows no stand-in footage: the interviewer joins like on a
              // real call, and the rest of a panel keeps their cameras off.
              if (i > 0) {
                const face = colleagueFace(p.name)
                if (face) {
                  return (
                    <ColleagueFace
                      key={p.name}
                      person={p}
                      renderer={face}
                      speaking={live.state.panelSpeaker === p.name}
                      onLive={colleagueLive}
                      onFailed={colleagueFailed}
                      onEnded={onFaceEnded}
                    />
                  )
                }
                return colleagueJoining(p) ? (
                  <WaitingTile key={p.name} message={liveActive ? `Waiting for ${p.name} to join…` : ''} />
                ) : (
                  <InitialsTile
                    key={p.name}
                    label={p.name}
                    role={p.role}
                    color={p.color}
                    muted={p.muted}
                    speaking={live.state.panelSpeaker === p.name}
                  />
                )
              }
              if (avatar && !avatarFailed) {
                return (
                  <AvatarTile
                    key={p.name}
                    renderer={avatar.renderer}
                    name={avatar.name}
                    role={avatar.role}
                    speaking={leadSpeaking}
                    onLive={setFaceOnScreen}
                    onFailed={onAvatarFailed}
                    onEnded={onFaceEnded}
                  />
                )
              }
              if (avatarFailed || avatarUnavailable) {
                return (
                  <InitialsTile
                    key={p.name}
                    label={interviewerFor(mine?.interview?.roundType).name}
                    role={interviewerFor(mine?.interview?.roundType).role}
                    color={p.color}
                    speaking={leadSpeaking}
                  />
                )
              }
              return (
                <WaitingTile
                  key={p.name}
                  message={liveActive ? 'Waiting for the interviewer to join…' : 'Your interviewer joins when you start.'}
                />
              )
            })}
            {you()}
          </div>
        )}
      </div>

      {share.mode !== 'screen' && !showCode && (
        <div className="mt-2 flex justify-center">
          <SlideControls compact={wideShare} />
        </div>
      )}

      {share.notice && (
        <div className="mt-2 text-center text-[11.5px] text-mist" role="status">
          {share.notice}
        </div>
      )}

      {camera.error && (
        <div className="mt-2 text-center text-[11.5px] text-[#fca5a5]" role="status">
          {camera.error} — allow camera access in the browser to show your video.
        </div>
      )}

      {isLive && <LiveStrip live={live} />}

      {/* Controls */}
      <div className={cn('flex shrink-0 items-start justify-center', wideShare ? 'mt-2 gap-2' : 'mt-3 gap-1 sm:gap-3')}>
        <Control label={muted ? 'Unmute' : 'Mute'} on={!muted} compact={wideShare} onClick={toggleMute}>
          {muted ? <IconMicOff width={wideShare ? 17 : 20} height={wideShare ? 17 : 20} /> : <IconMic width={wideShare ? 17 : 20} height={wideShare ? 17 : 20} />}
        </Control>
        <Control label={cameraOn ? 'Stop video' : 'Start video'} on={cameraOn} compact={wideShare} onClick={() => setCameraOn((c) => !c)}>
          {cameraOn ? <IconVideo width={wideShare ? 17 : 20} height={wideShare ? 17 : 20} /> : <IconVideoOff width={wideShare ? 17 : 20} height={wideShare ? 17 : 20} />}
        </Control>
        <Control label={sharing ? 'Stop sharing' : 'Share screen'} on={!sharing} compact={wideShare} onClick={() => (sharing ? share.stop() : void share.start())}>
          <IconShareScreen width={wideShare ? 17 : 20} height={wideShare ? 17 : 20} />
        </Control>
        {coding && (
          <Control
            label={showCode ? 'Hide editor' : 'Editor'}
            on={!showCode}
            compact={wideShare}
            onClick={() => setCodeOpen((open) => !open)}
          >
            <IconCode width={wideShare ? 17 : 20} height={wideShare ? 17 : 20} />
          </Control>
        )}
        <Control
          label={isLive && liveActive ? 'End interview' : 'Leave call'}
          danger
          compact={wideShare}
          onClick={isLive && liveActive ? live.end : leave}
        >
          <IconPhoneOff width={wideShare ? 17 : 20} height={wideShare ? 17 : 20} />
        </Control>
      </div>

      {isLive && liveSessionId && (
        <LiveOverlay
          live={live}
          session={mine}
          videoUpload={videoUpload}
          onLeave={leave}
          onFeedback={() => openFeedback(liveSessionId)}
        />
      )}
    </div>
  )
}
