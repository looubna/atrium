import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  NETWORKING_CLIPS,
  NETWORKING_CLOSEUP_BASE,
  NETWORKING_FACES,
  NETWORKING_FRAME,
  NETWORKING_MEDIA_BASE,
  NETWORKING_PEOPLE,
  type NetworkingPerson,
} from '@/data/networking'
import { NETWORKING_TAGS, type NetworkingTag } from '@/data/practice'
import { cn } from '@/lib/utils'
import { useVoiceActivity } from '@/lib/useVoiceActivity'
import { useInterviewRoom } from '@/modules/interview/live/useInterviewRoom'
import type { LiveFailure } from '@/modules/interview/live/useLiveInterview'
import { createNetworkingSession } from '@/modules/networking/api'
import { useAppStore } from '@/state/useAppStore'
import { IconArrowLeft, IconMic, IconMicOff, IconUser } from '../ui/Icon'
import { AvatarTile } from './AvatarTile'
import { RotateHint } from './RotateHint'

const [FW, FH] = NETWORKING_FRAME
const ASPECT = FW / FH
/** The hall cross-fades to the guest facing you, and back. */
const FADE_MS = 450

/** The session's networking settings, when a networking session is on at this location. */
function useNetworking() {
  return useAppStore((s) => (s.session?.locationId === s.selectedId ? s.session?.networking : undefined))
}

function useBox(ref: React.RefObject<HTMLElement>, mounted: boolean) {
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, mounted])
  return box
}

/** Shuffles the hall's listening loops, never the same one twice in a row. */
function useHallClips() {
  const [available, setAvailable] = useState<string[]>([...NETWORKING_CLIPS])
  const [clip, setClip] = useState<string>(NETWORKING_CLIPS[0])
  const next = useCallback(() => {
    setClip((prev) => {
      const pool = available.filter((c) => c !== prev)
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : prev
    })
  }, [available])
  const broken = useCallback(() => {
    setAvailable((a) => {
      const rest = a.filter((c) => c !== clip)
      if (rest.length) setClip(rest[0])
      return rest
    })
  }, [clip])
  return { clip: available.length ? clip : null, next, broken }
}

/** How each kind of guest is shown: bars for seniority (none for a client), and a colour. */
const LEVELS: Record<NetworkingTag, { bars: number; color: string }> = {
  junior: { bars: 1, color: '#2b7fb8' },
  peer: { bars: 2, color: '#5b5fd6' },
  senior: { bars: 3, color: '#2f8f6b' },
  executive: { bars: 4, color: '#a8651c' },
  client: { bars: 0, color: '#b8436b' },
}

/** Four rising bars, the first `n` filled: seniority at a glance. */
function SeniorityBars({ n, size }: { n: number; size: number }) {
  return (
    <span className="flex shrink-0 items-end" style={{ gap: size * 0.14, height: size }} aria-hidden>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn('rounded-[1px]', i <= n ? 'bg-white' : 'bg-white/30')} style={{ width: size * 0.2, height: (size * (i + 1)) / 5 }} />
      ))}
    </span>
  )
}

function Tag({ person, scale, match, unknown, onOpen, disabled }: {
  person: NetworkingPerson
  scale: number
  match: boolean
  unknown: boolean
  onOpen: () => void
  disabled: boolean
}) {
  const { x, y, w, h } = person.tag
  const k = Math.max(scale, 0.42)
  const level = LEVELS[person.kind]
  const levelLabel = NETWORKING_TAGS.find((t) => t.id === person.kind)?.label ?? ''
  const color = unknown ? '#4b5563' : level.color
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      disabled={disabled}
      aria-label={unknown ? 'Guest, role unknown — walk over' : `${person.role}, ${person.department}, ${levelLabel} — walk over`}
      className={cn(
        'absolute flex -translate-x-1/2 -translate-y-1/2 items-center rounded-lg text-left text-white shadow-lg transition-transform',
        disabled ? 'pointer-events-none' : 'active:scale-95',
        // The kinds of people the user chose to meet stand out with a bright ring.
        match ? 'ring-2 ring-white' : 'ring-1 ring-white/25',
      )}
      tabIndex={disabled ? -1 : undefined}
      style={{
        left: x * scale,
        top: y * scale,
        // A little larger than the tag drawn into some of the footage, whose edges shift slightly.
        minWidth: (w + 24) * scale,
        minHeight: (h + 8) * scale,
        padding: `${4 * k}px ${10 * k}px ${4 * k}px ${8 * k}px`,
        gap: 7 * k,
        // Fully opaque: the garbled text of a drawn tag must not show through.
        background: color,
      }}
    >
      <span className="grid shrink-0 place-items-center rounded-full bg-white/90" style={{ width: 22 * k, height: 22 * k, color }}>
        <IconUser width={14 * k} height={14 * k} />
      </span>
      <span className="leading-tight">
        <span className="block whitespace-nowrap font-semibold" style={{ fontSize: 15 * k }}>
          {unknown ? 'Guest' : person.role}
        </span>
        <span className="block whitespace-nowrap text-white/80" style={{ fontSize: 11.5 * k }}>
          {unknown ? 'Tap to say hello' : person.department}
        </span>
        {!unknown && (
          <span className="mt-[2px] flex items-center whitespace-nowrap font-semibold uppercase tracking-wide text-white" style={{ fontSize: 9.5 * k, gap: 4 * k }}>
            {level.bars > 0 && <SeniorityBars n={level.bars} size={9 * k} />}
            {levelLabel}
          </span>
        )}
      </span>
      {!disabled && <span className="pointer-events-none absolute -inset-1 animate-pulse rounded-xl ring-2 ring-white/30" aria-hidden />}
    </button>
  )
}

