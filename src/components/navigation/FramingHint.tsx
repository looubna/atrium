import { useEffect, useRef, useState } from 'react'
import type { Framing } from '@/platform/media/faceMetrics'

/**
 * Tells the candidate, once, when the way they sit or stand in the frame would make the
 * body-language analysis wrong: at the start, while it can still be fixed. Each message shows for a
 * few seconds and then goes, and does not come back in the same session — a warning that stays on
 * screen gets in the way of the session it is about. (The feedback still says what was not seen.)
 */

/** How long a framing message stays on screen. */
export const FRAMING_HINT_MS = 6000
export const FRAMING_TEXT: Record<Framing, string> = {
  no_face: "We can't see your face. Move into the camera's view so eye contact and expression can be measured.",
  too_close:
    'Only your face is in the frame. Sit back so your head, shoulders and hands are all on camera, or your body language cannot be judged accurately.',
  step_back:
    'Step back so your whole body is on camera. For presenting and defending, posture and gestures are part of the analysis, and it is only accurate when you are fully in the frame.',
}

export function FramingHint({ framing }: { framing: Framing | null }) {
  // The message showing now, if any, and the ones already shown in this session.
  const [showing, setShowing] = useState<Framing | null>(null)
  const shown = useRef(new Set<Framing>())
  const timer = useRef<number>()
  useEffect(() => {
    if (!framing || shown.current.has(framing)) return
    shown.current.add(framing)
    setShowing(framing)
    // Its own few seconds, whatever the framing does meanwhile: fixing it does not keep it up.
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setShowing(null), FRAMING_HINT_MS)
  }, [framing])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  if (!showing) return null
  return (
    <div
      role="status"
      className="anim-fade pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+4rem)] z-30 flex justify-center px-4"
    >
      <div className="max-w-md rounded-xl border border-[#fcd34d]/40 bg-black/70 px-3.5 py-2 text-center text-[12px] leading-snug text-[#fde68a] backdrop-blur-sm">
        {FRAMING_TEXT[showing]}
      </div>
    </div>
  )
}
