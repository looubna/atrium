import { type ComponentType, type SVGProps, useMemo } from 'react'
import { Html } from '@react-three/drei'
import { type Camera, type Object3D, Vector3 } from 'three'
import {
  IconBriefcase,
  IconBus,
  IconCoffee,
  IconDining,
  IconGraduationCap,
  IconShoppingBag,
  IconTarget,
  IconTree,
} from '@/components/ui/Icon'
import type { Location, PlaceIcon } from '@/data/types'
import { useCompactViewport } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'

type Emphasis = 'idle' | 'hover' | 'selected' | 'muted'

interface Props {
  location: Location
  emphasis: Emphasis
}

/** Label navy from the TalkVille render. */
const PILL = '#0f1a3a'

const GLYPHS: Record<PlaceIcon, ComponentType<SVGProps<SVGSVGElement>>> = {
  briefcase: IconBriefcase,
  graduation: IconGraduationCap,
  dining: IconDining,
  tree: IconTree,
  coffee: IconCoffee,
  shopping: IconShoppingBag,
  target: IconTarget,
  bus: IconBus,
}

/**
 * The floating name over a location, styled after the TalkVille map art: a
 * navy pill with a coloured icon circle holding the place's glyph, and a
 * pointer down to the building. DOM rather than 3D text: crisp at every zoom,
 * no font loading, and free to style with the rest of the HUD.
 */
export function LocationMarker({ location, emphasis }: Props) {
  const compact = useCompactViewport()
  const color = location.markerColor
  const Glyph = GLYPHS[location.icon]
  const active = emphasis === 'hover' || emphasis === 'selected'

  // On a portrait phone the art's framing puts downtown and the mall at the
  // very edges, so a label would be sliced in half. Keep every pill fully on
  // screen instead — like a map pin — using a rough width from its text.
  const scratch = useMemo(() => new Vector3(), [])
  const halfWidth = location.name.length * (compact ? 3.3 : 3.9) + (compact ? 22 : 30)
  const calculatePosition = (el: Object3D, camera: Camera, size: { width: number; height: number }) => {
    scratch.setFromMatrixPosition(el.matrixWorld).project(camera)
    const x = ((scratch.x + 1) * size.width) / 2
    const y = ((1 - scratch.y) * size.height) / 2
    const edge = halfWidth + 8
    return [Math.min(size.width - edge, Math.max(edge, x)), y]
  }

  return (
    <Html
      position={[0, location.labelHeight, 0]}
      calculatePosition={calculatePosition}
      center
      zIndexRange={[40, 0]}
      style={{ pointerEvents: 'none' }}
      wrapperClass="pointer-events-none"
    >
      <div
        className={cn(
          'flex -translate-y-1/2 flex-col items-center',
          'transition-all duration-300 ease-[var(--ease-out-expo)]',
          emphasis === 'muted' && 'scale-90 opacity-0',
          active && 'scale-110',
        )}
      >
        <div
          className={cn(
            'flex items-center whitespace-nowrap rounded-full font-semibold tracking-tight text-white',
            'shadow-lg shadow-black/40 transition-shadow duration-300',
            compact ? 'gap-1.5 py-1 pl-1 pr-2.5 text-[11px]' : 'gap-2 py-1 pl-1 pr-3.5 text-[13px]',
            active && 'ring-1 ring-white/35',
          )}
          style={{ background: PILL }}
        >
          <span
            className={cn(
              'grid shrink-0 place-items-center rounded-full text-white ring-2 ring-white/15',
              compact ? 'size-5' : 'size-7',
            )}
            style={{ background: color, boxShadow: `0 0 10px ${color}99` }}
          >
            <Glyph
              width={compact ? 12 : 16}
              height={compact ? 12 : 16}
              strokeWidth={2.2}
            />
          </span>
          {location.name}
        </div>
        {/* Pointer down to the building */}
        <div
          className="-mt-px size-0 border-x-[5px] border-t-[6px] border-x-transparent"
          style={{ borderTopColor: PILL }}
        />
      </div>
    </Html>
  )
}
