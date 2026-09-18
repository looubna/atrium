import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { getExampleAudio, resolveMediaUrl, type ExampleVoice } from '../api'

type State = 'idle' | 'loading' | 'playing' | 'error'

/** Plays a moment's improved answer, read aloud in a confident interview voice. */
export function ExampleAudioButton({
  sessionId,
  eventId,
  voice = 'warm',
  onPlay,
}: {
  sessionId: string
  eventId: string
  voice?: ExampleVoice
  /** Called when playback starts, e.g. to pause the recording. */
  onPlay?: () => void
}) {
  const [state, setState] = useState<State>('idle')
  const audio = useRef<HTMLAudioElement | null>(null)
  const url = useRef<string | null>(null)

  useEffect(() => {
    url.current = null
    return () => audio.current?.pause()
  }, [voice])

  const toggle = async () => {
    if (state === 'playing') {
      audio.current?.pause()
      setState('idle')
      return
    }
    try {
      if (!url.current) {
        setState('loading')
        url.current = resolveMediaUrl((await getExampleAudio(sessionId, eventId, voice)).url)
      }
      const player = audio.current ?? new Audio()
      audio.current = player
      player.src = url.current
      player.onended = () => setState('idle')
      onPlay?.()
      await player.play()
      setState('playing')
    } catch {
      url.current = null
      setState('error')
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={state === 'loading'}
      aria-label={state === 'playing' ? 'Stop the example answer' : 'Hear a better answer'}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-2 rounded-full pl-1 pr-3 text-[12px] font-semibold transition-all active:scale-[0.97]',
        state === 'error' ? 'bg-[#f87171]/15 text-[#fca5a5]' : 'bg-jade-500 text-ink-900 hover:bg-jade-400',
      )}
    >
      <span className="grid size-6 place-items-center rounded-full bg-black/15">
        {state === 'loading' ? (
          <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : state === 'playing' ? (
          <span className="flex h-3 items-end gap-[2px]" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-[3px] animate-pulse rounded-sm bg-current"
                style={{ height: `${6 + ((i * 5) % 7)}px`, animationDelay: `${i * 120}ms` }}
              />
            ))}
          </span>
        ) : (
          <svg viewBox="0 0 12 12" width={10} height={10} aria-hidden>
            <path d="M3 1.8v8.4L10 6z" fill="currentColor" />
          </svg>
        )}
      </span>
      {state === 'loading' ? 'Preparing…' : state === 'playing' ? 'Playing' : state === 'error' ? 'Try again' : 'Hear it'}
    </button>
  )
}
