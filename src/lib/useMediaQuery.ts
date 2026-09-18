import { useEffect, useState } from 'react'

/** Subscribe to a media query. Returns false during SSR / before hydration. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(query).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/**
 * True on touch-primary devices. Drives wording ("tap" vs "click") and lets the
 * HUD drop hover-only affordances that can never fire on a phone.
 */
export const useCoarsePointer = () => useMediaQuery('(pointer: coarse)')

/**
 * True when the viewport is too small in EITHER axis for full-length labels.
 * Landscape phones are wide enough to pass a width breakpoint while being far
 * too short to carry the same amount of chrome.
 */
export const useCompactViewport = () =>
  useMediaQuery('(max-width: 639px), (max-height: 560px)')
