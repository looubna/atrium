import { useEffect, useRef, useState } from 'react'
import type { LanguageInfo } from '@/data/language'
import { cn } from '@/lib/utils'
import { getVocab, reviewCard, type VocabCard } from '@/modules/language/api'
import { Button } from '../ui/Button'
import { IconMedal } from '../ui/Icon'
import { ACCENT, Card, ScreenHeader, Spinner, problem, speak } from './shared'
import { canListen, listenOnce, similarity, verdictOf, type Verdict } from './Speak'
import { IconCheck, IconMic, IconSpeaker } from './icons'

/** Days until a card in each box comes back: mirrors BOX_DAYS in backend/app/modules/language/store.py. */
const BOX_DAYS = [0, 1, 3, 7, 16, 35]
/** When a card answered with `grade` comes back, in words. */
function comesBack(box: number, grade: 'again' | 'good' | 'easy'): string {
  const days = grade === 'again' ? 1 : BOX_DAYS[Math.min(BOX_DAYS.length - 1, box + (grade === 'easy' ? 2 : 1))]
  if (days <= 1) return 'tomorrow'
  if (days === 7) return 'in a week'
  if (days >= 30) return 'in a month'
  if (days >= 14) return `in ${Math.round(days / 7)} weeks`
  return `in ${days} days`
}

/**
 * The vocab coach: the words met in conversations, as flashcards. Hear it, say it, turn it over,
 * then say how it went: missed cards come back tomorrow, known ones later and later.
 */
