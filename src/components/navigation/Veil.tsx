import { useAppStore, T } from '@/state/useAppStore'
import { cn } from '@/lib/utils'

/**
 * Covers the moment the city is swapped for an interior. A short hold on a dark
 * screen reads as walking through a door; a visible scene swap reads as a bug.
 */
export function Veil() {
  const veil = useAppStore((s) => s.veil)
  const view = useAppStore((s) => s.view)

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-40 bg-ink-900"
      style={{
        opacity: veil,
        transitionProperty: 'opacity',
        transitionDuration: `${veil > 0 ? T.veilIn : 620}ms`,
        transitionTimingFunction: 'var(--ease-in-out-quart)',
      }}
    >
      <div
        className={cn(
          'absolute inset-0 grid place-items-center transition-opacity duration-300',
          veil > 0.9 ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div className="flex items-center gap-2.5 text-[11px] font-medium tracking-[0.14em] text-faint">
          <span className="size-1.5 animate-pulse rounded-full bg-jade-400" />
          {view === 'exiting' ? 'STEPPING OUTSIDE' : 'ENTERING'}
        </div>
      </div>
    </div>
  )
}
