import { useEffect } from 'react'
import { useAppStore } from '@/state/useAppStore'

/**
 * The university's lecture hall is photo-only: the footage (MeetingVideo) covers the
 * screen, so the 3D scene is just a dark backdrop while it loads.
 */
export default function UniversityInterior() {
  const ready = useAppStore((s) => s.interiorReady)
  useEffect(() => {
    const id = requestAnimationFrame(() => ready())
    return () => cancelAnimationFrame(id)
  }, [ready])
  return <color attach="background" args={['#0b0d10']} />
}