/**
 * The guest face to face, listening in a silent loop; the guest greets out loud from the live
 * conversation. A guest filmed for a live face (`NETWORKING_FACES`) is shown in the very clip the
 * face server paints lips on, so when their face joins, it lands exactly over it.
 */
function CloseUp({ person, landscape, shown, faced, onMissing, children }: {
  person: NetworkingPerson
  landscape: boolean
  shown: boolean
  faced: boolean
  onMissing: () => void
  children?: React.ReactNode
}) {
  const base = faced
    ? `${NETWORKING_CLOSEUP_BASE}/${person.id}_face`
    : `${NETWORKING_CLOSEUP_BASE}/${person.id}_${landscape ? 'land' : 'port'}`
  return (
    <div
      aria-label="Conversation close-up"
      className={cn('absolute inset-0 z-20 overflow-hidden bg-black transition-opacity', shown ? 'opacity-100' : 'pointer-events-none opacity-0')}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <video
        key={base}
        src={`${base}.mp4`}
        poster={`${base}.jpg`}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        onError={onMissing}
        // The older footage has a 15px black band on both long edges; scaling up past it hides it.
        className={cn('absolute inset-0 h-full w-full object-cover', !faced && 'scale-[1.025]')}
      />
      {children}
    </div>
  )
}

const FAILURE: Partial<Record<LiveFailure, string>> = {
  mic_denied: 'Allow the microphone to talk.',
  forbidden: 'Accept recording and AI processing in your account first.',
  email_unverified: 'Verify your email address first.',
  quota: "You've used this month's live minutes.",
  conflict: 'Another live session is open.',
}

/**
 * The conversation itself: the guest, played live, with their lip-synced face over the footage
 * when they have one. It starts on arrival; the guest says hello first.
 */
function Conversation({ person, sessionId, faced, leaving, onEnded, onFailed }: {
  person: NetworkingPerson
  sessionId: string
  faced: boolean
  /** The user is walking away: the fade-out is playing and the conversation ends now. */
  leaving: boolean
  /** The guest said goodbye (or the time ran out). */
  onEnded: () => void
  onFailed: (why: string) => void
}) {
  const room = useInterviewRoom({ sessionId, camera: null, module: 'networking', faces: faced })
  const { live, avatar, avatarFailed } = room
  const { start } = live
  const { phase, failure } = live.state
  // A tick later, so a mount that is immediately undone (React's strict mode does exactly that)
  // never begins: a start torn down half-way would hold off the real one until it gave up.
  useEffect(() => {
    const id = window.setTimeout(() => void start(), 0)
    return () => window.clearTimeout(id)
  }, [start])
  // Told once per change of phase, whatever the parent re-renders in between.
  const told = useRef({ onEnded, onFailed })
  told.current = { onEnded, onFailed }
  const first = person.name.split(' ')[0]
  useEffect(() => {
    if (phase === 'ended') told.current.onEnded()
    if (phase === 'failed') told.current.onFailed(FAILURE[failure ?? 'unavailable'] ?? `${first} can't talk right now.`)
  }, [phase, failure, first])
  // Walking away ends the conversation on the server too, so it is recorded and scored. It has to
  // be said while the socket is still open: unmounting tears it down first.
  const { end } = live
  useEffect(() => {
    if (leaving) end()
  }, [leaving, end])

  if (!avatar || avatarFailed) return null
  return (
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
  )
}

/**
 * A single slim row, low on the screen so the guest's face stays clear: the microphone
 * and time talking, who you are with, and a way out. The conversation starts on arrival.
 */