export function VocabCoach({ target, onBack }: { target: LanguageInfo; onBack: () => void }) {
  const [all, setAll] = useState(false)
  const [cards, setCards] = useState<VocabCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [at, setAt] = useState(0)
  const [shown, setShown] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  // Saying it out loud: what was heard, and whether it was the word.
  const [said, setSaid] = useState<{ heard: string; verdict: Verdict } | 'listening' | 'failed' | null>(null)
  const listening = useRef<(() => void) | null>(null)
  useEffect(() => () => listening.current?.(), [])

  useEffect(() => {
    let live = true
    setCards(null)
    setError(null)
    setAt(0)
    setShown(false)
    getVocab(all)
      .then((r) => live && setCards(r.cards))
      .catch((e) => live && setError(problem(e)))
    return () => {
      live = false
    }
  }, [all])

  const card = cards?.[at]
  const grade = (g: 'again' | 'good' | 'easy') => {
    if (!card) return
    void reviewCard(card.id, g).catch(() => {})
    setReviewed((n) => n + 1)
    setShown(false)
    setSaid(null)
    setAt((i) => i + 1)
  }

  return (
    <div className="flex min-h-full flex-col pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]">
      <ScreenHeader
        eyebrow="Vocab coach"
        title={all ? 'All your words' : 'Review'}
        onBack={onBack}
        right={
          <Button className="h-10" onClick={() => setAll((a) => !a)}>
            {all ? 'Review' : 'All words'}
          </Button>
        }
      />
      <div className="flex flex-1 flex-col px-4 sm:px-6">
        {error && <p className="text-[13px] text-[#fca5a5]">{error}</p>}
        {!cards && !error && <Spinner label="Loading your words…" />}

        {cards && all && (
          cards.length === 0 ? (
            <Empty />
          ) : (
            <div className="grid gap-2">
              {cards.map((c) => (
                <Card key={c.id} onClick={() => speak(c.term, target.speech)}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px] font-semibold text-chalk">{c.term}</span>
                    <span className="flex gap-0.5" aria-label={`Box ${c.box + 1} of 6`}>
                      {[0, 1, 2, 3, 4, 5].map((b) => (
                        <span key={b} className="size-1.5 rounded-full" style={{ background: b <= c.box ? ACCENT : 'rgba(255,255,255,0.12)' }} />
                      ))}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-mist">{c.translation}</div>
                </Card>
              ))}
            </div>
          )
        )}

        {cards && !all && (
          cards.length === 0 ? (
            <Empty />
          ) : !card ? (
            <div className="grid flex-1 place-items-center text-center">
              <div>
                <IconMedal width={40} height={40} className="mx-auto" style={{ color: ACCENT }} />
                <h2 className="mt-3 text-[18px] font-semibold text-chalk">Review done</h2>
                <p className="mt-1 text-[13px] text-mist">{reviewed} word{reviewed === 1 ? '' : 's'} practised. See you tomorrow.</p>
                <Button variant="primary" className="mt-5 h-11 px-6" onClick={onBack}>Back to the Center</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col">
              <div className="flex items-center gap-2.5">
                <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-white/8">
                  <div className="h-full rounded-full bg-jade-500 transition-[width] duration-500" style={{ width: `${((at + 1) / cards.length) * 100}%` }} />
                </div>
                <span className="text-[12px] font-medium tabular-nums text-faint">{at + 1} of {cards.length}</span>
              </div>
              <button
                type="button"
                onClick={() => setShown(true)}
                className="mt-4 flex min-h-[16rem] flex-1 flex-col items-center justify-center rounded-[28px] border p-6 text-center"
                style={{ borderColor: 'rgba(255,255,255,0.08)', background: `radial-gradient(120% 90% at 50% 0%, ${ACCENT}1f, transparent 60%), rgba(255,255,255,0.03)` }}
              >
                <span className="text-[32px] font-semibold leading-tight tracking-tight text-chalk">{card.term}</span>
                {shown ? (
                  <span className="anim-rise mt-4 block">
                    <span className="block text-[16px] font-medium text-jade-400">{card.translation}</span>
                    {card.example && <span className="mt-3 block text-[13px] italic leading-relaxed text-mist">“{card.example}”</span>}
                  </span>
                ) : (
                  <span className="mt-4 text-[12.5px] text-faint">
                    {canListen() ? 'Tap “Say it” and speak, or tap here to check' : 'Say it out loud, then tap to check'}
                  </span>
                )}
              </button>
              <div className="mt-3 flex gap-2">
                <Button className="h-[46px] flex-1 rounded-2xl" onClick={() => speak(card.term, target.speech)}>
                  <IconSpeaker width={17} height={17} aria-hidden /> Hear it
                </Button>
                {canListen() && (
                  <Button
                    variant="primary"
                    className="h-[46px] flex-1 rounded-2xl"
                    disabled={said === 'listening'}
                    onClick={() => {
                      setSaid('listening')
                      const attempt = listenOnce(target.speech, card.term)
                      listening.current = attempt.cancel
                      attempt.done
                        .then((heard) => {
                          setSaid(heard ? { heard, verdict: verdictOf(similarity(heard, card.term)) } : 'failed')
                          setShown(true)
                        })
                        .catch(() => setSaid('failed'))
                    }}
                  >
                    <IconMic width={17} height={17} aria-hidden /> {said === 'listening' ? 'Listening…' : 'Say it'}
                  </Button>
                )}
              </div>
              {said && said !== 'listening' && (
                <div
                  role="status"
                  className={cn(
                    'anim-rise mt-3 flex items-center justify-center gap-2 rounded-[14px] border px-3.5 py-2.5 text-center text-[13px] font-medium',
                    said === 'failed'
                      ? 'border-white/10 text-mist'
                      : said.verdict === 'right'
                        ? 'border-jade-400/40 bg-jade-500/10 text-jade-400'
                        : said.verdict === 'close'
                          ? 'border-[#fbbf6b]/40 bg-[#fbbf6b]/8 text-[#fbbf6b]'
                          : 'border-[#e5484d]/40 bg-[#e5484d]/10 text-[#fca5a5]',
                  )}
                >
                  {said === 'failed'
                    ? "Didn't catch that. Try again, a little closer to the mic."
                    : said.verdict === 'right'
                      ? (
                        <>
                          <IconCheck width={16} height={16} aria-hidden /> Well said. I heard “{said.heard}”
                        </>
                      )
                      : said.verdict === 'close'
                        ? `Almost. I heard “${said.heard}”. Listen and try again.`
                        : `Not quite. I heard “${said.heard}”. Listen and try again.`}
                </div>
              )}
              <div className={cn('mt-5', !shown && 'invisible')}>
                <p className="mb-2 text-[12px] font-medium text-faint">How well did you know it?</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['again', 'Again', 'border-[#e5484d]/40 bg-[#e5484d]/10 text-[#fca5a5]', 'text-[#fca5a5]/70'],
                    ['good', 'Good', 'border-white/10 bg-white/[0.04] text-chalk', 'text-faint'],
                    ['easy', 'Easy', 'border-transparent bg-jade-500 text-ink-900', 'text-ink-900/70'],
                  ] as const).map(([g, label, look, sub]) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => grade(g)}
                      className={cn('flex flex-col items-center gap-0.5 rounded-[14px] border py-2.5 transition-transform active:scale-[0.98]', look)}
                    >
                      <span className="text-[14px] font-semibold">{label}</span>
                      <span className={cn('text-[11px]', sub)}>{comesBack(card.box, g)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}

function Empty() {
  return (
    <p className="py-10 text-center text-[13px] leading-relaxed text-mist">
      No words yet. Have a conversation: the useful words and phrases from it come here to practise.
    </p>
  )
}
