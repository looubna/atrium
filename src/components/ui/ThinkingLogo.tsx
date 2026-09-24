import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The Atrium mark *is* the loading indicator (§brand).
 *
 * No spinner, no dots, no bar: the hexagon lights up along its own edge and
 * fills from the floor as the AI works, and the core breathes while it thinks.
 * The percentage next to it is part of the same object — one brand gesture that
 * means "the model is working on your answer".
 *
 * Progress comes from one of two places:
 *   - `progress` (0..1) when the caller genuinely knows how far along it is,
 *     e.g. a pipeline reporting stages;
 *   - nothing, in which case the curve eases towards 92% and waits there. An
 *     unknown-length model call has no honest percentage, so it never claims
 *     100% until `done` says the answer is actually in hand.
 *
 * Everything animates by writing to the DOM inside one rAF loop rather than by
 * re-rendering, because this sits over a live three.js canvas and a per-frame
 * React render would be felt.
 */

const HEX = 'M12 3 21 8v8l-9 5-9-5V8z'
/** Fallback for the hexagon's perimeter when getTotalLength is unavailable (jsdom). */
const HEX_LENGTH = 57.19
const TOP = 3
const BOTTOM = 21

export function ThinkingLogo({
  progress,
  done = false,
  label = 'AI is thinking',
  doneLabel = 'Ready',
  size = 44,
  layout = 'row',
  expected = 14,
  onComplete,
  turning = false,
  className,
}: {
  /** 0..1 when the real progress is known. Omit to self-pace. */
  progress?: number | null
  /** The work has finished: run to 100%, confirm, then call `onComplete`. */
  done?: boolean
  label?: string
  doneLabel?: string
  /** Edge length of the mark in px. */
  size?: number
  layout?: 'row' | 'stack'
  /** Roughly how many seconds the work takes, for the self-paced curve. */
  expected?: number
  /** Fires once the completion flourish has played — cue the response. */
  onComplete?: () => void
  /** The mark also turns slowly while it works: for waits long enough that stillness reads as stuck. */
  turning?: boolean
  className?: string
}) {
  const uid = useId().replace(/:/g, '')
  const edgeId = `${uid}-edge`
  const fillId = `${uid}-fill`
  const clipId = `${uid}-clip`

  const svg = useRef<SVGSVGElement>(null)
  const lit = useRef<SVGPathElement>(null)
  const node = useRef<SVGCircleElement>(null)
  const rise = useRef<SVGRectElement>(null)
  const core = useRef<SVGCircleElement>(null)
  const percent = useRef<HTMLSpanElement>(null)

  // The loop reads live props without restarting when they change.
  const live = useRef({ progress, done, expected })
  live.current = { progress, done, expected }

  const [finished, setFinished] = useState(false)
  const settled = useRef(false)

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const length = lit.current?.getTotalLength?.() || HEX_LENGTH
    let shown = 0
    let last = performance.now()
    const started = last
    let frame = 0

    const draw = (value: number) => {
      const p = value < 0 ? 0 : value > 1 ? 1 : value

      if (lit.current) {
        lit.current.style.strokeDasharray = `${length}`
        lit.current.style.strokeDashoffset = `${length * (1 - p)}`
      }
      if (rise.current) {
        const h = (BOTTOM - TOP) * p
        rise.current.setAttribute('y', `${BOTTOM - h}`)
        rise.current.setAttribute('height', `${h}`)
      }
      if (core.current) {
        core.current.style.opacity = `${0.55 + 0.45 * p}`
        core.current.style.filter = `drop-shadow(0 0 ${2 + 5 * p}px rgb(95 227 168 / ${0.3 + 0.5 * p}))`
      }
      // The lit edge ends in a bright node, so the eye has one thing to follow.
      if (node.current && lit.current?.getPointAtLength) {
        const at = lit.current.getPointAtLength(length * p)
        node.current.setAttribute('cx', `${at.x}`)
        node.current.setAttribute('cy', `${at.y}`)
        node.current.style.opacity = p > 0.008 && p < 0.999 ? '1' : '0'
      }
      if (svg.current) svg.current.style.opacity = `${0.62 + 0.38 * p}`

      if (percent.current) {
        // It may not sit on 100% while there is still work to do.
        const shownPercent = live.current.done ? Math.round(p * 100) : Math.min(99, Math.floor(p * 100))
        const next = `${shownPercent}%`
        if (percent.current.textContent !== next) percent.current.textContent = next
      }
    }

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      const { progress: given, done: complete, expected: span } = live.current
      let target: number
      if (complete) {
        target = 1
      } else if (given !== null && given !== undefined) {
        target = given
      } else {
        // Asymptotic: fast at first, then patient. It never reaches 92%.
        const t = (now - started) / 1000
        target = 0.92 * (1 - Math.exp(-t / Math.max(1, span / 2.3)))
      }
      // Progress is a promise; it is never allowed to walk backwards.
      if (target < shown) target = shown

      shown += (target - shown) * (1 - Math.exp(-dt * (complete ? 9 : 5)))
      if (complete && 1 - shown < 0.004) shown = 1
      draw(shown)

      if (shown >= 1 && !settled.current) {
        settled.current = true
        setFinished(true)
        window.setTimeout(() => onComplete?.(), reduced ? 0 : 460)
        return
      }
      frame = requestAnimationFrame(tick)
    }

    if (reduced) {
      // Still counts and still fills — just without the easing chase.
      const step = () => {
        const { progress: given, done: complete } = live.current
        const target = complete ? 1 : (given ?? 0.9)
        shown = Math.max(shown, target)
        draw(shown)
        if (shown >= 1 && !settled.current) {
          settled.current = true
          setFinished(true)
          onComplete?.()
          return
        }
        frame = window.setTimeout(step, 120) as unknown as number
      }
      step()
      return () => window.clearTimeout(frame)
    }

    draw(0)
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // The loop owns its own lifetime; props reach it through `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={finished ? doneLabel : label}
      className={cn(
        'flex select-none',
        layout === 'row' ? 'items-center gap-3' : 'flex-col items-center gap-2.5',
        className,
      )}
    >
      <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
        {/* The confirmation at 100%: one soft bloom out of the mark, then gone. */}
        {finished && (
          <span
            aria-hidden
            className="anim-think-bloom pointer-events-none absolute inset-0 rounded-[28%] bg-jade-400/18"
          />
        )}
        <svg
          ref={svg}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className={turning && !finished ? 'anim-think-turn' : undefined}
        >
          <defs>
            <linearGradient id={edgeId} x1="12" y1="3" x2="12" y2="21" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="var(--color-jade-400)" />
              <stop offset="1" stopColor="var(--color-jade-600)" />
            </linearGradient>
            <linearGradient id={fillId} x1="12" y1="21" x2="12" y2="3" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="var(--color-jade-400)" stopOpacity="0.30" />
              <stop offset="1" stopColor="var(--color-jade-400)" stopOpacity="0" />
            </linearGradient>
            <clipPath id={clipId}>
              <path d={HEX} />
            </clipPath>
          </defs>

          {/* Light rising inside the mark — the logo filling, not a bar. */}
          <g clipPath={`url(#${clipId})`}>
            <rect ref={rise} x="0" y={BOTTOM} width="24" height="0" fill={`url(#${fillId})`} />
          </g>

          {/* The mark in its resting state, always legible underneath. */}
          <path d={HEX} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" className="text-white/12" />

          {/* The same edge, lit as far as the work has got. */}
          <path
            ref={lit}
            d={HEX}
            stroke={`url(#${edgeId})`}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ strokeDasharray: HEX_LENGTH, strokeDashoffset: HEX_LENGTH }}
          />
          <circle ref={node} r="0.9" cx="12" cy="3" fill="var(--color-jade-400)" style={{ opacity: 0 }} />

          {/* The core: it breathes while the model is thinking, steadies when done. */}
          <circle
            ref={core}
            cx="12"
            cy="12"
            r="2.6"
            fill="var(--color-jade-400)"
            className={finished ? '' : 'anim-think-core'}
            style={{ opacity: 0.55 }}
          />
        </svg>
      </span>

      <span
        className={cn(
          'flex items-baseline gap-1.5 whitespace-nowrap',
          layout === 'stack' && 'justify-center',
        )}
      >
        <span
          className={cn(
            'text-[12.5px] font-medium tracking-tight transition-colors duration-500',
            finished ? 'text-jade-400' : 'text-mist',
          )}
        >
          {finished ? doneLabel : `${label}…`}
        </span>
        <span
          ref={percent}
          className={cn(
            'text-[12.5px] font-semibold tabular-nums transition-opacity duration-500',
            finished ? 'text-jade-400' : 'text-chalk',
          )}
        >
          0%
        </span>
      </span>
    </div>
  )
}