function ConversationBar({ person, unknown, note, onLeave }: {
  person: NetworkingPerson
  unknown: boolean
  /** Why there is no conversation, when there isn't one. */
  note: string | null
  onLeave: () => void
}) {
  const voice = useVoiceActivity(true)
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div
      className="anim-rise pointer-events-auto absolute inset-x-0 z-[36] mx-auto flex w-fit max-w-[94vw] items-center gap-2 rounded-full py-1 pl-3 pr-1 glass hud-inset"
      style={{ bottom: '3.75rem' }}
      onClick={(e) => e.stopPropagation()}
    >
      {voice.denied ? (
        <IconMicOff width={14} height={14} className="shrink-0 text-[#fca5a5]" aria-label="Microphone unavailable" />
      ) : (
        <IconMic width={14} height={14} className={cn('shrink-0', voice.speaking ? 'text-jade-400' : 'text-faint')} aria-label={voice.speaking ? 'You are speaking' : 'Listening'} />
      )}
      <span className="text-[12px] tabular-nums text-mist">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </span>
      <span className="min-w-0 truncate text-[13px] font-medium text-chalk">
        {note ?? (unknown ? 'A guest' : person.name)}
      </span>
      <button
        type="button"
        onClick={onLeave}
        className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-white/8 px-2.5 text-[12px] font-medium text-mist hover:text-chalk"
      >
        <IconArrowLeft width={13} height={13} />
        Walk away
      </button>
    </div>
  )
}

/**
 * The networking reception from the user's eyes: a photoreal hall, guests with
 * name tags. Tapping a tag joins that guest's conversation: the group, face to
 * face, greets the user, and the microphone is on.
 * On a narrow screen the hall can be dragged sideways.
 */
