import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { formatMetric, type PracticeMetric, type RoundResult } from '@/modules/practice/api'
import { IconCheck, IconChevronRight, IconFlame, IconMedal, IconTarget } from '../ui/Icon'
import { StoryArcChart } from './StoryArcChart'
import { StoryModel } from './StoryModel'

/**
 * A round, played back visually: how it went at a glance, each result on a gauge
 * against its goal and your best, the answer drawn on a timeline, then the coach's
 * notes and the progress it earned. Motion is subtle and switched off for people who
 * prefer reduced motion.
 */
export function RoundFeedback({ result }: { result: RoundResult }) {
  const { metrics, feedback, awards } = result
  const shown = metrics.filter((m) => m.value !== null)
  const drill = result.progress?.drills?.[result.drillId]

  return (
    <div className="flex flex-col gap-3.5" aria-live="polite">
      <Hero result={result} />

      {!awards.counted && (
        <Callout tone="work">
          This round was too short to count. Speak for at least {result.minSpeechSeconds} seconds for results, challenges
          and your streak.
        </Callout>
      )}

      {shown.length > 0 && (
        <section aria-label="Round results">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {shown.map((m, i) => (
              <MetricCard key={m.key} metric={m} delay={120 + i * 70} />
            ))}
          </div>
          {shown.some((m) => m.source === 'ai') && (
            <p className="mt-1.5 text-[10.5px] text-faint">Cards marked AI are an assessment, not a measurement.</p>
          )}
        </section>
      )}

      {result.arc && <StoryArcChart arc={result.arc} />}

      {result.timeline?.length > 0 && <SpeechTimeline result={result} />}

      {feedback && (feedback.strengths.length > 0 || feedback.improvements.length > 0) && (
        <div className="grid gap-2 sm:grid-cols-2">
          <CoachCard title="What worked" tone="good" points={feedback.strengths} delay={350} />
          <CoachCard title="Change next time" tone="work" points={feedback.improvements} delay={430} />
        </div>
      )}
      {feedback?.model && <StoryModel model={feedback.model} attemptId={result.attemptId} />}

      {!feedback && result.transcript && (
        <Callout tone="ok">Coaching notes aren’t available right now — your measured results are above.</Callout>
      )}

      {feedback?.nextTry && (
        <div
          className="anim-rise relative overflow-hidden rounded-2xl border border-[#5fd6de]/35 px-4 py-3"
          style={{
            animationDelay: '500ms',
            background: 'linear-gradient(120deg, rgba(95,214,222,0.16), rgba(52,211,153,0.06) 60%, transparent)',
          }}
        >
          <div className="flex items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#5fd6de]/15 text-[#8ee8ee]">
              <IconTarget width={16} height={16} />
            </span>
            <div className="min-w-0">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#8ee8ee]">Your next try</div>
              <p className="mt-0.5 text-[14px] font-medium leading-snug text-chalk">{feedback.nextTry}</p>
            </div>
          </div>
        </div>
      )}

      {awards.counted && drill && awards.challenge && <ChallengeLadder result={result} />}

      {awards.achievements.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {awards.achievements.map((a, i) => (
            <div
              key={a.id}
              className="anim-rise flex items-center gap-2.5 rounded-xl border border-[#f5d58e]/30 bg-[#f5d58e]/8 px-3 py-2"
              style={{ animationDelay: `${650 + i * 90}ms` }}
            >
              <span className="grid size-8 place-items-center rounded-full bg-[#f5d58e]/15 text-[#f5d58e]">
                <IconMedal width={16} height={16} />
              </span>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f5d58e]/80">Achievement</div>
                <div className="text-[13px] font-semibold text-chalk">{a.title}</div>
                <div className="text-[11px] text-mist">{a.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* -- hero -------------------------------------------------------------------- */

function Hero({ result }: { result: RoundResult }) {
  const { awards, feedback, progress } = result
  const bests = awards.newBests.length
  return (
    <div className="anim-rise rounded-2xl border border-white/8 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-4">
      <div className="flex flex-wrap gap-1.5">
        {awards.challenge && (
          <Pill tone={awards.challenge.completed ? 'good' : awards.challenge.passed ? 'warm' : 'muted'}>
            {awards.challenge.passed ? <IconCheck width={12} height={12} /> : <IconTarget width={12} height={12} />}
            {challengeStatus(awards.challenge)}
          </Pill>
        )}
        {bests > 0 && (
          <Pill tone="good">
            <span className="size-1.5 rounded-full bg-jade-400" />
            {bests} new personal best{bests === 1 ? '' : 's'}
          </Pill>
        )}
        {awards.streakExtended && progress?.streak && (
          <Pill tone="warm">
            <IconFlame width={12} height={12} />
            {progress.streak.current}-day streak
          </Pill>
        )}
        {awards.todayDone && <Pill tone="good">Today’s challenge done</Pill>}
      </div>
      <p className="mt-2.5 text-[18px] font-semibold leading-snug text-chalk sm:text-[20px]">
        {feedback?.headline ?? (awards.counted ? 'Here’s how your round went.' : 'Almost — keep talking a little longer.')}
      </p>
      {awards.counted && progress?.levelSpan ? <XpBar result={result} /> : null}
    </div>
  )
}

function XpBar({ result }: { result: RoundResult }) {
  const { progress, awards } = result
  const before = progress.levelXp - awards.xp
  const leveledUp = before < 0
  const from = leveledUp ? 0 : before / Math.max(1, progress.levelSpan)
  const to = progress.levelXp / Math.max(1, progress.levelSpan)
  const [width, setWidth] = useState(from)
  useEffect(() => {
    const timer = window.setTimeout(() => setWidth(to), 250)
    return () => window.clearTimeout(timer)
  }, [to])
  const gained = useCountUp(awards.xp, 900, 250)
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-semibold text-chalk">
          Level {progress.level}
          {leveledUp && <span className="ml-1.5 text-jade-300">· level up</span>}
        </span>
        <span className="tabular-nums text-faint">
          {awards.xp > 0 && <span className="mr-2 font-semibold text-jade-300">+{Math.round(gained)} XP</span>}
          {progress.levelXp} / {progress.levelSpan}
        </span>
      </div>
      <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/8">
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/15" style={{ width: `${from * 100}%` }} />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-jade-600 to-jade-400 transition-[width] duration-[1100ms] ease-out"
          style={{ width: `${width * 100}%` }}
        />
      </div>
    </div>
  )
}

/* -- metric cards -------------------------------------------------------------- */

function meetsGoal(m: PracticeMetric): boolean | null {
  if (m.value === null) return null
  if (m.band) return m.value >= m.band[0] && m.value <= m.band[1]
  if (m.goal === null) return null
  return m.better === 'higher' ? m.value >= m.goal : m.value <= m.goal
}

function MetricCard({ metric, delay }: { metric: PracticeMetric; delay: number }) {
  const good = meetsGoal(metric)
  const value = useCountUp(metric.value ?? 0, 800, delay)
  const shown = metric.value !== null && Number.isInteger(metric.value) ? Math.round(value) : Math.round(value * 10) / 10
  return (
    <div
      role="listitem"
      className={cn(
        'anim-rise relative flex flex-col rounded-2xl border p-3',
        metric.newBest ? 'anim-glow border-jade-400/50 bg-jade-500/[0.08]' : 'border-white/8 bg-white/[0.04]',
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-mist">{metric.label}</span>
        {metric.source === 'ai' && (
          <span className="shrink-0 rounded-md bg-white/8 px-1.5 py-px text-[9px] font-semibold tracking-wide text-faint">AI</span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        {metric.unit === '%' ? (
          <Ring fraction={(metric.value ?? 0) / 100} good={good} delay={delay} />
        ) : null}
        <div className="min-w-0">
          <div className="text-[22px] font-semibold leading-none tabular-nums text-chalk">
            {metric.key === 'bothSides' ? (metric.value ? 'Yes' : 'No') : formatMetric(shown, metric.unit)}
          </div>
          {metric.band && (
            <div className={cn('mt-1 text-[10.5px]', good ? 'text-jade-300' : 'text-[#f5c08e]')}>
              {good
                ? `Comfortable ${metric.band[0]}–${metric.band[1]}`
                : `${(metric.value ?? 0) > metric.band[1] ? 'Fast' : 'Slow'} · aim for ${metric.band[0]}–${metric.band[1]}`}
            </div>
          )}
          {metric.goal !== null && !metric.band && metric.key !== 'bothSides' && (
            <div className={cn('mt-1 text-[10.5px]', good ? 'text-jade-300' : 'text-[#f5c08e]')}>
              {good ? 'On target' : 'Goal'} {metric.better === 'higher' ? '≥' : '≤'} {formatMetric(metric.goal, metric.unit)}
            </div>
          )}
        </div>
      </div>

      <div className="mt-auto pt-3">
        {metric.unit === '/5' ? (
          <Pips value={metric.value ?? 0} delay={delay} />
        ) : metric.unit !== '%' && metric.key !== 'bothSides' ? (
          <Track metric={metric} good={good} delay={delay} />
        ) : null}
        {metric.newBest ? (
          <div className="mt-2 text-[10px] font-semibold tracking-[0.12em] text-jade-300">
            NEW PERSONAL BEST
            {metric.best !== null && <span className="ml-1 font-normal tracking-normal text-faint">was {formatMetric(metric.best, metric.unit)}</span>}
          </div>
        ) : metric.isBestMetric && metric.best !== null ? (
          <div className="mt-2 text-[10px] text-faint">Best {formatMetric(metric.best, metric.unit)}</div>
        ) : null}
      </div>
    </div>
  )
}

/** A horizontal gauge: the value's fill, the goal line and your previous best. */
function Track({ metric, good, delay }: { metric: PracticeMetric; good: boolean | null; delay: number }) {
  const [low, high] = metric.scale
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - low) / Math.max(1e-6, high - low)) * 100))}%`
  return (
    <div className="relative h-2 rounded-full bg-white/8">
      <div
        className={cn('anim-grow-x absolute inset-y-0 left-0 rounded-full', good === false ? 'bg-[#f0a35e]' : 'bg-jade-400')}
        style={{ width: at(metric.value ?? low), animationDelay: `${delay + 100}ms` }}
      />
      {metric.band && (
        <div
          className="absolute -inset-y-1 rounded-sm border-x border-chalk/50 bg-white/[0.06]"
          style={{ left: at(metric.band[0]), width: `calc(${at(metric.band[1])} - ${at(metric.band[0])})` }}
          title="Comfortable range"
        />
      )}
      {metric.goal !== null && (
        <div className="absolute -top-1 bottom-[-4px] w-px bg-chalk/60" style={{ left: at(metric.goal) }} title="Goal" />
      )}
      {metric.best !== null && !metric.newBest && (
        <div
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#070b14] bg-mist"
          style={{ left: at(metric.best) }}
          title={`Your best: ${formatMetric(metric.best, metric.unit)}`}
        />
      )}
    </div>
  )
}

function Pips({ value, delay }: { value: number; delay: number }) {
  return (
    <div className="flex gap-1" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={cn('anim-tick h-2 flex-1 rounded-full', n <= value ? (value >= 4 ? 'bg-jade-400' : 'bg-[#fcd34d]') : 'bg-white/8')}
          style={{ animationDelay: `${delay + 80 * n}ms` }}
        />
      ))}
    </div>
  )
}

function Ring({ fraction, good, delay }: { fraction: number; good: boolean | null; delay: number }) {
  const r = 18
  const c = 2 * Math.PI * r
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(Math.min(1, Math.max(0, fraction))), delay + 80)
    return () => window.clearTimeout(timer)
  }, [fraction, delay])
  return (
    <svg viewBox="0 0 44 44" className="size-11 shrink-0 -rotate-90" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        stroke={good === false ? '#f0a35e' : '#5fe3a8'}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - shown)}
        style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.16, 1, 0.3, 1)' }}
      />
    </svg>
  )
}

/* -- speech timeline ------------------------------------------------------------- */

const PAUSE_MS = 1200
const LONG_PAUSE_MS = 3000

function SpeechTimeline({ result }: { result: RoundResult }) {
  const words = result.timeline
  const [open, setOpen] = useState(false)
  const start = words[0].s
  const end = Math.max(words[words.length - 1].e, start + 1)
  const span = end - start
  const pos = (ms: number) => `${((ms - start) / span) * 100}%`
  const pauses = words.slice(1).flatMap((w, i) => {
    const gap = w.s - words[i].e
    return gap >= PAUSE_MS ? [{ from: words[i].e, to: w.s, long: gap >= LONG_PAUSE_MS }] : []
  })
  const fillers = words.filter((w) => w.f).length
  const seconds = Math.round(span / 1000)

  return (
    <section className="anim-rise rounded-2xl border border-white/8 bg-white/[0.03] p-3" style={{ animationDelay: '280ms' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-faint">Your answer, over time</div>
        <div className="flex gap-3 text-[10.5px] text-mist">
          <Legend className="bg-jade-400/70">words</Legend>
          <Legend className="bg-[#f0a35e]">fillers · {fillers}</Legend>
          <Legend className="bg-[#5fd6de]/40">pauses · {pauses.length}</Legend>
        </div>
      </div>

      <div className="relative mt-3 h-14" aria-label={`${words.length} words over ${seconds} seconds, ${fillers} fillers, ${pauses.length} pauses`} role="img">
        {pauses.map((p) => (
          <div
            key={p.from}
            className={cn('absolute inset-y-1 rounded-md', p.long ? 'bg-[#f0a35e]/12' : 'bg-[#5fd6de]/14')}
            style={{ left: pos(p.from), width: `calc(${pos(p.to)} - ${pos(p.from)})` }}
            title={`${((p.to - p.from) / 1000).toFixed(1)} s pause`}
          />
        ))}
        {words.map((w, i) => {
          // A little shape per word, so the strip reads like speech rather than a ruler.
          const height = w.f ? 100 : 30 + ((w.w.length * 37 + i * 13) % 55)
          return (
            <div
              key={`${w.s}-${i}`}
              className={cn('anim-tick absolute bottom-1/2 w-[3px] translate-y-1/2 rounded-full', w.f ? 'bg-[#f0a35e]' : 'bg-jade-400/70')}
              style={{ left: pos(w.s), height: `${height}%`, animationDelay: `${300 + Math.min(700, (i / words.length) * 700)}ms` }}
              title={w.f ? `Filler: “${w.w}”` : w.w}
            />
          )
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-faint">
        <span>0 s</span>
        <span>{Math.round(seconds / 2)} s</span>
        <span>{seconds} s</span>
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-faint transition-colors hover:text-chalk"
      >
        <IconChevronRight width={12} height={12} className={cn('transition-transform', open && 'rotate-90')} />
        {open ? 'Hide what you said' : 'Read what you said'}
      </button>
      {open && (
        <p className="anim-fade mt-1.5 text-[13px] leading-relaxed text-mist">
          {words.map((w, i) => (
            <span key={i}>
              {i > 0 && (w.s - words[i - 1].e >= PAUSE_MS ? <span className="mx-1 text-[#5fd6de]/70">·</span> : ' ')}
              {w.f ? <mark className="rounded bg-[#f0a35e]/20 px-0.5 text-[#f5c08e]">{w.w}</mark> : w.w}
            </span>
          ))}
        </p>
      )}
    </section>
  )
}

const Legend = ({ className, children }: { className: string; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1">
    <span className={cn('size-2 rounded-sm', className)} />
    {children}
  </span>
)

/* -- coach ------------------------------------------------------------------------ */

function CoachCard({
  title,
  tone,
  points,
  delay,
}: {
  title: string
  tone: 'good' | 'work'
  points: { point: string; quote: string }[]
  delay: number
}) {
  if (points.length === 0) return <div />
  const accent = tone === 'good' ? 'text-jade-300' : 'text-[#f5c08e]'
  return (
    <div className="anim-rise rounded-2xl border border-white/8 bg-white/[0.04] p-3" style={{ animationDelay: `${delay}ms` }}>
      <div className={cn('flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.16em]', accent)}>
        <span className={cn('grid size-5 place-items-center rounded-full', tone === 'good' ? 'bg-jade-500/15' : 'bg-[#f0a35e]/15')}>
          {tone === 'good' ? <IconCheck width={11} height={11} /> : <IconChevronRight width={11} height={11} />}
        </span>
        {title}
      </div>
      <ul className="mt-2 flex flex-col gap-2.5">
        {points.map((p) => (
          <li key={p.point}>
            <p className="text-[13px] leading-snug text-chalk">{p.point}</p>
            {p.quote && (
              <blockquote
                className={cn(
                  'mt-1.5 border-l-2 pl-2.5 text-[12px] italic leading-snug text-mist',
                  tone === 'good' ? 'border-jade-400/60' : 'border-[#f0a35e]/60',
                )}
              >
                “{p.quote}”
              </blockquote>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* -- challenge ladder ------------------------------------------------------------- */

function ChallengeLadder({ result }: { result: RoundResult }) {
  const drill = result.progress.drills[result.drillId]
  const round = result.awards.challenge!
  return (
    <section className="anim-rise rounded-2xl border border-white/8 bg-white/[0.03] p-3" style={{ animationDelay: '580ms' }}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-faint">Challenge · optional</div>
      <div className="mt-3 flex items-start">
        {drill.challenges.map((c, i) => {
          const current = !c.done && c.level === drill.level
          const justPassed = Boolean(round.completed) && round.level === c.level
          return (
            <div key={c.level} className="flex min-w-0 flex-1 flex-col items-center text-center">
              <div className="flex w-full items-center">
                <div className={cn('h-0.5 flex-1', i === 0 ? 'opacity-0' : c.done || current ? 'bg-jade-400/50' : 'bg-white/10')} />
                <span
                  className={cn(
                    'relative grid size-8 shrink-0 place-items-center rounded-full border text-[11px] font-semibold',
                    c.done ? 'border-jade-400 bg-jade-500 text-ink-900' : current ? 'border-jade-400/70 text-jade-300' : 'border-white/12 text-faint',
                    justPassed && 'anim-glow',
                  )}
                >
                  {c.done ? <IconCheck width={14} height={14} /> : `L${c.level}`}
                  {current && <span className="absolute inset-0 animate-ping rounded-full border border-jade-400/40 [animation-duration:2.4s]" />}
                </span>
                <div
                  className={cn(
                    'h-0.5 flex-1',
                    i === drill.challenges.length - 1 ? 'opacity-0' : c.done ? 'bg-jade-400/50' : 'bg-white/10',
                  )}
                />
              </div>
              {current && <PassDots repeat={c.repeat} passes={drill.challenge.passes} />}
              <p className={cn('mt-1.5 px-1 text-[10.5px] leading-snug', c.done ? 'text-jade-300' : current ? 'text-chalk' : 'text-faint')}>
                {c.label}
              </p>
            </div>
          )
        })}
      </div>
      <p className="mt-2.5 text-center text-[11.5px] text-mist">
        {round.completed
          ? round.mastered
            ? 'Every level complete — keep your personal bests moving.'
            : `Level ${round.level} complete. Level ${round.unlocked} is next.`
          : round.passed
            ? `Passed — ${round.repeat - round.passes} more in a row to complete level ${round.level}.`
            : round.repeat > 1
              ? `Not met this time, so the count starts again. Aim for: ${round.label}`
              : `Not met this time. Aim for: ${round.label}`}
      </p>
    </section>
  )
}

/* -- small pieces ----------------------------------------------------------------- */

function challengeStatus(c: NonNullable<RoundResult['awards']['challenge']>): string {
  if (c.completed) return c.mastered ? `Level ${c.level} complete · all levels done` : `Level ${c.level} complete`
  if (c.passed) return `Level ${c.level} · ${c.passes} of ${c.repeat} in a row`
  return `Level ${c.level} not met`
}

/** One dot per round a level needs in a row. */
function PassDots({ repeat, passes }: { repeat: number; passes: number }) {
  if (repeat <= 1) return null
  return (
    <span className="mt-1 flex justify-center gap-1" aria-label={`${passes} of ${repeat} rounds in a row`}>
      {Array.from({ length: repeat }, (_, i) => (
        <span key={i} className={cn('size-1.5 rounded-full', i < passes ? 'bg-jade-400' : 'bg-white/15')} />
      ))}
    </span>
  )
}

function Pill({ tone, children }: { tone: 'good' | 'warm' | 'muted'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
        tone === 'good' && 'bg-jade-500/15 text-jade-300',
        tone === 'warm' && 'bg-[#f5a25e]/15 text-[#f7bf8a]',
        tone === 'muted' && 'bg-white/8 text-mist',
      )}
    >
      {children}
    </span>
  )
}

function Callout({ tone, children }: { tone: 'ok' | 'work'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'anim-fade rounded-xl border px-3 py-2.5 text-[12.5px] leading-snug',
        tone === 'ok' ? 'border-[#fcd34d]/35 bg-[#fcd34d]/8 text-[#fde68a]' : 'border-[#f0a35e]/40 bg-[#f0a35e]/10 text-[#f5c08e]',
      )}
      role="status"
    >
      {children}
    </div>
  )
}

/** Counts up to `target` after `delay` ms; lands on the value at once when motion is reduced. */
function useCountUp(target: number, duration: number, delay = 0): number {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [value, setValue] = useState(reduced || typeof window === 'undefined' ? target : 0)
  useEffect(() => {
    if (reduced) {
      setValue(target)
      return
    }
    let raf = 0
    const begin = performance.now() + delay
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - begin) / duration))
      setValue(target * (1 - Math.pow(1 - t, 3)))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, delay, reduced])
  return value
}

