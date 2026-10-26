import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { IconArrowLeft, IconChevronRight, IconFlame, IconMic, IconTarget } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { ApiError } from '@/platform/api/client'
import { getRoundGuide, writeRoundGuide, type BlueprintRound, type RoundGuide as Guide } from '../api'

/**
 * Before practising a round: the questions it is most likely to include (reported ones first,
 * with their sources), how to answer each, a sample answer from the candidate's own resume, and
 * ideas to stand out. Optional: the candidate can start the interview from here or skip it.
 */

type Tab = 'questions' | 'standOut' | 'ask'

const EFFORT: Record<Guide['standOut'][number]['effort'], { label: string; className: string }> = {
  quick: { label: 'Quick win', className: 'bg-jade-500/15 text-jade-400' },
  prep: { label: 'An evening', className: 'bg-[#fcd34d]/12 text-[#fcd34d]' },
  project: { label: 'A few days', className: 'bg-[#a766f2]/15 text-[#c4a1f7]' },
}

/** While the guide is written: what is happening, so the wait reads as work. */
const WRITING_STEPS = [
  'Reading the round and the research',
  'Choosing the questions most likely to come up',
  'Drafting answers from your resume',
  'Finding ways for you to stand out',
]

function useWritingStep(active: boolean) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!active) return
    setStep(0)
    const timer = window.setInterval(() => setStep((s) => Math.min(WRITING_STEPS.length - 1, s + 1)), 6000)
    return () => window.clearInterval(timer)
  }, [active])
  return step
}

function describeProblem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "You've written today's preparation guides. Try again tomorrow."
    if (error.status === 403) return 'Accept AI processing in your account to prepare a guide.'
    if (error.status === 404) return 'This round is no longer in your journey.'
  }
  return "The guide couldn't be written right now. Try again in a moment."
}

