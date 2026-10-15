import type { StoryArc } from '@/modules/practice/api'
import { IconCheck, IconTarget } from '../ui/Icon'

/**
 * The shape of the story just told, in the three language curves of Boyd, Blackburn & Pennebaker's
 * narrative arc (Science Advances, 2020). Each curve counts one kind of word in each fifth of the
 * story, relative to the story's own average. Each has its own ideal shape — they are not meant to
 * all go up — so every chart draws the user's line against that ideal, and says in words what the
 * words are, what the shape means and what to do about it.
 */
const CURVES: {
  key: keyof StoryArc
  title: string
  counts: string
  /** The shape strong stories share, as a line (same scale: 1 = the story's average). */
  ideal: number[]
  shape: string
  good: (v: number[]) => boolean
  yes: string
  no: string
}[] = [
  {
    key: 'staging',
    title: 'Setting the scene',
    counts: 'Words that place the listener: “the”, “a”, “in”, “at”, “on”, “behind”…',
    ideal: [1.5, 1.1, 0.9, 0.8, 0.7],
    shape: 'Should start HIGH and go DOWN: set the scene first, then leave it behind.',
    good: (v) => v[0] >= 1.1 && v[0] >= Math.max(...v.slice(2)),
    yes: 'You set the scene at the start, then moved on. Good.',
    no: 'Your scene-setting comes too late or is spread out. Open with who, where and when in the first lines.',
  },
  {
    key: 'progression',
    title: 'Moving the action',
    counts: 'Words that push events forward: “I”, “she”, “was”, “had”, “then”, “suddenly”…',
    ideal: [0.8, 0.9, 1.0, 1.1, 1.2],
    shape: 'Should go UP: more and more happening as the story goes on.',
    good: (v) => v[3] + v[4] >= v[0] + v[1],
    yes: 'The action builds towards the end. Good.',
    no: 'The action slows down near the end. Make each moment lead to the next, faster, as you near the climax.',
  },
  {
    key: 'tension',
    title: 'Building tension',
    counts: 'Words of doubt and struggle: “but”, “because”, “maybe”, “I thought”, “I wondered”…',
    ideal: [0.6, 0.8, 1.0, 1.4, 1.2],
    shape: 'Should rise and PEAK LATE, just before the end: the hardest moment comes last.',
    good: (v) => v.indexOf(Math.max(...v)) >= 3,
    yes: 'Your tension peaks late, just before the resolution. Good.',
    no: 'Your tension peaks too early. Hold the hardest moment and the biggest doubt back until near the end.',
  },
]

const PARTS = ['Start', 'Early', 'Middle', 'Late', 'End']
const W = 170
const H = 64
const PAD = 7

function Spark({ values, ideal, label }: { values: number[]; ideal: number[]; label: string }) {
  const top = Math.max(2, ...values, ...ideal)
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (values.length - 1)
  const y = (v: number) => H - PAD - (v / top) * (H - 2 * PAD)
  const line = (vs: number[]) => vs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full" role="img" aria-label={label}>
      <path d={line(ideal)} fill="none" stroke="currentColor" className="text-white/35" strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" />
      <path d={line(values)} fill="none" stroke="#5fd6de" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <g key={i}>
          {/* A hit target bigger than the mark; the native tooltip reads the value. */}
          <circle cx={x(i)} cy={y(v)} r={9} fill="transparent">
            <title>{`${PARTS[i]} of your story: ${v.toFixed(1)}× your average (ideal ${ideal[i].toFixed(1)}×)`}</title>
          </circle>
          <circle cx={x(i)} cy={y(v)} r={3} fill="#5fd6de" stroke="#0b1220" strokeWidth={2} pointerEvents="none" />
        </g>
      ))}
    </svg>
  )
}

export function StoryArcChart({ arc }: { arc: StoryArc }) {
  return (
    <section aria-label="The shape of your story" className="rounded-2xl border border-white/8 bg-white/[0.03] px-3.5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="eyebrow">The shape of your story</div>
        <div className="flex items-center gap-3 text-[10.5px] text-mist" aria-label="Legend">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-[#5fd6de]" aria-hidden />
            Your story
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-white/35" aria-hidden />
            Strong stories
          </span>
        </div>
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-mist">
        How to read it: each chart follows your story from the <span className="text-chalk">start (left)</span> to the{' '}
        <span className="text-chalk">end (right)</span>. Higher means you used more of that kind of word in that part of the
        story. The three lines are <span className="text-chalk">not meant to all go up</span> — each has its own best
        shape, drawn dashed. Try to make your line follow it.
      </p>

      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {CURVES.map((c) => {
          const values = arc[c.key]
          const ok = c.good(values)
          return (
            <figure key={c.key} className="min-w-0">
              <figcaption className="text-[12.5px] font-medium text-chalk">{c.title}</figcaption>
              <div className="mt-0.5 text-[10.5px] leading-snug text-faint">{c.counts}</div>
              <Spark
                values={values}
                ideal={c.ideal}
                label={`${c.title}: your story ${values.map((v) => v.toFixed(1)).join(', ')}; strong stories ${c.ideal.join(', ')}`}
              />
              <div className="flex justify-between text-[9.5px] text-faint" aria-hidden>
                <span>Start</span>
                <span>Middle</span>
                <span>End</span>
              </div>
              <p className="mt-1 text-[11px] font-medium leading-snug text-mist">{c.shape}</p>
              <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-snug text-mist">
                {ok ? (
                  <IconCheck width={13} height={13} className="mt-0.5 shrink-0 text-jade-400" aria-label="On track" />
                ) : (
                  <IconTarget width={13} height={13} className="mt-0.5 shrink-0 text-[#f5d58e]" aria-label="To work on" />
                )}
                <span className={ok ? '' : 'text-chalk'}>{ok ? c.yes : c.no}</span>
              </p>
            </figure>
          )
        })}
      </div>
      <p className="mt-3 text-[10.5px] leading-snug text-faint">
        Counted automatically from your words. The ideal shapes come from a study of 60,000 stories, novels and talks
        (Boyd, Blackburn &amp; Pennebaker, Science Advances, 2020).
      </p>
    </section>
  )
}
