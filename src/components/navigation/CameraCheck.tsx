import { useEffect, useRef, useState } from 'react'
import type { Framing } from '@/platform/media/faceMetrics'

/** Voice level (0-1, as the live call reports it) that counts as the user talking. */
const TALKING_LEVEL = 0.12
/** Talking this long is "the user has started": a cough or a click is not. */
const TALKING_HOLD_MS = 600

const FIX: Record<Framing, string> = {
  no_face: "We can't see you. Move into the camera's view.",
  too_close: 'Sit back a little: head, shoulders and hands in the frame.',
  step_back: 'Step back: your whole body in the frame.',
}

/**
 * In person, the user's own camera for the first moments only: a small mirrored picture so they can
 * check they are in the frame the way the room needs (head, shoulders and hands when sitting; the
 * whole body when standing), with what to fix. It says "good" only once the camera has actually
 * seen that, and it goes the moment the user starts talking, for good: in a room, nobody watches
 * themselves while they talk. (Video calls show the user's own tile for the whole call instead.)
 */
export function CameraCheck({ stream, framing, standing, micLevel }: {
  stream: MediaStream | null
  /** A problem, 'ok' once seen in frame, or null while it is not known yet. */
  framing: Framing | 'ok' | null
  standing: boolean
  micLevel: number
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [done, setDone] = useState(false)
  const talkingSince = useRef<number | null>(null)

  useEffect(() => {
    const element = video.current
    if (!element || !stream || element.srcObject === stream) return
    element.srcObject = stream
    element.play().catch(() => {})
  }, [stream, done])

  useEffect(() => {
    if (done) return
    if (micLevel < TALKING_LEVEL) {
      talkingSince.current = null
      return
    }
    const now = performance.now()
    talkingSince.current ??= now
    if (now - talkingSince.current >= TALKING_HOLD_MS) {
      setDone(true)
      return
    }
    // Still talking but no new level arrives (it is only reported when it changes): check again.
    const id = window.setTimeout(() => {
      if (talkingSince.current !== null) setDone(true)
    }, TALKING_HOLD_MS)
    return () => window.clearTimeout(id)
  }, [micLevel, done])

  if (done || !stream) return null
  const message =
    framing === 'ok'
      ? standing ? 'Good: your whole body is in frame.' : 'Good: you are in frame.'
      : framing === null
        ? standing ? 'Checking: stand back so your whole body shows.' : 'Checking: head, shoulders and hands in the frame.'
        : FIX[framing]
  return (
    <div className="anim-fade pointer-events-none absolute bottom-[calc(env(safe-area-inset-bottom,0px)+6rem)] right-3 z-30 flex w-[min(34vw,180px)] flex-col gap-1.5 sm:right-5">
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-white/20 bg-black shadow-lg">
        <video ref={video} autoPlay muted playsInline className="size-full -scale-x-100 object-cover" />
      </div>
      <div
        className={`rounded-lg px-2 py-1.5 text-center text-[11px] leading-snug backdrop-blur-sm ${
          framing === 'ok' ? 'bg-jade-500/85 text-ink-900' : framing === null ? 'bg-black/75 text-mist' : 'bg-black/75 text-[#fde68a]'
        }`}
      >
        {message}
      </div>
    </div>
  )
}