export function QuestionItem({ item, index }: { item: Guide['questions'][number]; index: number }) {
  const [open, setOpen] = useState(index === 0)
  const [showAnswer, setShowAnswer] = useState(false)
  return (
    <li className="rounded-xl border border-white/8 bg-white/4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
      >
        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-white/8 text-[10.5px] font-semibold text-mist">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium leading-snug text-chalk">{item.question}</span>
          <span
            className={cn(
              'mt-1 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium',
              item.reported ? 'bg-jade-500/15 text-jade-400' : 'bg-white/8 text-faint',
            )}
          >
            {item.reported ? `Reported by candidates${item.sources.length ? ` · ${item.sources.join(', ')}` : ''}` : 'Likely'}
          </span>
        </span>
        <IconChevronRight
          width={14}
          height={14}
          className={cn('mt-1 shrink-0 text-faint transition-transform duration-200', open && 'rotate-90')}
        />
      </button>
      {open && (
        <div className="anim-fade space-y-2 border-t border-white/8 px-3 pb-3 pt-2 text-[11.5px] leading-relaxed text-mist">
          {item.assesses && (
            <p>
              <span className="text-chalk">What they're looking for: </span>
              {item.assesses}
            </p>
          )}
          {item.outline.length > 0 && (
            <div>
              <div className="text-chalk">How to answer</div>
              <ol className="mt-1 space-y-1">
                {item.outline.map((step, i) => (
                  <li key={step} className="flex gap-2">
                    <span className="mt-[3px] grid size-4 shrink-0 place-items-center rounded-full bg-jade-500/15 text-[9.5px] font-semibold text-jade-400">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {item.resumeHook && (
            <p>
              <span className="text-chalk">From your resume: </span>
              {item.resumeHook}
            </p>
          )}
          {item.sampleAnswer && (
            <div>
              <button
                type="button"
                onClick={() => setShowAnswer((s) => !s)}
                className="text-[11.5px] font-medium text-jade-400 underline-offset-2 hover:underline"
                aria-expanded={showAnswer}
              >
                {showAnswer ? 'Hide answer template' : 'Show a grounded answer template'}
              </button>
              {showAnswer && (
                <blockquote className="anim-fade mt-1.5 rounded-lg border-l-2 border-jade-400/60 bg-black/20 px-2.5 py-2 italic text-chalk/90">
                  {item.sampleAnswer}
                </blockquote>
              )}
            </div>
          )}
          {item.pitfalls.length > 0 && (
            <div>
              <div className="text-chalk">Avoid</div>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {item.pitfalls.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export function GuideView({ guide }: { guide: Guide }) {
  const [tab, setTab] = useState<Tab>('questions')
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'questions', label: 'Questions', count: guide.questions.length },
    { id: 'standOut', label: 'Stand out', count: guide.standOut.length },
    { id: 'ask', label: 'Ask them', count: guide.questionsToAsk.length },
  ]
  return (
    <div>
      {guide.modelAttribution?.provider === 'Nebius Token Factory' && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-[#76b900]/25 bg-[#76b900]/8 px-3 py-2 text-[10.5px] text-chalk">
          <span className="rounded-md bg-[#76b900]/15 px-1.5 py-0.5 font-semibold tracking-wide text-[#b6e36b]">
            NEMOTRON
          </span>
          <span>
            Built with NVIDIA Nemotron on Nebius Token Factory
            <span className="ml-1 text-faint">· {guide.modelAttribution.model}</span>
          </span>
        </div>
      )}
      {guide.approach && (
        <div className="flex gap-2 rounded-xl border border-jade-400/20 bg-jade-500/8 px-3 py-2.5">
          <IconTarget width={15} height={15} className="mt-0.5 shrink-0 text-jade-400" />
          <p className="text-[11.5px] leading-relaxed text-chalk/90">{guide.approach}</p>
        </div>
      )}
      <div role="tablist" aria-label="Preparation guide" className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-white/4 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'h-8 rounded-lg text-[11.5px] font-medium transition-all duration-200',
              tab === t.id ? 'bg-white/10 text-chalk shadow-sm' : 'text-mist hover:text-chalk',
            )}
          >
            {t.label} <span className="text-faint">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === 'questions' && (
        <ol key="questions" className="anim-fade mt-2 flex flex-col gap-1.5">
          {guide.questions.map((q, i) => (
            <QuestionItem key={q.question} item={q} index={i} />
          ))}
        </ol>
      )}
      {tab === 'questions' && !guide.hasResume && (
        <p className="mt-1.5 px-1 text-[10.5px] text-faint">
          Add your resume to the application for sample answers built from your own experience.
        </p>
      )}

      {tab === 'standOut' && (
        <ul key="standOut" className="anim-fade mt-2 flex flex-col gap-1.5">
          {guide.standOut.map((idea) => (
            <li key={idea.title} className="rounded-xl border border-white/8 bg-white/4 px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <IconFlame width={14} height={14} className="shrink-0 text-[#f5a25e]" />
                  <span className="text-[12.5px] font-semibold text-chalk">{idea.title}</span>
                </div>
                <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium', EFFORT[idea.effort].className)}>
                  {EFFORT[idea.effort].label}
                </span>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-chalk/90">{idea.idea}</p>
              {idea.how && (
                <p className="mt-1 text-[11.5px] leading-relaxed text-mist">
                  <span className="text-chalk">How: </span>
                  {idea.how}
                </p>
              )}
              {idea.why && (
                <p className="mt-1 text-[11px] leading-relaxed text-faint">
                  <span className="text-mist">Why it works: </span>
                  {idea.why}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {tab === 'ask' && (
        <ul key="ask" className="anim-fade mt-2 flex flex-col gap-1.5">
          {guide.questionsToAsk.map((ask) => (
            <li key={ask.question} className="rounded-xl border border-white/8 bg-white/4 px-3 py-2.5">
              <p className="text-[12.5px] font-medium leading-snug text-chalk">“{ask.question}”</p>
              {ask.why && <p className="mt-1 text-[11px] leading-relaxed text-mist">{ask.why}</p>}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 px-1 text-[10.5px] leading-relaxed text-faint">
        Likely questions are predictions, not a list of what will be asked. Replace every [bracketed] detail with your own.
      </p>
    </div>
  )
}

export function RoundGuide({
  applicationId,
  blueprintId,
  round,
  onBack,
  onPractise,
}: {
  applicationId: string
  blueprintId: string
  round: BlueprintRound
  onBack: () => void
  onPractise: () => void
}) {
  const [guide, setGuide] = useState<Guide | null>(null)
  const [state, setState] = useState<'loading' | 'writing' | 'ready' | 'failed'>('loading')
  const [problem, setProblem] = useState<string | null>(null)
  const step = useWritingStep(state === 'writing')

  const write = useCallback(async () => {
    setState('writing')
    setProblem(null)
    try {
      setGuide(await writeRoundGuide(applicationId, blueprintId, round.id))
      setState('ready')
    } catch (error) {
      setProblem(describeProblem(error))
      setState(guide ? 'ready' : 'failed')
    }
  }, [applicationId, blueprintId, round.id, guide])

  useEffect(() => {
    let live = true
    setState('loading')
    getRoundGuide(applicationId, blueprintId, round.id)
      .then((found) => {
        if (!live) return
        if (found) {
          setGuide(found)
          setState('ready')
        } else {
          // Opening the guide is the request: write it straight away.
          void write()
        }
      })
      .catch((error) => {
        if (!live) return
        setProblem(describeProblem(error))
        setState('failed')
      })
    return () => {
      live = false
    }
    // Only when the round changes; `write` changes once a guide exists.
  }, [applicationId, blueprintId, round.id])

  return (
    <div className="anim-fade mt-3">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-[11.5px] text-mist hover:text-chalk">
        <IconArrowLeft width={13} height={13} />
        All rounds
      </button>
      <div className="mt-1.5">
        <div className="eyebrow">Round {round.order} · Preparation</div>
        <div className="mt-0.5 text-[14px] font-semibold text-chalk">{round.title}</div>
      </div>

      <div className="mt-3">
        {(state === 'loading' || state === 'writing') && (
          <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-3" role="status" aria-live="polite">
            <div className="text-[12.5px] font-medium text-chalk">
              {state === 'loading' ? 'Opening your guide…' : 'Writing your preparation guide…'}
            </div>
            {state === 'writing' && (
              <ol className="mt-2 space-y-1.5">
                {WRITING_STEPS.map((label, i) => (
                  <li
                    key={label}
                    className={cn(
                      'flex items-center gap-2 text-[11.5px] transition-colors duration-300',
                      i < step ? 'text-mist' : i === step ? 'text-chalk' : 'text-faint/60',
                    )}
                  >
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        i < step ? 'bg-jade-400' : i === step ? 'animate-pulse bg-jade-400' : 'bg-white/15',
                      )}
                    />
                    {label}
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-2 text-[10.5px] text-faint">This takes up to a minute. You can also practise right away.</p>
          </div>
        )}
        {state === 'failed' && (
          <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-3">
            <p className="text-[12px] text-mist">{problem}</p>
            <Button variant="ghost" className="mt-2 h-8 w-full text-[12px]" onClick={() => void write()}>
              Try again
            </Button>
          </div>
        )}
        {guide && state === 'ready' && <GuideView guide={guide} />}
        {problem && state === 'ready' && (
          <p className="mt-2 text-[11.5px] text-[#fca5a5]" role="alert">
            {problem}
          </p>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="primary" className="h-9 flex-1 text-[12.5px]" onClick={onPractise}>
          <IconMic width={14} height={14} />
          Practise this round
        </Button>
        {guide && state === 'ready' && (
          <Button variant="ghost" className="h-9 text-[12px]" onClick={() => void write()}>
            Refresh
          </Button>
        )}
      </div>
    </div>
  )
}
