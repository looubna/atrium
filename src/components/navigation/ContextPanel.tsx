import { useEffect, useState } from 'react'
import { CATEGORIES, CATEGORY_ORDER, getLocation } from '@/data/locations'
import { useCoarsePointer } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { opensOwnScreen, useAppStore } from '@/state/useAppStore'
import { preloadInterior } from '@/three/interiors/registry'
import { Button } from '../ui/Button'
import { IconArrowLeft, IconEnter, IconOrbit, IconPin, IconScroll } from '../ui/Icon'
import { LanguageCenterIntro } from '../language/Intro'
import { PracticePicker } from './PracticePicker'

/** Resting state: how to drive the city, and what the colours mean. */
function Hint() {
  const touch = useCoarsePointer()

  return (
    <div className="glass max-w-sm rounded-2xl p-4 short:p-3">
      <div className="eyebrow">Explore the city</div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-mist">
        Every place is a situation you can practise in.{' '}
        {touch ? 'Tap one' : 'Pick one'} to move in closer.
      </p>

      <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-faint">
        <span className="inline-flex items-center gap-1.5">
          <IconOrbit width={13} height={13} /> {touch ? 'Drag to turn' : 'Drag to orbit'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <IconScroll width={13} height={13} /> {touch ? 'Pinch to zoom' : 'Scroll to zoom'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <IconPin width={13} height={13} /> {touch ? 'Tap a building' : 'Click a building'}
        </span>
      </div>

      {/* The legend is the first thing to go when the viewport is short — the
          city itself has to stay visible. */}
      <div className="mt-3.5 hidden flex-wrap gap-x-3.5 gap-y-1.5 border-t border-white/8 pt-3 sm:flex short:sm:hidden">
        {CATEGORY_ORDER.map((id) => (
          <span key={id} className="inline-flex items-center gap-1.5 text-[11px] text-mist">
            <span
              className="size-1.5 rounded-full"
              style={{ background: CATEGORIES[id].color }}
            />
            {CATEGORIES[id].name}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Hover state: just enough to confirm the building is selectable. */
function HoverCard({ id }: { id: string }) {
  const loc = getLocation(id)
  if (!loc) return null
  const category = CATEGORIES[loc.category]

  return (
    <div className="glass flex items-center gap-3 rounded-2xl py-2.5 pl-3.5 pr-4">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ background: category.color, boxShadow: `0 0 10px ${category.color}` }}
      />
      <div className="leading-tight">
        <div className="text-[13px] font-semibold tracking-tight text-chalk">{loc.name}</div>
        <div className="mt-0.5 text-[11px] text-faint">{category.name}</div>
      </div>
      <span className="ml-2 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-mist">
        Click to focus
      </span>
    </div>
  )
}

/** What the way-in button says, by where the session takes you. */
const ENTER_LABEL: Record<string, string> = {
  talk: 'Start conversation',
  debate: 'Go to the debate',
  exam: 'Go to your exam',
  drill: 'Start drill',
  call: 'Join video call',
}

/** Selected state: the location's identity, what it is for, and the way in. */
function LocationCard({ id }: { id: string }) {
  const loc = getLocation(id)
  const enter = useAppStore((s) => s.enter)
  const goToCity = useAppStore((s) => s.goToCity)
  const visited = useAppStore((s) => s.visited)
  const session = useAppStore((s) => s.session)
  const [setupOpen, setSetupOpen] = useState(false)

  // Warm the interior chunk while the panel is being read.
  useEffect(() => {
    if (loc?.hasInterior) preloadInterior(loc.id)
  }, [loc])

  if (!loc) return null
  const category = CATEGORIES[loc.category]
  // A session with a screen of its own (a drill, the park bench, an oral exam): no interior needed.
  const mine = session?.locationId === loc.id ? session : null
  const ownScreen = opensOwnScreen(mine)
  const destination = mine?.format.destination

  return (
    // Never taller than the screen below the top bar: a long setup (the scholarship preparation)
    // scrolls inside the card instead of running off the top.
    <div className="glass max-h-[calc(100dvh-env(safe-area-inset-top,0px)-6rem)] w-[min(92vw,25rem)] overflow-y-auto overscroll-contain rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span
          className="size-1.5 rounded-full"
          style={{ background: category.color, boxShadow: `0 0 8px ${category.color}` }}
        />
        <span className="eyebrow" style={{ color: category.color }}>
          {category.name}
        </span>
        {visited.includes(loc.id) && (
          <span className="ml-auto rounded-md bg-white/6 px-1.5 py-0.5 text-[10px] font-medium text-faint">
            Visited
          </span>
        )}
      </div>

      <h2 className="mt-2 text-[20px] font-semibold leading-tight tracking-tight text-chalk">
        {loc.name}
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-mist">{loc.tagline}</p>

      {loc.opens === 'language' ? <LanguageCenterIntro /> : <PracticePicker location={loc} onSetupChange={setSetupOpen} />}

      <div className="mt-5 flex items-center gap-2">
        <Button
          variant="primary"
          // These sessions need no interior: each opens its own screen. A building is entered only
          // for a practice, so without one there is nothing to go in to.
          disabled={(!loc.hasInterior && !ownScreen && !loc.opens) || (!mine && !loc.opens && !loc.arrival)}
          onClick={enter}
          // While a setup form is open it has its own Confirm: one green button at a time. City stays.
          className={cn('flex-1', setupOpen && 'hidden')}
          title={loc.hasInterior || ownScreen || loc.opens ? undefined : 'Interior not built yet'}
        >
          <IconEnter width={15} height={15} />
          {loc.opens === 'language' ? 'Open Language Center' : ENTER_LABEL[destination ?? ''] ??
            (!loc.hasInterior ? 'Interior coming soon' : !mine && !loc.arrival ? 'Choose a practice above' : 'Enter')}
        </Button>
        <Button variant="ghost" onClick={goToCity} aria-label="Back to city" className={cn(setupOpen && 'ml-auto')}>
          <IconArrowLeft width={15} height={15} />
          City
        </Button>
      </div>
    </div>
  )
}

/**
 * One slot, bottom left, that changes with what the user is doing. Keeping all
 * contextual UI in a single place is what stops the city being buried in panels.
 */
export function ContextPanel() {
  const view = useAppStore((s) => s.view)
  const selectedId = useAppStore((s) => s.selectedId)
  const hoveredId = useAppStore((s) => s.hoveredId)

  if (
    view === 'interior' ||
    view === 'exiting' ||
    view === 'call' ||
    view === 'drill' ||
    view === 'talk' ||
    view === 'exam' ||
    view === 'debate' ||
    view === 'language'
  )
    return null

  const mode = selectedId && view !== 'city' ? 'selected' : hoveredId ? 'hover' : 'idle'

  return (
    <div
      className={cn(
        'pointer-events-none absolute bottom-0 left-0 z-30 hud-inset',
        view === 'entering' && 'opacity-0 transition-opacity duration-300',
      )}
    >
      <div key={mode + (selectedId ?? hoveredId ?? '')} className="pointer-events-auto anim-rise">
        {mode === 'selected' && selectedId && <LocationCard id={selectedId} />}
        {mode === 'hover' && hoveredId && <HoverCard id={hoveredId} />}
        {mode === 'idle' && <Hint />}
      </div>
    </div>
  )
}
