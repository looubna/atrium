import { useEffect, useState } from 'react'

/** Messages waved away, by room: they stay away for the rest of the visit, even if the room redraws. */
const dismissedHints = new Set<string>()

/**
 * Asks an upright phone to turn sideways, in rooms whose view is better sideways: a wide shot of
 * several people (the panel at its table, investors, an audience, the networking hall), where
 * upright the screen keeps only the middle of the shot, and calls with several people, whose
 * tiles are bigger side by side. Shown only in portrait, gone the moment the phone turns, and once waved
 * away it stays away for the rest of the visit.
 */
export function RotateHint({ who = 'everyone' }: { who?: string }) {
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth)
  const [dismissed, setDismissed] = useState(() => dismissedHints.has(who))
  useEffect(() => {
    const on = () => setPortrait(window.innerHeight > window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  if (!portrait || dismissed) return null
  return (
    <div role="status" className="anim-fade absolute inset-0 z-40 flex items-center justify-center bg-black/55 px-6 backdrop-blur-[2px]">
      <div className="flex max-w-xs flex-col items-center gap-3 rounded-2xl border border-white/15 bg-black/75 px-5 py-5 text-center">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-chalk" aria-hidden>
          <rect x="7" y="2.5" width="10" height="17" rx="2" />
          <path d="M3.5 14.5a8.5 8.5 0 0 0 7 7.2" />
          <path d="M8.6 20.2l1.9 1.5-1.4 2" />
        </svg>
        <div className="text-[14px] font-semibold text-chalk">Turn your phone sideways</div>
        <div className="text-[12.5px] leading-snug text-mist">{`Upright, the screen is too narrow to show ${who}. Sideways, you see them all.`}</div>
        <button
          type="button"
          onClick={() => {
            dismissedHints.add(who)
            setDismissed(true)
          }}
          className="mt-1 h-9 rounded-full border border-white/15 px-4 text-[12px] text-mist hover:bg-white/10"
        >
          Stay upright
        </button>
      </div>
    </div>
  )
}
