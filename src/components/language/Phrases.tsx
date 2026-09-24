import { useState } from 'react'
import type { LanguageInfo } from '@/data/language'
import { cn } from '@/lib/utils'
import { getPhrases, saveCard, type Phrase } from '@/modules/language/api'
import { Button } from '../ui/Button'
import { IconCheck } from '../ui/Icon'
import { IconPlus, IconSpeaker } from './icons'
import { ScreenHeader, Spinner, problem, speak } from './shared'

/** Save to the vocab coach, once; the button says when it is done. */
export function SaveButton({ phrase, className, compact }: {
  phrase: Phrase
  className?: string
  /** Icon only, for inside a phrase chip. */
  compact?: boolean
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const save = () => {
    setState('saving')
    saveCard(phrase)
      .then(() => setState('saved'))
      .catch(() => setState('failed'))
  }
  return (
    <button
      type="button"
      onClick={save}
      disabled={state === 'saving' || state === 'saved'}
      aria-label={state === 'saved' ? 'Saved to your words' : `Save ${phrase.term} to your words`}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-lg text-[11.5px] font-medium transition-colors',
        compact
          ? cn('size-7 justify-center hover:bg-white/8', state === 'failed' ? 'text-[#fca5a5]' : 'text-jade-400')
          : cn(
              'h-8 border px-2.5',
              state === 'saved'
                ? 'border-jade-400/40 bg-jade-500/12 text-jade-400'
                : state === 'failed'
                  ? 'border-[#e5484d]/40 text-[#fca5a5]'
                  : 'border-white/10 bg-white/[0.04] text-mist hover:text-chalk',
            ),
        className,
      )}
    >
      {state === 'saved' ? <IconCheck width={14} height={14} /> : <IconPlus width={14} height={14} aria-hidden />}
      {!compact && (state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : state === 'failed' ? 'Retry' : 'Save')}
    </button>
  )
}

/** A word or phrase: hear it, read what it means and an example, keep it. */
export function PhraseRow({ phrase, target }: { phrase: Phrase; target: LanguageInfo }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.03] py-3 pl-3.5 pr-3">
      <button
        type="button"
        onClick={() => speak(phrase.term, target.speech)}
        aria-label={`Hear ${phrase.term}`}
        className="grid size-[38px] shrink-0 place-items-center rounded-xl bg-jade-500/12 text-jade-400 transition-colors hover:bg-jade-500/20"
      >
        <IconSpeaker width={17} height={17} aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold leading-snug text-chalk">{phrase.term}</div>
        {phrase.translation && <div className="text-[12.5px] text-jade-400">{phrase.translation}</div>}
        {phrase.example && <div className="mt-1 text-[12px] italic leading-relaxed text-mist">“{phrase.example}”</div>}
      </div>
      <SaveButton phrase={phrase} />
    </div>
  )
}

const TOPICS = ['My day', 'Food & drinks', 'Travel', 'Work', 'Family', 'Shopping', 'Feelings', 'Weather']

/**
 * "Learn words and phrases about…": a list for any topic, at the learner's level, each one to hear
 * and keep. The quickest way to grow the vocab coach between conversations.
 */
export function WordLists({ target, onBack }: { target: LanguageInfo; onBack: () => void }) {
  const [topic, setTopic] = useState('')
  const [shown, setShown] = useState('')
  const [items, setItems] = useState<Phrase[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = (t: string) => {
    const clean = t.trim()
    if (clean.length < 2) return
    setShown(clean)
    setLoading(true)
    setError(null)
    setItems(null)
    getPhrases(clean)
      .then((r) => setItems(r.items))
      .catch((e) => setError(problem(e)))
      .finally(() => setLoading(false))
  }

  return (
    <div className="pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]">
      <ScreenHeader eyebrow="Word lists" title={`${target.name} words for…`} onBack={onBack} />
      <div className="grid gap-4 px-4 sm:px-6">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            load(topic)
          }}
        >
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Any topic: my job, a trip to Madrid…"
            maxLength={120}
            className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-[14px] text-chalk placeholder:text-faint focus:border-jade-400/50 focus:outline-none"
          />
          <Button variant="primary" type="submit" className="h-11" disabled={loading || topic.trim().length < 2}>
            Go
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {TOPICS.map((t) => (
            <button
              key={t}
              type="button"
              disabled={loading}
              onClick={() => {
                setTopic(t)
                load(t)
              }}
              className={cn(
                'h-9 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors',
                shown === t ? 'border-jade-400/40 bg-jade-500/12 text-jade-400' : 'border-white/10 bg-white/[0.03] text-mist hover:text-chalk',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {loading && <Spinner label={`Finding ${target.name} words for “${shown}”…`} />}
        {error && <p className="text-[13px] text-[#fca5a5]">{error}</p>}
        {items && (
          <section className="grid gap-2">
            <h2 className="text-[15px] font-semibold text-chalk">{shown}</h2>
            {items.length === 0 ? (
              <p className="text-[13px] text-mist">Nothing came back. Try another topic.</p>
            ) : (
              items.map((p) => <PhraseRow key={p.term} phrase={p} target={target} />)
            )}
          </section>
        )}
        {!items && !loading && !error && (
          <p className="text-[13px] leading-relaxed text-mist">
            Pick a topic or type your own. You get the words and phrases people actually say, at your level. Save the
            ones you want; they go to your vocab coach.
          </p>
        )}
      </div>
    </div>
  )
}
