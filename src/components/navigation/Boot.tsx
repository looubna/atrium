import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * First-paint cover. Holds while the scene compiles its shaders, then lifts
 * into the camera's opening move so the app never shows a blank canvas.
 */
export function Boot() {
  const [gone, setGone] = useState(false)

  useEffect(() => {
    // Two frames: one for React to mount the canvas, one for the first draw.
    const t = setTimeout(() => setGone(true), 620)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      aria-hidden={gone}
      className={cn(
        'pointer-events-none absolute inset-0 z-50 grid place-items-center bg-ink-900',
        'transition-opacity duration-[900ms] ease-[var(--ease-in-out-quart)]',
        gone ? 'opacity-0' : 'opacity-100',
      )}
    >
      <div className="flex flex-col items-center gap-4">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3 21 8v8l-9 5-9-5V8z"
            stroke="var(--color-jade-400)"
            strokeWidth="1.4"
            strokeLinejoin="round"
            opacity="0.9"
          />
          <circle cx="12" cy="12" r="2.6" fill="var(--color-jade-400)" />
        </svg>
        <div className="text-center">
          <div className="text-[15px] font-semibold tracking-tight text-chalk">Atrium</div>
          <div className="mt-1.5 text-[10px] font-medium tracking-[0.16em] text-faint">
            BUILDING THE CITY
          </div>
        </div>
      </div>
    </div>
  )
}
