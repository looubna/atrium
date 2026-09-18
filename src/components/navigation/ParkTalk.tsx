import { useEffect, useRef, useState } from 'react'
import { EMOTIONAL_SCENARIOS, type EmotionalPartner } from '@/data/practice'
import { clock, useCountdown } from '@/lib/useCountdown'
import { cn } from '@/lib/utils'
import { useVoiceActivity } from '@/lib/useVoiceActivity'
import { useAppStore } from '@/state/useAppStore'
import { IconArrowLeft, IconMic, IconMicOff } from '../ui/Icon'

/** Footage per person and orientation: `<partner>_<land|port>` with .jpg, .mp4 (listening loop) and _hi.mp4 (greeting). */
const PARK_MEDIA_BASE = '/video/park'
/** How long the greeting takes to dissolve into the listening loop. */
const GREETING_FADE_MS = 500

/**
 * The photos are 3:2 (sideways) and 2:3 (upright), but the generated video is 16:9 or 9:16
 * with the photo centred between black bands. Width : height of each.
 */
const PHOTO_ASPECT = { land: 3 / 2, port: 2 / 3 }
const VIDEO_ASPECT = { land: 16 / 9, port: 9 / 16 }

function useViewport() {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight })
  const [size, setSize] = useState(read)
  useEffect(() => {
    const on = () => setSize(read())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

type Box = { left: number; top: number; width: number; height: number }

/**
 * Where the photo and the videos go so the photo covers the screen and each video's
 * picture lands exactly on it, its black bands pushed off-screen.
 */
function layout(vw: number, vh: number, landscape: boolean): { photo: Box; video: Box } {
  const photoAspect = landscape ? PHOTO_ASPECT.land : PHOTO_ASPECT.port
  const videoAspect = landscape ? VIDEO_ASPECT.land : VIDEO_ASPECT.port
  const pw = Math.max(vw, vh * photoAspect)
  const ph = pw / photoAspect
  const photo = { left: (vw - pw) / 2, top: (vh - ph) / 2, width: pw, height: ph }
  // The photo sits inside the video frame touching two sides ("contain"); the frame extends past the other two.
  const wide = videoAspect > photoAspect
  const width = wide ? ph * videoAspect : pw
  const height = wide ? ph : pw / videoAspect
  const video = { left: photo.left + (pw - width) / 2, top: photo.top + (ph - height) / 2, width, height }
  return { photo, video }
}

/**
 * The park's emotional conversation: the person the user chose sits facing them on a
 * bench, greets them out loud once, then listens. Only a slim bar sits over the footage,
 * low on the screen, so the face stays clear.
 */
export function ParkTalk() {
  const view = useAppStore((s) => s.view)
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  const leave = useAppStore((s) => s.leaveDrill)
  const mine = session && session.locationId === selectedId && session.emotional ? session : null

  if (view !== 'talk' || !mine?.emotional) return null
  const scenario = EMOTIONAL_SCENARIOS.find((c) => c.id === mine.emotional!.scenario)
  return <Conversation partner={mine.emotional.partner} topic={scenario?.label ?? ''} minutes={mine.minutes} onLeave={leave} />
}

function Conversation({ partner, topic, minutes, onLeave }: {
  partner: EmotionalPartner
  topic: string
  minutes: number
  onLeave: () => void
}) {
  const viewport = useViewport()
  const landscape = viewport.w > viewport.h
  const base = `${PARK_MEDIA_BASE}/${partner}_${landscape ? 'land' : 'port'}`
  const boxes = layout(viewport.w, viewport.h, landscape)
  const timer = useCountdown(minutes * 60)
  const voice = useVoiceActivity(true)

  // The conversation clock starts on arrival.
  useEffect(() => {
    timer.toggle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="anim-fade absolute inset-0 z-[45] overflow-hidden bg-black" role="region" aria-label="Park conversation">
      <Footage base={base} photo={boxes.photo} video={boxes.video} />

      <div
        className="pointer-events-auto absolute inset-x-0 z-10 mx-auto flex w-fit max-w-[94vw] items-center gap-2 rounded-full py-1 pl-3 pr-1 glass hud-inset"
        style={{ bottom: '1.25rem' }}
      >
        {voice.denied ? (
          <IconMicOff width={14} height={14} className="shrink-0 text-[#fca5a5]" aria-label="Microphone unavailable" />
        ) : (
          <IconMic width={14} height={14} className={cn('shrink-0', voice.speaking ? 'text-jade-400' : 'text-faint')} aria-label={voice.speaking ? 'You are speaking' : 'Listening'} />
        )}
        <span className={cn('text-[12px] tabular-nums', timer.done ? 'text-[#fca5a5]' : 'text-mist')} aria-label="Time left">
          {clock(timer.left)}
        </span>
        <span className="min-w-0 truncate text-[13px] font-medium text-chalk">{topic}</span>
        <button
          type="button"
          onClick={onLeave}
          className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-white/8 px-2.5 text-[12px] font-medium text-mist hover:text-chalk"
        >
          <IconArrowLeft width={13} height={13} />
          Leave
        </button>
      </div>
    </div>
  )
}

/**
 * Greeting once, with sound, dissolving into the silent listening loop underneath. Missing
 * clips fall back: no greeting → straight to listening; no loop → the still photo.
 */
function Footage({ base, photo, video }: { base: string; photo: Box; video: Box }) {
  const [phase, setPhase] = useState<'greeting' | 'fading' | 'listening'>('greeting')
  const [loopMissing, setLoopMissing] = useState(false)
  const hi = useRef<HTMLVideoElement>(null)
  const listen = useRef<HTMLVideoElement>(null)
  // Turning the phone swaps footage; the greeting is not repeated.
  const greeted = useRef(false)

  useEffect(() => {
    setLoopMissing(false)
    setPhase(greeted.current ? 'listening' : 'greeting')
  }, [base])

  useEffect(() => {
    const v = hi.current
    if (!v || phase !== 'greeting') return
    // Starting the conversation was a tap, which allows sound; where the browser refuses, greet silently.
    v.muted = false
    v.play().catch(() => {
      v.muted = true
      v.play().catch(() => setPhase('listening'))
    })
  }, [phase, base])

  useEffect(() => {
    if (phase === 'greeting') return
    greeted.current = true
    listen.current?.play().catch(() => {})
    if (phase !== 'fading') return
    const id = window.setTimeout(() => setPhase('listening'), GREETING_FADE_MS)
    return () => window.clearTimeout(id)
  }, [phase])

  // Positioned boxes, not object-cover: see layout(). No poster on the videos — it would be
  // drawn over the whole frame, bands included; the photo underneath shows until they play.
  const fill = 'absolute max-w-none'
  return (
    <>
      <img src={`${base}.jpg`} alt="" className={fill} style={photo} draggable={false} />
      {!loopMissing && (
        <video
          key={`${base}-listen`}
          ref={listen}
          src={`${base}.mp4`}
          loop
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          onError={() => setLoopMissing(true)}
          className={fill}
          style={video}
        />
      )}
      {phase !== 'listening' && (
        <video
          key={`${base}-hi`}
          ref={hi}
          src={`${base}_hi.mp4`}
          playsInline
          disablePictureInPicture
          onEnded={() => setPhase('fading')}
          onError={() => setPhase('listening')}
          className={cn(fill, 'transition-opacity', phase === 'fading' ? 'opacity-0' : 'opacity-100')}
          style={{ ...video, transitionDuration: `${GREETING_FADE_MS}ms` }}
        />
      )}
    </>
  )
}
