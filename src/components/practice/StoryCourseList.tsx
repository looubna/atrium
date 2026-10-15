import { useEffect } from 'react'
import { DRILLS, STORY_COURSE, type DrillId } from '@/data/drills'
import { cn } from '@/lib/utils'
import { usePracticeProgress, type PracticeProgress } from '@/modules/practice/api'
import { IconCheck, IconChevronRight } from '../ui/Icon'

/**
 * Where each step of the Story Course stands for this user. Every step is open (the order is a
 * recommendation, marked by `next`); Tell It Again needs a story to retell first.
 */
export function storySteps(progress: PracticeProgress | null) {
  return STORY_COURSE.map((id, i) => {
    const drill = progress?.drills[id]
    const stars = drill?.challenges.filter((c) => c.done).length ?? 0
    const open = !progress || id !== 'story-retell' || Boolean(progress.story?.lastSeed)
    return { id, index: i, stars, rounds: drill?.rounds ?? 0, open }
  })
}

/** The Park's Story Course: its steps in order, what each asks, and how far the user has got. */
export function StoryCourseList({ onPick }: { onPick: (id: DrillId) => void }) {
  const progress = usePracticeProgress((s) => s.progress)
  const refresh = usePracticeProgress((s) => s.refresh)
  useEffect(() => {
    void refresh()
  }, [refresh])
  const steps = storySteps(progress)
  // The recommended next step: the first one not yet passed.
  const next = steps.find((s) => s.open && s.stars === 0)?.id

  return (
    <ol className="flex flex-col gap-1.5" aria-label="Story Course">
      {steps.map((step) => {
        const drill = DRILLS[step.id]
        const signature = step.index === STORY_COURSE.length - 1
        return (
          <li key={step.id}>
            <button
              type="button"
              disabled={!step.open}
              onClick={() => onPick(step.id)}
              className={cn(
                'group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200',
                step.open
                  ? 'border-white/8 bg-white/4 hover:border-jade-400/40 hover:bg-jade-500/10 active:scale-[0.99]'
                  : 'cursor-not-allowed border-white/5 bg-white/[0.02] opacity-55',
                step.id === next && 'border-jade-400/45 bg-jade-500/10',
              )}
            >
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold tabular-nums',
                  step.stars > 0 ? 'bg-jade-400 text-ink-900' : 'bg-white/10 text-chalk',
                )}
                aria-hidden
              >
                {step.stars > 0 ? <IconCheck width={13} height={13} /> : signature ? '★' : step.index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-chalk">{drill.title}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-faint">
                  {step.open ? drill.goal : 'Tell any story in another step first: this one retells it'}
                </span>
              </span>
              {step.stars > 0 && (
                <span className="shrink-0 text-[11px] tracking-[0.1em] text-[#f5d58e]" aria-label={`${step.stars} of 3 levels`}>
                  {'★'.repeat(step.stars)}
                  <span className="text-white/15">{'★'.repeat(3 - step.stars)}</span>
                </span>
              )}
              {step.open && (
                <IconChevronRight width={15} height={15} className="shrink-0 text-faint transition-colors group-hover:text-jade-400" />
              )}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
