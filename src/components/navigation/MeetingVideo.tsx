import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  MEETING_CLIPS,
  INTERVIEW_MEDIA_BASE,
  ROOM_MEDIA,
  FORMAT_MEDIA,
  MEETING_VIDEO_EXTENSIONS,
  PRESENTER_SCREENS,
  type MeetingClip,
  type MeetingOrientation,
} from '@/data/meeting'
import type { Posture } from '@/data/practice'
import { quadTransform } from '@/lib/perspective'
import { cn } from '@/lib/utils'
import { isLiveInPerson, useAppStore } from '@/state/useAppStore'

/**
 * The meeting room from the presenter's seat, as a photoreal still and video
 * loops instead of the real-time 3D room.
 *
 * Media lives in `public/video/meeting/<posture>/<orientation>/` (sitting or
 * standing; portrait or landscape), falling back to a shared
 * `public/video/meeting/<orientation>/`: `poster.jpg` plus any of the clips in
 * MEETING_CLIPS. Nothing is required — with no poster this renders nothing and
 * the 3D room shows as before; with a poster but no `idle` clip, the still is
 * shown.
 *
 * Every clip is meant to start and end on the poster frame, so one video
 * element swapping sources over the poster reads as continuous footage.
 */

type Fit = 'cover' | 'contain'

interface MeetingMedia {
  /** The folder the footage came from: which laptop screen it has. */
  folder: string
  poster: string
  fit: Fit
  clips: Partial<Record<MeetingClip, string>>
}

const probed = new Map<string, Promise<boolean>>()

/** Dev and preview servers answer a missing file with index.html, so check the type as well. */
function exists(url: string, kind: 'image' | 'video') {
  let p = probed.get(url)
  if (!p) {
    p = fetch(url, { method: 'HEAD', cache: 'no-store' })
      .then((r) => r.ok && (r.headers.get('content-type') ?? '').startsWith(kind))
      .catch(() => false)
    probed.set(url, p)
  }
  return p
}

async function findClip(folder: string, clip: MeetingClip) {
  for (const ext of MEETING_VIDEO_EXTENSIONS) {
    const url = `${folder}/${clip}.${ext}`
    if (await exists(url, 'video')) return url
  }
  return undefined
}

async function loadSet(folder: string) {
  const poster = (await exists(`${folder}/poster.jpg`, 'image')) ? `${folder}/poster.jpg` : null
  const found = await Promise.all(MEETING_CLIPS.map(async (c) => [c, await findClip(folder, c)] as const))
  const clips: MeetingMedia['clips'] = {}
  for (const [c, url] of found) if (url) clips[c] = url
  return { poster, clips }
}

