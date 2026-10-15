import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { storyExampleAudio, type RoundFeedback } from '@/modules/practice/api'
import { IconMic } from '../ui/Icon'

type Model = NonNullable<RoundFeedback['model']>

/**
 * The coach's retelling of the user's own story, the way a storyteller would tell it with this step's
 * technique: the text with its delivery cues marked on the exact words, what changed and why, and the
 * version read aloud, so the user hears the pauses and stresses before trying it themselves.
 */
export function StoryModel({ model, attemptId }: { model: Model; attemptId: string }) {
  const [audio, setAudio] = useState<{ state: 'idle' | 'loading' | 'playing' | 'failed'; voice: 'warm' | 'deep' }>({
    state: 'idle',
    voice: 'warm',
  })
  const player = useRef<HTMLAudioElement | null>(null)
  const urls = useRef<Partial<Record<'warm' | 'deep', string>>>({})
  useEffect(
    () => () => {
      player.current?.pause()
      Object.values(urls.current).forEach((u) => u && URL.revokeObjectURL(u))
    },
    [],
  )

  const play = async (voice: 'warm' | 'deep') => {
    player.current?.pause()
    try {
      let url = urls.current[voice]
      if (!url) {
        setAudio({ state: 'loading', voice })
        url = URL.createObjectURL(await storyExampleAudio(attemptId, voice))
        urls.current[voice] = url
      }
      const element = new Audio(url)
      player.current = element
      element.onended = () => setAudio((a) => ({ ...a, state: 'idle' }))
      setAudio({ state: 'playing', voice })
      await element.play()
    } catch {
      setAudio({ state: 'failed', voice })
    }
  }
  const stop = () => {
    player.current?.pause()
    setAudio((a) => ({ ...a, state: 'idle' }))
  }

  return (
    <section
      aria-label="How a storyteller would tell it"
      className="anim-rise rounded-2xl border border-[#f5d58e]/25 bg-[#f5d58e]/[0.05] px-4 py-3.5"
      style={{ animationDelay: '470ms' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#f5d58e]">How a storyteller would tell it</div>
        <div className="flex items-center gap-1.5">
          {(['warm', 'deep'] as const).map((voice) => {
            const busy = audio.voice === voice && (audio.state === 'loading' || audio.state === 'playing')
            return (
              <button
                key={voice}
                type="button"
                onClick={() => (busy && audio.state === 'playing' ? stop() : void play(voice))}
                disabled={audio.state === 'loading'}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors disabled:opacity-60',
                  busy ? 'bg-[#f5d58e] text-ink-900' : 'bg-white/8 text-chalk hover:bg-white/12',
                )}
              >
                <IconMic width={13} height={13} />
                {audio.voice === voice && audio.state === 'loading'
                  ? 'Getting it…'
                  : audio.voice === voice && audio.state === 'playing'
                    ? 'Stop'
                    : voice === 'warm'
                      ? 'Hear it'
                      : 'Deeper voice'}
              </button>
            )
          })}
        </div>
      </div>

      <p className="mt-2.5 text-[15px] leading-relaxed text-chalk">
        <Marked text={model.text} phrases={model.notes.map((n) => n.phrase)} />
      </p>
      {model.why && <p className="mt-2 text-[12.5px] leading-snug text-mist">{model.why}</p>}

      {model.notes.length > 0 && (
        <>
          <div className="mt-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">How to say it</div>
          <ol className="mt-1.5 flex flex-col gap-1.5">
            {model.notes.map((n, i) => (
              <li key={n.phrase} className="flex gap-2.5 text-[12.5px] leading-snug">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#f5d58e]/20 text-[10.5px] font-semibold text-[#f5d58e]">
                  {i + 1}
                </span>
                <span className="text-mist">
                  <span className="font-medium text-chalk">“{n.phrase}”</span> — {n.cue}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      {audio.state === 'failed' && <p className="mt-2 text-[11.5px] text-faint">The voice isn’t available right now. Read it aloud yourself, following the cues.</p>}
      <p className="mt-3 text-[11.5px] leading-snug text-faint">
        Listen once, then press <span className="text-mist">Same prompt again</span> and tell it your way, using the cues.
      </p>
    </section>
  )
}

/** The retelling with each cued phrase marked and numbered, and "..." shown as a visible pause. */
function Marked({ text, phrases }: { text: string; phrases: string[] }) {
  const parts: ReactNode[] = []
  let rest = text
  let key = 0
  const pause = (s: string) =>
    s.split(/(\.\.\.|…)/).map((bit, i) =>
      bit === '...' || bit === '…' ? (
        <span key={`p${key++}-${i}`} className="mx-0.5 rounded bg-white/10 px-1 text-[11px] text-faint" title="Pause">
          pause
        </span>
      ) : (
        bit
      ),
    )
  while (rest) {
    const hits = phrases
      .map((p, i) => ({ i, at: rest.toLowerCase().indexOf(p.toLowerCase()), len: p.length }))
      .filter((h) => h.at >= 0)
      .sort((a, b) => a.at - b.at)
    const hit = hits[0]
    if (!hit) {
      parts.push(<span key={key++}>{pause(rest)}</span>)
      break
    }
    parts.push(<span key={key++}>{pause(rest.slice(0, hit.at))}</span>)
    parts.push(
      <mark key={key++} className="rounded bg-[#f5d58e]/15 px-0.5 text-chalk underline decoration-[#f5d58e]/60 underline-offset-4">
        {rest.slice(hit.at, hit.at + hit.len)}
        <sup className="ml-0.5 text-[9px] font-semibold text-[#f5d58e]">{hit.i + 1}</sup>
      </mark>,
    )
    rest = rest.slice(hit.at + hit.len)
  }
  return <>{parts}</>
}
