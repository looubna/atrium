import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { usePracticeProgress } from '@/modules/practice/api'
import { IconChevronRight, IconFlame, IconMedal, IconTarget } from '../ui/Icon'

/**
 * The Practice Center's progress at a glance: streak, level, today's optional
 * challenge and the few achievements. Everything here is optional — the rest of
 * the city never depends on it.
 */
export function PracticeHeader({ onOpenDrill }: { onOpenDrill: (drillId: string) => void }) {
  const progress = usePracticeProgress((s) => s.progress)
  const refresh = usePracticeProgress((s) => s.refresh)

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!progress) return null
  const { streak, today } = progress
  const earned = progress.achievements.filter((a) => a.earnedOn).length

  return (
    <div className="anim-fade mt-3 flex flex-col gap-2" aria-label="Your practice progress">
      <div className="flex items-stretch gap-2">
        <div
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/8 bg-white/4 px-2.5 py-1.5"
          title={streak.best > 0 ? `Best streak: ${streak.best} day${streak.best === 1 ? '' : 's'}` : 'Practise on consecutive days to build a streak'}
        >
          <IconFlame width={15} height={15} className={streak.current > 0 ? 'text-[#f5a25e]' : 'text-faint'} />
          <span className="text-[12px] font-semibold tabular-nums text-chalk">{streak.current}</span>
          <span className="text-[11px] text-faint">day{streak.current === 1 ? '' : 's'}</span>
        </div>
        <div className="min-w-0 flex-1 rounded-xl border border-white/8 bg-white/4 px-2.5 py-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] font-semibold text-chalk">Level {progress.level}</span>
            <span className="text-[10.5px] tabular-nums text-faint">
              {progress.levelXp} / {progress.levelSpan} XP
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/8" aria-hidden>
            <div
              className="h-full rounded-full bg-jade-500 transition-[width] duration-500"
              style={{ width: `${Math.min(100, (100 * progress.levelXp) / Math.max(1, progress.levelSpan))}%` }}
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onOpenDrill(today.drillId)}
        className={cn(
          'group flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all duration-200 active:scale-[0.99]',
          today.done ? 'border-jade-400/30 bg-jade-500/8' : 'border-white/8 bg-white/4 hover:border-jade-400/40 hover:bg-jade-500/10',
        )}
      >
        <IconTarget width={15} height={15} className="shrink-0 text-jade-400" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
            Today’s challenge · optional{today.done ? ' · done' : ''}
          </div>
          <div className="truncate text-[12px] font-medium text-chalk">
            {today.title} · Level {today.level}
          </div>
          <div className="truncate text-[11px] text-mist">{today.label}</div>
        </div>
        <IconChevronRight width={14} height={14} className="shrink-0 text-faint transition-colors group-hover:text-jade-400" />
      </button>

      <div className="flex items-center gap-1.5" aria-label={`${earned} of ${progress.achievements.length} achievements`}>
        {progress.achievements.map((a) => (
          <span
            key={a.id}
            title={`${a.title} — ${a.description}${a.earnedOn ? ` (earned ${a.earnedOn})` : ''}`}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10.5px]',
              a.earnedOn ? 'bg-[#f5d58e]/10 text-[#f5d58e]' : 'bg-white/4 text-faint/60',
            )}
          >
            <IconMedal width={12} height={12} />
            <span className={a.earnedOn ? '' : 'sr-only'}>{a.title}</span>
          </span>
        ))}
        <span className="ml-auto text-[10.5px] text-faint">
          {earned}/{progress.achievements.length}
        </span>
      </div>
    </div>
  )
}
