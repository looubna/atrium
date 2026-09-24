import { useEffect, useState } from 'react'
import { IconChevronRight } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import {
  CATEGORY_LABELS,
  getOpportunity,
  getPlan,
  TIER_LABELS,
  type Concern,
  type Differentiator,
  type OpportunityProfile,
  type PreparationPlan,
  type Question,
  type QuestionCategory,
} from '@/modules/admission/api'

/**
 * What to prepare, once the research and the application have both been read (§20).
 *
 * The order is the order a candidate needs it in: the questions they will actually be asked,
 * then what they could be memorable for, then what their own file leaves unexplained. The
 * research itself is last and folded away — it is why the rest is trustworthy, not something
 * anyone needs to read before practising.
 *
 * Every question carries why it is here. That line is the difference between this and a list
 * of fifty questions off a forum, so it is shown rather than hidden behind a tap.
 */

/** The order questions are worth reading in: what is certain first, what is hard last. */
const ORDER: QuestionCategory[] = [
  'very_likely',
  'opportunity_specific',
  'personalized',
  'likely',
  'challenging',
  'follow_up',
]

function Section({
  title,
  note,
  children,
  open: initiallyOpen = false,
}: {
  title: string
  note?: string
  children: React.ReactNode
  open?: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-white/8 bg-white/4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left hover:bg-white/4"
      >
        <span>
          <span className="block text-[13px] font-medium text-chalk">{title}</span>
          {note && <span className="mt-0.5 block text-[11px] text-faint">{note}</span>}
        </span>
        <IconChevronRight
          width={14}
          height={14}
          className={cn('shrink-0 text-faint transition-transform', open && 'rotate-90')}
        />
      </button>
      {open && <div className="border-t border-white/8 px-3.5 py-3">{children}</div>}
    </div>
  )
}

function QuestionCard({ question }: { question: Question }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-2 rounded-lg border border-white/8 bg-white/4 px-3 py-2.5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full text-left">
        <span className="text-[10px] uppercase tracking-wide text-faint">{CATEGORY_LABELS[question.category]}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-chalk">{question.text}</span>
      </button>
      {open && (
        <div className="mt-2 border-t border-white/8 pt-2">
          {question.why.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-wide text-faint">Why you'll be asked</p>
              <ul className="mt-1 mb-2">
                {question.why.map((line) => (
                  <li key={line} className="text-[11.5px] leading-relaxed text-mist">
                    {line}
                  </li>
                ))}
              </ul>
            </>
          )}
          {question.prepare.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-wide text-faint">Have ready</p>
              <ul className="mt-1">
                {question.prepare.map((line) => (
                  <li key={line} className="text-[11.5px] leading-relaxed text-chalk">
                    • {line}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function DifferentiatorCard({ item }: { item: Differentiator }) {
  return (
    <div className="mb-2.5">
      <p className="text-[12.5px] leading-snug text-chalk">{item.text}</p>
      {item.why && <p className="mt-0.5 text-[11.5px] leading-relaxed text-mist">{item.why}</p>}
      {item.evidence.length > 0 && (
        <p className="mt-1 text-[11px] leading-relaxed text-faint">From your file: {item.evidence.join('; ')}</p>
      )}
      {item.where.length > 0 && (
        <p className="mt-0.5 text-[11px] leading-relaxed text-faint">Where: {item.where.join('; ')}</p>
      )}
    </div>
  )
}

function ConcernCard({ item }: { item: Concern }) {
  return (
    <div className="mb-2.5">
      <p className="text-[12.5px] leading-snug text-chalk">{item.text}</p>
      {item.why && <p className="mt-0.5 text-[11.5px] leading-relaxed text-mist">{item.why}</p>}
      {item.prepare.map((line) => (
        <p key={line} className="mt-0.5 text-[11.5px] leading-relaxed text-faint">
          • {line}
        </p>
      ))}
    </div>
  )
}

export function PrepDashboard({ prepId }: { prepId: string }) {
  const [plan, setPlan] = useState<PreparationPlan | null>(null)
  const [opportunity, setOpportunity] = useState<OpportunityProfile | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let live = true
    getPlan(prepId)
      .then((p) => live && setPlan(p))
      .catch(() => live && setMissing(true))
    getOpportunity(prepId)
      .then((o) => live && setOpportunity(o))
      .catch(() => {
        /* research may have found nothing; the questions still stand on their own */
      })
    return () => {
      live = false
    }
  }, [prepId])

  if (missing && !plan) {
    return (
      <p className="mt-3 text-[12px] leading-relaxed text-mist">
        There wasn't enough to build a preparation from. Adding your CV or study plan gives it something to
        work with.
      </p>
    )
  }
  if (!plan) return <p className="mt-3 text-[12px] text-faint">Loading what to prepare…</p>

  const ordered = ORDER.flatMap((category) => plan.questions.filter((q) => q.category === category))
  const story = plan.story
  const hasStory = Boolean(story.past || story.present || story.program || story.future)

  return (
    <div className="mt-1">
      <p className="mb-2 text-[11px] uppercase tracking-wide text-faint">Questions to prepare</p>
      {ordered.map((question) => (
        <QuestionCard key={question.text} question={question} />
      ))}

      {plan.differentiators.length > 0 && (
        <Section title="What could make you memorable" note="Drawn only from what your own documents show">
          {plan.differentiators.map((item) => (
            <DifferentiatorCard key={item.text} item={item} />
          ))}
        </Section>
      )}

      {plan.concerns.length > 0 && (
        <Section title="What your file leaves unexplained">
          {plan.concerns.map((item) => (
            <ConcernCard key={item.text} item={item} />
          ))}
        </Section>
      )}

      {hasStory && (
        <Section title="Your story, end to end">
          {([['Past', story.past], ['Now', story.present], ['This programme', story.program], ['After', story.future]] as const)
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <p key={label} className="mb-1.5 text-[12px] leading-relaxed text-mist">
                <span className="text-faint">{label}: </span>
                {value}
              </p>
            ))}
          {story.missingLinks.map((line) => (
            <p key={line} className="mt-1.5 text-[11.5px] leading-relaxed text-chalk">
              • {line}
            </p>
          ))}
        </Section>
      )}

      {opportunity && (
        <Section title="What we researched" note={`${Object.keys(opportunity.sources).length} sources`}>
          {opportunity.summary && (
            <p className="mb-2 text-[12px] leading-relaxed text-mist">{opportunity.summary}</p>
          )}
          {opportunity.interviewTopics.slice(0, 8).map((topic) => (
            <p key={topic.text} className="mb-1 text-[11.5px] leading-relaxed text-mist">
              • {topic.text}{' '}
              <span className="text-faint">
                ({TIER_LABELS[topic.tier]}
                {topic.accounts > 0 ? `, ${topic.accounts} account${topic.accounts === 1 ? '' : 's'}` : ''})
              </span>
            </p>
          ))}
          {/* Always shown with the patterns, never as a footnote: it is what the set actually is. */}
          {opportunity.caveats.map((caveat) => (
            <p key={caveat} className="mt-2 text-[11px] leading-relaxed text-faint">
              {caveat}
            </p>
          ))}
        </Section>
      )}
    </div>
  )
}