function useOrientation(): MeetingOrientation {
  const get = () => (window.innerHeight > window.innerWidth ? 'portrait' : 'landscape')
  const [o, setO] = useState<MeetingOrientation>(get)
  useEffect(() => {
    const on = () => setO(get())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return o
}

/** undefined while probing, null when there is nothing to show. */
function useMeetingMedia(enabled: boolean, base: string | undefined, room: 'meeting' | 'theater', orientation: MeetingOrientation, posture: Posture) {
  const [media, setMedia] = useState<MeetingMedia | null | undefined>(undefined)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setMedia(undefined)
    ;(async () => {
      // Each orientation uses only its own footage. A wide shot letterboxed on an
      // upright phone is a thin strip; without a vertical set the 3D room, which
      // frames itself for portrait, shows instead.
      // The presenter's own point of view first (seated at the table, or standing),
      // then footage shared by both postures.
      let result: MeetingMedia | null = null
      // The meeting room has footage per posture; other rooms one set per orientation.
      const folders = !base
        ? []
        : room === 'meeting' && base !== INTERVIEW_MEDIA_BASE
          ? [`${base}/${posture}/${orientation}`, `${base}/${orientation}`]
          : [`${base}/${orientation}`]
      for (const folder of folders) {
        const set = await loadSet(folder)
        if (set.poster) {
          result = { folder, poster: set.poster, fit: 'cover', clips: set.clips }
          break
        }
      }
      if (!cancelled) setMedia(result)
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, base, room, orientation, posture])
  return media
}

const HAND_CLIPS: MeetingClip[] = ['hand_raise', 'hand_wait']

/**
 * Picks what plays next. Questions interrupt the listening loop; a lowered hand
 * finishes its gesture first. Listening clips are shuffled without immediate repeats.
 */
function useClipSequence(clips: MeetingMedia['clips'] | undefined) {
  const handUp = useAppStore((s) => s.raisedHands.length > 0)
  const [clip, setClip] = useState<MeetingClip | null>(null)
  const [nonce, setNonce] = useState(0)
  const broken = useRef(new Set<MeetingClip>())
  const introPlayed = useRef(false)
  const handRef = useRef(handUp)
  handRef.current = handUp

  const has = useCallback((c: MeetingClip) => Boolean(clips?.[c]) && !broken.current.has(c), [clips])

  const next = useCallback(
    (prev: MeetingClip | null): MeetingClip | null => {
      // Arriving: the welcome plays once, before anything else.
      if (prev === null && !introPlayed.current && !handRef.current && has('intro')) {
        introPlayed.current = true
        return 'intro'
      }
      if (handRef.current) {
        if (prev !== 'hand_raise' && prev !== 'hand_wait' && has('hand_raise')) return 'hand_raise'
        if (has('hand_wait')) return 'hand_wait'
      } else if (prev && HAND_CLIPS.includes(prev) && has('hand_lower')) {
        return 'hand_lower'
      }
      // The listening clips are shuffled, never the same one twice in a row, so the room
      // doesn't read as a loop.
      const listening = (['idle', 'listen_1', 'listen_2'] as const).filter(has)
      if (listening.length === 0) return null
      const fresh = listening.filter((c) => c !== prev)
      const pool = fresh.length ? fresh : listening
      return pool[Math.floor(Math.random() * pool.length)]
    },
    [has],
  )

  const advance = useCallback(
    (prev: MeetingClip | null) => {
      const n = next(prev)
      setClip(n)
      setNonce((k) => k + 1)
    },
    [next],
  )

  // Start, and restart whenever the available clips change.
  useEffect(() => {
    broken.current.clear()
    introPlayed.current = false
    advance(null)
  }, [clips, advance])

  // A question arrives or is answered: react now instead of at the end of the loop.
  useEffect(() => {
    setClip((current) => {
      const interrupt = handUp ? current !== 'hand_raise' && current !== 'hand_wait' : current === 'hand_wait'
      if (!interrupt) return current
      setNonce((k) => k + 1)
      return next(current)
    })
  }, [handUp, next])

  const onEnded = useCallback(() => advance(clip), [advance, clip])
  const onError = useCallback(() => {
    if (clip) broken.current.add(clip)
    advance(clip)
  }, [advance, clip])

  return { clip, nonce, onEnded, onError }
}

/**
 * The presenter's laptop in the footage. The generated video may draw anything on
 * that screen, so the still frame always covers the lid; a shared screen is drawn
 * onto the display, following its angle.
 */
/**
 * The presenter's screens in the footage: the lectern laptop and, where the room has
 * one, the projector. The generated video may draw anything on them, so the still
 * frame always covers each; a shared screen or the current slide is drawn onto the
 * display, following its angle.
 */
function PresenterScreen({
  screen,
  poster,
  natural,
  box,
  stream,
  slide,
}: {
  screen: (typeof PRESENTER_SCREENS)[string]
  poster: string
  natural: { w: number; h: number }
  box: { w: number; h: number }
  stream: MediaStream | null
  slide?: string
}) {
  const openSlide = useAppStore((s) => s.setSlideZoom)

  // Where the poster sits with object-cover, and footage pixels → screen pixels.
  const scale = Math.max(box.w / natural.w, box.h / natural.h)
  const dw = natural.w * scale
  const dh = natural.h * scale
  const ox = (box.w - dw) * (screen.focusX ?? 0.5)
  const oy = (box.h - dh) * (screen.focusY ?? 0.5)
  const [fw, fh] = screen.frame
  const local = ([x, y]: [number, number]): [number, number] => [(x * dw) / fw, (y * dh) / fh]

  return (
    <>
      {screen.surfaces.map((surface, i) => {
        const lid = surface.lid.map(local)
        const display = surface.display.map((p) => {
          const [x, y] = local(p)
          return [x + ox, y + oy] as [number, number]
        })
        const [aw, ah] = surface.aspect ?? [16, 10]
        const SW = 1600
        const SH = Math.round((SW * ah) / aw)
        return (
          <div key={i}>
            <img
              src={surface.cover ?? poster}
              alt=""
              aria-hidden
              className="absolute max-w-none"
              style={{ left: ox, top: oy, width: dw, height: dh, clipPath: `polygon(${lid.map(([x, y]) => `${x}px ${y}px`).join(', ')})` }}
            />
            {(stream || slide) && surface.slides !== false && (
              <div
                className={cn('absolute left-0 top-0 overflow-hidden bg-[#0b0d10]', !stream && 'pointer-events-auto cursor-zoom-in')}
                style={{ width: SW, height: SH, transformOrigin: '0 0', transform: quadTransform(SW, SH, display) }}
                onClick={stream ? undefined : () => openSlide(true)}
                role={stream ? undefined : 'button'}
                aria-label={stream ? undefined : i === 0 ? 'Open slide to read' : 'Open slide to read (projector)'}
              >
                {stream ? <StreamVideo stream={stream} /> : <img src={slide} alt="" draggable={false} className="h-full w-full select-none object-contain" />}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

function StreamVideo({ stream }: { stream: MediaStream }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = video.current
    if (!v) return
    v.srcObject = stream
    v.play().catch(() => {})
  }, [stream])
  return <video ref={video} autoPlay muted playsInline className="h-full w-full object-contain" />
}

export function MeetingVideo() {
  const view = useAppStore((s) => s.view)
  const zone = useAppStore((s) => s.interiorZone)
  // Without a presentation set up, show the seated view from the head of the table.
  const posture = useAppStore((s): Posture => (s.session?.locationId === s.selectedId && s.session?.posture) || 'sitting')
  const setSceneCovered = useAppStore((s) => s.setSceneCovered)
  // The real photo and its footage replace the 3D room whenever the meeting room or the
  // auditorium (seen from the lectern) is on screen — presenting or just looking around.
  const selectedId = useAppStore((s) => s.selectedId)
  const room = zone === 'theater' ? 'theater' : 'meeting'
  // An in-person one-to-one interview has its own footage: one interviewer across the table.
  const oneToOne = useAppStore(
    (s) => s.session?.locationId === s.selectedId && s.session?.interview?.mode === 'in-person' && s.session.interview.panel === 'one-to-one',
  )
  // Some sessions have a room of their own instead of the location's usual one.
  const formatId = useAppStore((s) => (s.session?.locationId === s.selectedId ? s.session?.format.id : undefined))
  const formatBase = formatId ? FORMAT_MEDIA[formatId] : undefined
  const base =
    room === 'meeting' && oneToOne
      ? INTERVIEW_MEDIA_BASE
      : room === 'theater' && formatBase
        ? formatBase
        : selectedId
          ? ROOM_MEDIA[selectedId]?.[room]
          : undefined
  // A networking session has its own hall (NetworkingHall) instead of the room footage.
  const networking = useAppStore((s) => s.session?.locationId === s.selectedId && Boolean(s.session?.networking))
  // A live in-person interview films the room its own way (InPersonInterview).
  const liveInPerson = useAppStore((s) => s.session?.locationId === s.selectedId && isLiveInPerson(s.session))
  const active =
    view === 'interior' && (zone === 'meeting' || zone === 'theater') && Boolean(base) && !networking && !liveInPerson

  const orientation = useOrientation()
  const media = useMeetingMedia(active, base, room, orientation, posture)
  const { clip, nonce, onEnded, onError } = useClipSequence(active && media ? media.clips : undefined)

  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [posterReady, setPosterReady] = useState(false)
  const src = clip && media ? media.clips[clip] : undefined
  const screenStream = useAppStore((s) => s.screenStream)
  const slide = useAppStore((s) => (s.deck ? s.deck.slides[s.slideIndex] : undefined))
  const rootRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [active, media])

  const shown = active && Boolean(media) && posterReady

  // The footage covers the whole screen: no point drawing the 3D room under it.
  useEffect(() => {
    setSceneCovered(shown)
    return () => setSceneCovered(false)
  }, [shown, setSceneCovered])

  useEffect(() => {
    setPosterReady(false)
    setNatural(null)
  }, [media?.poster])

  // Load and play each clip; hide the video until its first frame so the poster covers the swap.
  useEffect(() => {
    const v = videoRef.current
    setPlaying(false)
    if (!v || !src) return
    v.src = src
    v.currentTime = 0
    v.play().catch(() => {
      // Autoplay refused (rare, since the video is muted): the poster stays.
    })
  }, [src, nonce])

  if (!active || !media) return null
  // Always fill the screen. The portrait footage is made phone-shaped (narrower
  // than the room photo, people kept whole), so on any phone only a little
  // ceiling or tabletop is trimmed.
  const fitClass = 'object-cover'
  const focus = {
    objectPosition: `${(PRESENTER_SCREENS[media.folder]?.focusX ?? 0.5) * 100}% ${(PRESENTER_SCREENS[media.folder]?.focusY ?? 0.5) * 100}%`,
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        'pointer-events-none absolute inset-0 z-10 overflow-hidden bg-ink-900 transition-opacity duration-500',
        shown ? 'opacity-100' : 'opacity-0',
      )}
      aria-label={selectedId === 'university' ? 'Lecture hall' : room === 'theater' ? 'Auditorium' : base === INTERVIEW_MEDIA_BASE ? 'Interview room' : 'Meeting room'}
      role="img"
    >
      <img
        src={media.poster}
        alt=""
        onLoad={(e) => {
          setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          setPosterReady(true)
        }}
        onError={() => setSceneCovered(false)}
        className={cn('absolute inset-0 h-full w-full', fitClass)}
        style={focus}
      />
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        onPlaying={() => setPlaying(true)}
        onEnded={onEnded}
        onError={onError}
        className={cn('absolute inset-0 h-full w-full', fitClass, playing && src ? 'opacity-100' : 'opacity-0')}
        style={focus}
      />
      {natural && box.w > 0 && PRESENTER_SCREENS[media.folder] && (
        <PresenterScreen screen={PRESENTER_SCREENS[media.folder]} poster={media.poster} natural={natural} box={box} stream={screenStream} slide={slide} />
      )}
    </div>
  )
}
