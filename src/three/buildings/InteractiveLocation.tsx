import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, MathUtils, Mesh } from 'three'
import { CATEGORIES } from '@/data/locations'
import type { Location } from '@/data/types'
import { useAppStore } from '@/state/useAppStore'
import { LocationMarker } from './LocationMarker'

/** Just above the highest paving in the city model (plazas top out at 0.14). */
const AFFORDANCE_Y = 0.2

interface Props {
  location: Location
}

/**
 * Turns a building in the city model into a *place*: a hit proxy, the hover
 * and selection affordances, and its label. The building itself is part of
 * the TalkVille model, so nothing here draws architecture.
 *
 * All pointer hits go through a single invisible box rather than the model's
 * geometry. That keeps hover stable (no flicker crossing between meshes) and
 * keeps raycasting to one target per location.
 */
export function InteractiveLocation({ location }: Props) {
  const accent = CATEGORIES[location.category].color

  const hovered = useAppStore((s) => s.hoveredId === location.id)
  const selected = useAppStore((s) => s.selectedId === location.id)
  const view = useAppStore((s) => s.view)
  const anySelected = useAppStore((s) => s.selectedId !== null)

  const interactive = view === 'city' || view === 'location'

  const ring = useRef<Mesh>(null)
  const pulse = useRef<Mesh>(null)
  const glow = useRef<Mesh>(null)

  const [fw, fd] = location.footprint
  const radius = Math.hypot(fw, fd) / 2 + 1.5
  const hitHeight = location.labelHeight * 0.92

  useEffect(() => {
    if (!hovered || !interactive) return
    document.body.style.cursor = 'pointer'
    return () => {
      document.body.style.cursor = ''
    }
  }, [hovered, interactive])

  useFrame((state, dt) => {
    const target = selected ? 1 : hovered ? 0.72 : 0
    if (ring.current) {
      const m = ring.current.material as { opacity: number }
      m.opacity = MathUtils.damp(m.opacity, target, 10, dt)
      const s = MathUtils.damp(ring.current.scale.x, 0.94 + target * 0.06, 10, dt)
      ring.current.scale.set(s, s, 1)
    }
    if (glow.current) {
      const m = glow.current.material as { opacity: number }
      m.opacity = MathUtils.damp(m.opacity, target * 0.3, 10, dt)
    }
    if (pulse.current) {
      const m = pulse.current.material as { opacity: number }
      if (selected) {
        // 2.4s expanding ring — the only looping animation in the city.
        const t = (state.clock.elapsedTime % 2.4) / 2.4
        const s = 0.9 + t * 0.7
        pulse.current.scale.set(s, s, 1)
        m.opacity = (1 - t) * 0.5
      } else {
        m.opacity = MathUtils.damp(m.opacity, 0, 12, dt)
      }
    }
  })

  const store = useAppStore
  const onOver = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation()
      store.getState().hover(location.id)
    },
    [location.id, store],
  )
  const onOut = useCallback(() => {
    const s = store.getState()
    if (s.hoveredId === location.id) s.hover(null)
  }, [location.id, store])
  const onClick = useCallback(
    (e: { stopPropagation: () => void }) => {
      e.stopPropagation()
      store.getState().select(location.id)
    },
    [location.id, store],
  )

  const emphasis = useMemo(() => {
    if (view === 'entering' || view === 'exiting') return selected ? 'selected' : 'muted'
    if (selected) return 'selected'
    if (hovered) return 'hover'
    // Once something is picked, quiet everything else down.
    return anySelected ? 'muted' : 'idle'
  }, [anySelected, hovered, selected, view])

  return (
    <group position={location.position} rotation={[0, location.rotation ?? 0, 0]}>
      {/* --- Ground affordances, all flat on the pavement --- */}
      <group position={[0, AFFORDANCE_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh ref={glow}>
          <circleGeometry args={[radius * 1.15, 40]} />
          <meshBasicMaterial
            color={accent}
            transparent
            opacity={0}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh ref={ring}>
          <ringGeometry args={[radius, radius + 0.55, 56]} />
          <meshBasicMaterial color={accent} transparent opacity={0} depthWrite={false} />
        </mesh>
        <mesh ref={pulse}>
          <ringGeometry args={[radius + 0.7, radius + 1.1, 56]} />
          <meshBasicMaterial color={accent} transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>

      {/* --- Single hit proxy --- */}
      <mesh
        visible={false}
        position={[0, hitHeight / 2, 0]}
        onPointerOver={interactive ? onOver : undefined}
        onPointerOut={interactive ? onOut : undefined}
        onClick={interactive ? onClick : undefined}
      >
        <boxGeometry args={[fw + 2, hitHeight, fd + 2]} />
      </mesh>

      <LocationMarker location={location} emphasis={emphasis} />
    </group>
  )
}
