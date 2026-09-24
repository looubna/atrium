import { useEffect, useRef, useState, type ReactNode } from 'react'

/** The hall footage is 1920x1080 and drawn `object-cover`; everything here is in its pixels. */
const FRAME = { w: 1920, h: 1080 }

/**
 * The lit display of the laptop on the user's own lectern, corner by corner (top-left, top-right,
 * bottom-right, bottom-left), measured at 4x zoom on `landscape_calm.jpg` and pulled 2px inward so
 * the page never spills onto the bezel. The camera is locked off, so it holds for every frame of
 * the take and of the lip-synced stream.
 */
const SCREEN: [number, number][] = [
  [72, 682],
  [665, 636],
  [713, 920],
  [89, 1011],
]

/** The page drawn on that display, before it is bent onto it. 16:10, like the laptop. */
const PAGE = { w: 640, h: 400 }

/**
 * The CSS `matrix3d` that maps a `w`x`h` box onto the quad `q` (TL, TR, BR, BL): the projective
 * transform from the unit square, scaled down to the box.
 */
function onto(q: [number, number][], w: number, h: number): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3
  const den = dx1 * dy2 - dx2 * dy1
  const g = (dx3 * dy2 - dx2 * dy3) / den
  const k = (dx1 * dy3 - dx3 * dy1) / den
  const a = x1 - x0 + g * x1, b = x3 - x0 + k * x3
  const d = y1 - y0 + g * y1, e = y3 - y0 + k * y3
  return `matrix3d(${[a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, x0, y0, 0, 1].join(',')})`
}

/**
 * Content shown on the laptop at the user's lectern, so what is being argued sits in the room
 * rather than floating over it. Tracks the footage's `object-cover` framing as the window resizes.
 */
export function LecternLaptop({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const element = box.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const scale = size ? Math.max(size.w / FRAME.w, size.h / FRAME.h) : 0
  return (
    <div ref={box} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden={!size}>
      {size && (
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: FRAME.w,
            height: FRAME.h,
            transform: `translate(${(size.w - FRAME.w * scale) / 2}px, ${(size.h - FRAME.h * scale) / 2}px) scale(${scale})`,
          }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left overflow-hidden"
            style={{ width: PAGE.w, height: PAGE.h, transform: onto(SCREEN, PAGE.w, PAGE.h) }}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  )
}