export function NetworkingHall() {
  const view = useAppStore((s) => s.view)
  const zone = useAppStore((s) => s.interiorZone)
  const networking = useNetworking()
  const setSceneCovered = useAppStore((s) => s.setSceneCovered)
  const openFeedback = useAppStore((s) => s.openFeedback)
  // Still up while the building fades out on leaving, so the bare 3D interior never shows.
  const active = (view === 'interior' || view === 'exiting') && zone !== 'door' && Boolean(networking)

  const root = useRef<HTMLDivElement>(null)
  // The hall mounts only while active, so measure again once it does.
  const { w: vw, h: vh } = useBox(root, active)
  const [ready, setReady] = useState(false)
  const [focus, setFocus] = useState<NetworkingPerson | null>(null)
  // The close-up mounts transparent, then fades in; this is true once it is on screen.
  const [close, setClose] = useState(false)
  const [missing, setMissing] = useState<Set<string>>(() => new Set())
  const [pan, setPan] = useState<number | null>(null)
  const drag = useRef<{ x: number; pan: number; moved: boolean } | null>(null)
  const leaving = useRef<number | null>(null)
  // The live conversation with the guest in focus: its session, whether the user is walking away,
  // and why there is none (no network, no AI, no microphone). The last one ended is kept for feedback.
  const [talk, setTalk] = useState<{ guest: string; sessionId: string | null; leaving: boolean; note: string | null } | null>(null)
  const [lastTalk, setLastTalk] = useState<{ name: string; sessionId: string } | null>(null)
  const { clip, next, broken } = useHallClips()

  useEffect(() => {
    setSceneCovered(active && ready)
    return () => setSceneCovered(false)
  }, [active, ready, setSceneCovered])
  useEffect(() => {
    if (!active) {
      setFocus(null)
      setClose(false)
      setTalk(null)
    }
  }, [active])
  useEffect(() => {
    if (!focus) return
    const id = window.setTimeout(() => setClose(true), 30)
    return () => window.clearTimeout(id)
  }, [focus])
  useEffect(() => () => {
    if (leaving.current) window.clearTimeout(leaving.current)
  }, [])

  if (!active) return null

  const landscape = vw > vh
  // Cover the screen with the hall; a portrait phone sees a slice it can drag across.
  const sw = vw && vh ? Math.max(vw, vh * ASPECT) : 0
  const sh = sw / ASPECT
  const scale = sw / FW
  const minPan = vw - sw
  // Start on the tagged guests rather than the empty left edge.
  const centre = Math.min(0, Math.max(minPan, vw / 2 - 1020 * scale))
  const baseX = Math.min(0, Math.max(minPan, pan ?? centre))
  const baseY = (vh - sh) / 2

  const unknown = !networking!.roleVisible
  const wanted = new Set(networking!.tags)
  const closeKey = focus ? `${focus.id}_${landscape ? 'land' : 'port'}` : ''

  // The guest said goodbye: let the last words land, then step back into the hall.
  const walkAwaySoon = () => {
    if (leaving.current) return
    leaving.current = window.setTimeout(() => {
      leaving.current = null
      walkAway()
    }, 1500)
  }

  const walkUp = (p: NetworkingPerson) => {
    setFocus(p)
    setTalk({ guest: p.id, sessionId: null, leaving: false, note: null })
    createNetworkingSession(p.id, !unknown)
      .then(({ id }) => setTalk((t) => (t?.guest === p.id && !t.leaving ? { ...t, sessionId: id } : t)))
      .catch(() =>
        setTalk((t) => (t?.guest === p.id ? { ...t, note: `${p.name.split(' ')[0]} can't talk right now.` } : t)),
      )
  }

  const walkAway = () => {
    // Fade the guest out (the conversation ends meanwhile), then the hall is back.
    setClose(false)
    setTalk((t) => {
      if (t?.sessionId && focus) setLastTalk({ name: unknown ? 'a guest' : focus.name.split(' ')[0], sessionId: t.sessionId })
      return t && { ...t, leaving: true }
    })
    if (leaving.current) window.clearTimeout(leaving.current)
    leaving.current = window.setTimeout(() => {
      leaving.current = null
      setFocus(null)
      setTalk(null)
    }, FADE_MS)
  }

  return (
    <div
      ref={root}
      className={cn('absolute inset-0 z-10 touch-pan-y overflow-hidden bg-ink-900 transition-opacity duration-500', ready ? 'opacity-100' : 'opacity-0')}
      aria-label="Networking hall"
      // Tapping a tag focuses it, and the browser would scroll this clipped box to show it,
      // pushing the hall sideways. The hall is moved by transform only.
      onScroll={(e) => {
        e.currentTarget.scrollLeft = 0
        e.currentTarget.scrollTop = 0
      }}
      onPointerDown={(e) => {
        if (focus || sw <= vw) return
        drag.current = { x: e.clientX, pan: baseX, moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        if (!d.moved && Math.abs(dx) < 6) return
        d.moved = true
        setPan(d.pan + dx)
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
    >
      {/* Upright, the hall is a slice to drag across; sideways it is all on screen. */}
      {!focus && <RotateHint who="the whole hall" />}
      {sw > 0 && (
        <div className="absolute left-0 top-0" style={{ width: sw, height: sh, transform: `translate(${baseX}px, ${baseY}px)` }}>
          <img
            src={`${NETWORKING_MEDIA_BASE}/poster.jpg`}
            alt=""
            draggable={false}
            onLoad={() => setReady(true)}
            className="absolute inset-0 h-full w-full select-none"
          />
          {clip && (
            <video
              key={clip}
              src={`${NETWORKING_MEDIA_BASE}/${clip}.mp4`}
              autoPlay
              muted
              playsInline
              disablePictureInPicture
              onEnded={next}
              onError={broken}
              className="absolute inset-0 h-full w-full"
            />
          )}
          {NETWORKING_PEOPLE.map((p) => (
            <Tag
              key={p.id}
              person={p}
              scale={scale}
              unknown={unknown}
              match={!unknown && wanted.has(p.kind)}
              disabled={Boolean(focus)}
              onOpen={() => {
                if (!drag.current?.moved) walkUp(p)
              }}
            />
          ))}
        </div>
      )}

      {/* Without close-up footage for a guest, the hall stays as the view. */}
      {focus && !missing.has(closeKey) && (
        <CloseUp
          person={focus}
          landscape={landscape}
          shown={close}
          faced={NETWORKING_FACES.has(focus.id)}
          onMissing={() => setMissing((m) => new Set(m).add(closeKey))}
        >
          {talk?.sessionId && talk.guest === focus.id && (
            <Conversation
              key={talk.sessionId}
              person={focus}
              sessionId={talk.sessionId}
              faced={NETWORKING_FACES.has(focus.id)}
              leaving={talk.leaving}
              onEnded={walkAwaySoon}
              onFailed={(note) => setTalk((t) => t && { ...t, note })}
            />
          )}
        </CloseUp>
      )}

      {!focus && ready && (
        <div className="glass pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full px-3 py-1.5 text-[11.5px] text-mist hud-inset">
          {/* Kept to one line on a narrow phone. */}
          {unknown ? 'Tap a guest to say hello' : sw > vw + 2 ? 'Tap a name tag · drag to look around' : 'Tap a name tag to join the conversation'}
        </div>
      )}

      {!focus && ready && lastTalk && (
        <button
          type="button"
          onClick={() => openFeedback(lastTalk.sessionId)}
          className="glass anim-rise absolute inset-x-0 z-[36] mx-auto w-fit max-w-[94vw] rounded-full px-3.5 py-1.5 text-[12px] font-medium text-chalk hud-inset hover:text-white"
          style={{ bottom: '3.75rem' }}
        >
          Feedback on your talk with {lastTalk.name} →
        </button>
      )}

      {focus && (
        <ConversationBar key={focus.id} person={focus} unknown={unknown} note={talk?.note ?? null} onLeave={walkAway} />
      )}
    </div>
  )
}
