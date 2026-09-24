import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * One take of the room, on screen while it is the one running.
 *
 * All of them are mounted from the moment the candidate sits down, because a take fetched at the
 * moment somebody starts talking would show the poster until it arrived — which is exactly the
 * moment it must not. Each starts and ends on the photograph, so whichever is not running is
 * rewound to that frame and the next change lands on the picture already on screen.
 */
export function RoomTake({
  src,
  poster,
  running,
  onMissing,
}: {
  src: string
  poster: string
  running: boolean
  onMissing: (src: string) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const element = video.current
    if (!element) return
    if (!running) {
      element.pause()
      element.currentTime = 0
      return
    }
    // From the top, so the mouths start moving when the voice does rather than wherever the
    // loop happened to be.
    element.currentTime = 0
    // Autoplay can be refused (a muted, inline clip rarely is); the photograph is underneath.
    void element.play().catch(() => {})
  }, [running])
  return (
    <video
      ref={video}
      src={src}
      poster={poster}
      loop
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
      onError={() => onMissing(src)}
      className={cn(
        'pointer-events-none absolute inset-0 size-full object-cover',
        running ? 'opacity-100' : 'opacity-0',
      )}
    />
  )
}
