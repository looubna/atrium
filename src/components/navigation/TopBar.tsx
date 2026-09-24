import { CATEGORIES, getLocation } from '@/data/locations'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/state/useAppStore'
import { Button } from '../ui/Button'
import { IconSettings, IconUser } from '../ui/Icon'

/** Breadcrumb: City › Place › Interior. The only place the app states where you are. */
function Trail() {
  const view = useAppStore((s) => s.view)
  const selectedId = useAppStore((s) => s.selectedId)
  const goToCity = useAppStore((s) => s.goToCity)
  const leaveInterior = useAppStore((s) => s.leaveInterior)

  const loc = getLocation(selectedId)
  const indoors = view === 'interior' || view === 'exiting'

  const crumbs = [
    { label: 'City', onClick: loc ? goToCity : undefined, active: !loc },
    ...(loc
      ? [{ label: loc.name, onClick: indoors ? leaveInterior : undefined, active: !indoors }]
      : []),
    ...(indoors ? [{ label: 'Ground floor', active: true }] : []),
  ]

  return (
    <div className="flex items-center gap-1.5 text-[12px]">
      {crumbs.map((c, i) => (
        <div key={c.label} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-faint/60">/</span>}
          <button
            type="button"
            disabled={!c.onClick}
            onClick={c.onClick}
            className={cn(
              'rounded-md px-1.5 py-0.5 transition-colors duration-200',
              c.active ? 'font-medium text-chalk' : 'text-mist',
              c.onClick && 'hover:bg-white/8 hover:text-chalk',
            )}
          >
            {c.label}
          </button>
        </div>
      ))}
    </div>
  )
}

export function TopBar() {
  const selectedId = useAppStore((s) => s.selectedId)
  const view = useAppStore((s) => s.view)
  const zone = useAppStore((s) => s.interiorZone)
  const session = useAppStore((s) => s.session)
  const setAccountOpen = useAppStore((s) => s.setAccountOpen)
  const loc = getLocation(selectedId)

  // Presenting: the room is the whole screen.
  if (view === 'interior' && zone !== 'door' && session?.locationId === selectedId) return null

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-2 hud-inset">
      <div className="pointer-events-auto flex items-center gap-3">
        <div className="glass flex items-center gap-2.5 rounded-2xl py-2 pl-2.5 pr-3 sm:pr-4">
          {/* Mark */}
          <span className="grid size-8 place-items-center rounded-xl bg-jade-500/15 ring-1 ring-jade-400/30">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3 21 8v8l-9 5-9-5V8z"
                stroke="var(--color-jade-400)"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="2.6" fill="var(--color-jade-400)" />
            </svg>
          </span>
          <div className="leading-none">
            <div className="text-[13px] font-semibold tracking-tight text-chalk">Atrium</div>
            <div className="mt-1 hidden text-[10px] font-medium tracking-[0.12em] text-faint sm:block short:sm:hidden">
              COACHING SIMULATION
            </div>
          </div>
        </div>

        <div className="glass hidden rounded-2xl px-2 py-2.5 sm:block">
          <Trail />
        </div>
      </div>

      <div className="pointer-events-auto flex items-center gap-2">
        {loc && (
          <div className="glass hidden items-center gap-2 rounded-2xl px-3 py-2.5 md:flex">
            <span
              className="size-1.5 rounded-full"
              style={{
                background: CATEGORIES[loc.category].color,
                boxShadow: `0 0 8px ${CATEGORIES[loc.category].color}`,
              }}
            />
            <span className="text-[11px] font-medium text-mist">
              {CATEGORIES[loc.category].name}
            </span>
          </div>
        )}
        {/* Frosted like the brand pill, so they read over a bright sky; 40 px to tap on a phone. */}
        <Button variant="icon" aria-label="Settings" className="glass size-10 text-chalk sm:size-9">
          <IconSettings />
        </Button>
        <Button
          variant="icon"
          aria-label="Account"
          className="glass size-10 text-chalk sm:size-9"
          onClick={() => setAccountOpen(true)}
        >
          <IconUser />
        </Button>
      </div>
    </header>
  )
}
