import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  compareBodyLanguage,
  formatClock,
  type BodyComparison,
  type BodyExercise,
  type BodyFinding,
  type BodyLanguageReport,
} from '../api'
import { CHECK_LABEL, compareMetrics, orderFindings } from './bodyLanguage'

/**
 * Body language: what the measurements found, when, what the AI saw in those moments, and the
 * research-based exercise for each. No score: the point is what to change and how.
 */
export function BodyLanguageSection({
  sessionId,
  report,
  onSeek,
}: {
  sessionId: string
  report: BodyLanguageReport
  onSeek: (ms: number) => void
}) {
  const findings = orderFindings(report.findings)
  const unsupported = Object.entries(report.checks).filter(([, c]) => c.status === 'unsupported')
  const measured = Object.entries(report.checks).filter(([, c]) => c.status === 'measured')
  const [open, setOpen] = useState<string | null>(findings[0]?.id ?? null)

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-3xl border border-white/8 bg-white/[0.03] p-4 sm:p-5">
        <h3 className="text-[14.5px] font-semibold text-chalk">Body language</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-mist">
          {findings.length
            ? `${findings.length} ${findings.length === 1 ? 'moment' : 'moments'} to work on, each with an exercise from research.`
            : measured.length
              ? 'Nothing stood out in what the camera could see.'
              : 'The camera did not show enough of you to judge body language this time.'}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Measured on your device from your posture, hands and head, compared with how you sat or stood at the start.
          It describes what you did, not how you felt: nothing here judges confidence, nerves or personality.
        </p>
      </section>

      {findings.map((finding) => (
        <FindingCard
          key={finding.id}
          finding={finding}
          exercise={report.exercises[finding.exerciseId]}
          open={open === finding.id}
          onToggle={() => setOpen((id) => (id === finding.id ? null : finding.id))}
          onSeek={onSeek}
        />
      ))}

      <Comparison sessionId={sessionId} />

      {(measured.length > 0 || unsupported.length > 0) && (
        <section className="rounded-3xl border border-white/8 bg-white/[0.03] p-4 sm:p-5">
          <h4 className="text-[13px] font-semibold text-chalk">What was checked</h4>
          <ul className="mt-2 flex flex-col gap-1.5 text-[12px]">
            {measured.map(([check]) => (
              <li key={check} className="flex gap-2 text-mist">
                <span className="text-jade-400" aria-hidden>✓</span>
                {CHECK_LABEL[check as keyof typeof CHECK_LABEL]}
              </li>
            ))}
            {unsupported.map(([check, c]) => (
              <li key={check} className="flex gap-2 text-faint">
                <span aria-hidden>–</span>
                <span>
                  <span className="text-mist">{CHECK_LABEL[check as keyof typeof CHECK_LABEL]}: not measured.</span> {c.reason}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function FindingCard({
  finding,
  exercise,
  open,
  onToggle,
  onSeek,
}: {
  finding: BodyFinding
  exercise: BodyExercise | undefined
  open: boolean
  onToggle: () => void
  onSeek: (ms: number) => void
}) {
  const review = finding.review?.verdict === 'confirmed' ? finding.review : null
  return (
    <section className="rounded-3xl border border-white/8 bg-white/[0.03] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onSeek(finding.startMs)}
          aria-label={`Watch from ${formatClock(finding.startMs)}`}
          className="shrink-0 rounded-full bg-[#a78bfa]/15 px-2.5 py-1 text-[11.5px] font-semibold tabular-nums text-[#c4b5fd] hover:bg-[#a78bfa]/25"
        >
          ▶ {formatClock(finding.startMs)}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="text-[13.5px] font-semibold text-chalk">{CHECK_LABEL[finding.check]}</h4>
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10.5px] text-mist">
              {finding.kind === 'measured' ? 'Measured' : 'Estimated'}
            </span>
            {review && <span className="rounded-full bg-jade-500/15 px-2 py-0.5 text-[10.5px] text-jade-300">Seen on video</span>}
            {finding.confidence === 'low' && <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10.5px] text-faint">Low certainty</span>}
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-mist">{finding.observation}</p>
          {review?.whatISee && <p className="mt-1.5 text-[12.5px] leading-relaxed text-mist">{review.whatISee}</p>}
          {(review?.howToFix || exercise) && (
            <p className="mt-2 text-[12.5px] leading-relaxed text-chalk">
              <span className="font-semibold text-jade-400">How to fix it: </span>
              {review?.howToFix || exercise?.title}
            </p>
          )}
        </div>
      </div>
      {exercise && (
        <div className="mt-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="text-[12px] font-semibold text-mist underline decoration-white/25 underline-offset-2 hover:text-chalk"
          >
            {open ? 'Hide the exercise' : `Exercise: ${exercise.title}`}
          </button>
          {open && <ExerciseSteps exercise={exercise} />}
        </div>
      )}
    </section>
  )
}

function ExerciseSteps({ exercise }: { exercise: BodyExercise }) {
  return (
    <div className="mt-2.5 rounded-2xl bg-white/[0.04] p-3">
      <div className="text-[12.5px] font-semibold text-chalk">{exercise.title}</div>
      <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-4 text-[12px] leading-relaxed text-mist">
        {exercise.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="mt-2.5 text-[11.5px] leading-relaxed text-mist">{exercise.why}</p>
      <details className="mt-2 text-[11px] leading-relaxed text-faint">
        <summary className="cursor-pointer text-mist">What the research shows</summary>
        <p className="mt-1.5">{exercise.evidence}</p>
        <ul className="mt-1.5 flex flex-col gap-1">
          {exercise.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer" className="underline decoration-white/20 underline-offset-2 hover:text-mist">
                {source.citation}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

/** This session's numbers against the previous and the first session framed the same way. */
function Comparison({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<BodyComparison | null>(null)

  useEffect(() => {
    let cancelled = false
    compareBodyLanguage(sessionId)
      .then((result) => !cancelled && setData(result))
      .catch(() => !cancelled && setData(null))
    return () => {
      cancelled = true
    }
  }, [sessionId])

  if (!data?.previous) return null
  const reference = data.first ?? data.previous
  const rows = compareMetrics(reference.metrics, data.current.metrics)
  const sinceLast = compareMetrics(data.previous.metrics, data.current.metrics)
  if (!rows.length && !sinceLast.length) return null
  return (
    <section className="rounded-3xl border border-white/8 bg-white/[0.03] p-4 sm:p-5">
      <h4 className="text-[13px] font-semibold text-chalk">Before and after</h4>
      <p className="mt-0.5 text-[11.5px] text-faint">
        Share of the time, {data.first ? `your first of ${data.sessions} sessions` : 'your previous session'} → this one, framed the
        same way
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {(rows.length ? rows : sinceLast).map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-3 text-[12.5px]">
            <span className="text-mist">{row.label}</span>
            <span
              className={cn(
                'tabular-nums font-semibold',
                row.improved === true ? 'text-jade-300' : row.improved === false ? 'text-[#fcd34d]' : 'text-mist',
              )}
            >
              {row.before}% → {row.after}%
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
