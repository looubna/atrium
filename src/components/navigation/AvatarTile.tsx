import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { AvatarRenderer } from '@/platform/avatar/types'

/**
 * The interviewer's face in the call grid.
 *
 * While the stream connects there is nothing to show, so the tile keeps the name
 * card visible rather than a black rectangle. If the provider fails at any point
 * the caller drops back to the ordinary tile mid-call.
 */
export function AvatarTile({
  renderer,
  name,
  role,
  speaking,
  compact,
  onLive,
  onFailed,
  onEnded,
  variant = 'tile',
  shown = true,
}: {
  renderer: AvatarRenderer
  name: string
  role: string
  speaking?: boolean
  /** A small tile beside a shared screen: first name only. */
  compact?: boolean
  /** The face is streaming: from now on its track is the interviewer's voice. */
  onLive: (renderer: AvatarRenderer) => void
  onFailed: () => void
  /** The provider ended a face that was on screen (a session cap, credit, network). Defaults to onFailed. */
  onEnded?: () => void
  /**
   * `closeup`: the whole screen, no frame or name (the meeting room cuts to whoever speaks).
   * The face stays mounted and streaming either way; only `shown` changes on a cut.
   */
  variant?: 'tile' | 'closeup'
  shown?: boolean
}) {
  const video = useRef<HTMLVideoElement | null>(null)
  const [live, setLive] = useState(false)

  useEffect(() => {
    const element = video.current
    if (!element) return
    let mounted = true
    // The provider can end a face mid-call (out of credit, network): drop back at once.
    const unsubscribe = renderer.onEnded?.(() => mounted && (onEnded ?? onFailed)())
    void renderer
      .attach(element)
      .then(() => {
        if (!mounted) return
        onLive(renderer)
        // Shown once frames actually play, never as a black box.
        if (element.readyState >= 2 && element.videoWidth > 0) setLive(true)
      })
      .catch(() => mounted && onFailed())
    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [renderer, onLive, onFailed, onEnded])

  if (variant === 'closeup') {
    return (
      <div
        aria-hidden={!shown}
        className={cn(
          'absolute inset-0 bg-black transition-opacity duration-[250ms] ease-out',
          shown && live ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <video
          ref={video}
          playsInline
          autoPlay
          onPlaying={(e) => e.currentTarget.videoWidth > 0 && setLive(true)}
          onResize={(e) => e.currentTarget.videoWidth > 0 && !e.currentTarget.paused && setLive(true)}
          className="size-full object-cover"
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1a2440] to-[#0e1628] ring-1 transition-shadow',
        speaking ? 'ring-2 ring-jade-400/80' : 'ring-white/8',
      )}
    >
      <video
        ref={video}
        playsInline
        autoPlay
        onPlaying={(e) => e.currentTarget.videoWidth > 0 && setLive(true)}
        onResize={(e) => e.currentTarget.videoWidth > 0 && !e.currentTarget.paused && setLive(true)}
        className={cn('size-full object-cover transition-opacity', live ? 'opacity-100' : 'opacity-0')}
      />
      {!live && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-3 px-3 text-center">
            <div className="flex gap-1.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 animate-pulse rounded-full bg-mist" style={{ animationDelay: `${i * 200}ms` }} />
              ))}
            </div>
            {!compact && <div className="text-[12.5px] text-mist">Waiting for {name} to join…</div>}
          </div>
        </div>
      )}
      {live && compact && (
        <div className="absolute inset-x-1.5 bottom-1.5 truncate rounded-md bg-black/45 px-1.5 py-0.5 text-[9.5px] font-medium text-chalk">
          {name.split(' ')[0]}
        </div>
      )}
      {live && !compact && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
          <div className="text-[12.5px] font-semibold text-chalk">{name}</div>
          <div className="text-[11px] text-mist">{role}</div>
        </div>
      )}
    </div>
  )
}
