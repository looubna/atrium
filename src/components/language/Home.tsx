import { LEVELS, SCENE_WHO, languageById } from '@/data/language'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { Chapter, LanguageState, Objective, PracticeMode } from '@/modules/language/api'
import { Button } from '../ui/Button'
import { IconClose, IconMedal } from '../ui/Icon'
import {
  IconBooks,
  IconChatBubbles,
  IconCheck,
  IconChevronRight,
  IconFlame,
  IconGraduationCap,
  IconMic,
  IconPeople,
  IconPlus,
  IconSlow,
  SCENE_ICONS,
} from './icons'
import { ACCENT, ACCENT_TEXT, Bar, Card, SURFACE, ScreenHeader } from './shared'

/** The next objective in the plan: the first one not done yet. */
export function nextObjective(plan: Chapter[]): { chapter: Chapter; objective: Objective; index: number } | null {
  for (const chapter of plan) {
    const index = chapter.objectives.findIndex((o) => !o.done)
    if (index >= 0) return { chapter, objective: chapter.objectives[index], index }
  }
  return null
}

export type StartTalk = (pick: { objectiveId: string } | { scenarioId: string }) => void

/** The Center's front page: the plan to continue, scenes, the vocab coach and progress. */
export function Home({ state, busy, error, mode, slow, onMode, onSlow, onStart, onOpen, onSwitch, onAddLanguage, onRemove, onLeave }: {
  state: LanguageState
  busy: boolean
  error: string | null
  /** How conversations run: a role-play, or a tutor lesson that checks every answer. */
  mode: PracticeMode
  /** The partner speaks slowly. */
  slow: boolean
  onMode: (mode: PracticeMode) => void
  onSlow: (slow: boolean) => void
  onStart: StartTalk
  onOpen: (screen: 'plan' | 'vocab' | 'progress' | 'words') => void
  /** Carry on with another language already being learned. */
  onSwitch: (target: string) => void
  /** Start a new language. */
  onAddLanguage: () => void
  /** Stop learning a language (after the learner confirmed). */
  onRemove: (target: string) => void
  onLeave: () => void
}) {
  const target = languageById(state.profile?.target)
  const next = nextObjective(state.plan)
  const done = state.plan.reduce((n, c) => n + c.objectives.filter((o) => o.done).length, 0)
  const total = state.plan.reduce((n, c) => n + c.objectives.length, 0)
  const { progress, vocab } = state
  // Editing the language row: each chip gets a remove button, and removing asks first.
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  return (
    <div className="pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]">
      <ScreenHeader
        eyebrow="Language Center"
        title={`Speak ${target.name}`}
        onBack={onLeave}
        right={
          <span
            className="inline-flex h-10 items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 text-[13px] font-semibold text-chalk"
            title="Day streak"
            aria-label={`${progress.streak} day streak`}
          >
            <IconFlame width={16} height={16} className={progress.streak ? 'text-[#fbbf6b]' : 'text-faint'} />
            {progress.streak}
          </span>
        }
      />

      {/* Your languages: tap one to switch, or add another. */}
      <div className="-mt-1 mb-4 flex flex-wrap gap-2 px-4 sm:px-6" role="tablist" aria-label="Your languages">
        {state.languages.map((l) => {
          const info = languageById(l.id)
          const current = l.id === target.id
          return (
            <div key={l.id} className="relative">
              <button
                type="button"
                role="tab"
                aria-selected={current}
                disabled={busy}
                onClick={() => (editing ? setRemoving(l.id) : !current && onSwitch(l.id))}
                className={cn(
                  'flex h-10 items-center gap-2 rounded-full border pl-2 pr-3.5 text-[13px] font-medium transition-all',
                  current
                    ? 'border-jade-400/40 bg-jade-500/15 text-jade-400'
                    : 'border-white/10 bg-white/[0.04] text-mist hover:bg-white/[0.08] hover:text-chalk',
                  editing && 'pr-10',
                )}
              >
                <span className="text-[20px] leading-none" aria-hidden>{info.flag}</span>
                {info.name}
                {current && l.level && (
                  <span className="text-[11px] font-normal text-jade-400/70">
                    {LEVELS.find((v) => v.id === l.level)?.name}
                  </span>
                )}
                {l.native && (
                  <span className="text-[11px] font-normal opacity-70" title={`Taught in ${languageById(l.native).name}`}>
                    · in {languageById(l.native).name}
                  </span>
                )}
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={() => setRemoving(l.id)}
                  aria-label={`Remove ${info.name}`}
                  className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-[#e5484d]/15 text-[#fca5a5] transition-colors hover:bg-[#e5484d]/30"
                >
                  <IconClose width={13} height={13} />
                </button>
              )}
            </div>
          )
        })}
        {!editing && (
          <button
            type="button"
            onClick={onAddLanguage}
            disabled={busy}
            className="flex h-10 items-center gap-1.5 rounded-full border border-dashed border-white/15 px-3.5 text-[13px] font-medium text-mist transition-colors hover:border-jade-400/40 hover:text-jade-400"
          >
            <IconPlus width={15} height={15} aria-hidden />
            Add language
          </button>
        )}
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          aria-pressed={editing}
          className={cn(
            'h-10 rounded-full px-3.5 text-[13px] font-medium transition-colors',
            editing ? 'bg-jade-500 text-ink-900' : 'text-faint hover:text-chalk',
          )}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      <div className="grid gap-5 px-4 sm:px-6">
        {/* How to practise: every "Start" below follows this. */}
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Practice style" className="grid flex-1 grid-cols-2 gap-1 rounded-2xl border border-white/8 bg-white/[0.03] p-1">
            {([
              { id: 'roleplay', label: 'Role-play', Icon: IconPeople },
              { id: 'lesson', label: 'Tutor lesson', Icon: IconGraduationCap },
            ] as const).map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={mode === o.id}
                onClick={() => onMode(o.id)}
                className={cn(
                  'flex h-9 items-center justify-center gap-1.5 rounded-xl text-[12.5px] font-medium transition-all',
                  mode === o.id ? 'bg-jade-500/15 text-jade-400' : 'text-mist hover:text-chalk',
                )}
              >
                <o.Icon width={16} height={16} aria-hidden />
                {o.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={slow}
            onClick={() => onSlow(!slow)}
            title="Your partner speaks slowly"
            className={cn(
              'flex h-[46px] shrink-0 items-center gap-1.5 rounded-2xl border px-3 text-[12.5px] font-medium transition-all',
              slow ? 'border-jade-400/40 bg-jade-500/12 text-jade-400' : 'border-white/8 bg-white/[0.03] text-mist hover:text-chalk',
            )}
          >
            <IconSlow width={16} height={16} aria-hidden />
            Slow
          </button>
        </div>
        <p className="-mt-3 text-[11.5px] leading-relaxed text-faint">
          {mode === 'lesson'
            ? 'Your tutor teaches the phrases one by one and checks every answer. Wrong answers are corrected, never waved through.'
            : 'Act out the scene with your partner. Tips appear beside what you say.'}
        </p>

        {error && <p className="rounded-xl bg-[#e5484d]/12 px-3.5 py-2.5 text-[12.5px] text-[#fca5a5]">{error}</p>}

        {/* The plan: the next objective, one tap to start it. */}
        {next ? (
          <div
            className="relative overflow-hidden rounded-3xl border border-white/8 p-5"
            style={{ background: `radial-gradient(120% 100% at 0% 0%, ${ACCENT}26, transparent 55%), ${SURFACE}` }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="eyebrow truncate" style={{ color: ACCENT_TEXT }}>
                Chapter {state.plan.indexOf(next.chapter) + 1} · {next.chapter.title}
              </span>
              <span className="shrink-0 text-[11.5px] font-medium text-mist">{done + 1} of {total}</span>
            </div>
            <h2 className="mt-2 text-[20px] font-semibold leading-snug tracking-tight text-chalk">{next.objective.title}</h2>
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-mist">{next.objective.goal}</p>
            <Bar value={total ? done / total : 0} className="mt-4" />
            <div className="mt-5 flex gap-2">
              <Button
                variant="primary"
                className="h-[46px] flex-1 rounded-2xl text-[14px]"
                disabled={busy}
                onClick={() => onStart({ objectiveId: next.objective.id })}
              >
                <IconMic width={18} height={18} aria-hidden />
                {busy ? 'Starting…' : mode === 'lesson' ? 'Start lesson' : 'Start talking'}
              </Button>
              <Button className="h-[46px] rounded-2xl px-5" onClick={() => onOpen('plan')}>
                Plan
              </Button>
            </div>
          </div>
        ) : (
          <Card onClick={() => onOpen('plan')}>
            <div className="flex items-center gap-3">
              <IconMedal width={22} height={22} style={{ color: ACCENT }} />
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-chalk">Plan complete</div>
                <div className="text-[12px] text-mist">Every objective done. Keep going with the scenarios below.</div>
              </div>
              <IconChevronRight width={16} height={16} className="text-faint" />
            </div>
          </Card>
        )}

        {/* Stats, each opening its own page. */}
        <div className="grid grid-cols-3 gap-2">
          <Stat label={`Level ${progress.level}`} value={`${progress.into}/${progress.of} XP`} bar={progress.into / progress.of} onClick={() => onOpen('progress')} />
          <Stat label="Words" value={String(vocab.total)} onClick={() => onOpen('vocab')} />
          <Stat label="Talks" value={String(progress.history.length)} onClick={() => onOpen('progress')} />
        </div>

        {/* The vocab coach and word lists, side by side. */}
        <div className="grid grid-cols-2 gap-2">
          <Tool
            Icon={IconBooks}
            title="Vocab coach"
            detail={vocab.total === 0 ? 'Your words land here' : vocab.due > 0 ? `${vocab.due} to review` : 'All caught up'}
            badge={vocab.due > 0 ? vocab.due : undefined}
            onClick={() => onOpen('vocab')}
          />
          <Tool Icon={IconChatBubbles} title="Word lists" detail="Any topic" onClick={() => onOpen('words')} />
        </div>

        {/* Ready-made scenes. */}
        <section>
          <div className="mb-2.5 flex items-baseline justify-between">
            <h2 className="text-[16px] font-semibold text-chalk">Scenarios</h2>
            <span className="text-[12px] text-faint">{state.scenarios.length} scenes</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {state.scenarios.map((s) => {
              const SceneIcon = SCENE_ICONS[s.icon] ?? IconChatBubbles
              return (
              <button
                key={s.id}
                type="button"
                disabled={busy}
                onClick={() => onStart({ scenarioId: s.id })}
                className="flex min-h-[7rem] flex-col justify-between rounded-[18px] border border-white/8 p-3.5 text-left transition-colors hover:border-jade-400/30 active:scale-[0.99] disabled:opacity-50"
                style={{ background: SURFACE }}
              >
                <span className="grid size-[38px] place-items-center rounded-xl bg-white/[0.06] text-jade-400" aria-hidden>
                  <SceneIcon width={20} height={20} />
                </span>
                <span className="mt-3 block">
                  <span className="block text-[13.5px] font-semibold leading-snug text-chalk">{s.title}</span>
                  {SCENE_WHO[s.id] && <span className="mt-0.5 block text-[11.5px] text-faint">{SCENE_WHO[s.id]}</span>}
                </span>
              </button>
              )
            })}
          </div>
        </section>
      </div>

      {removing && (
        <RemoveLanguage
          name={languageById(removing).name}
          words={removing === target.id ? vocab.total : null}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            onRemove(removing)
            setRemoving(null)
            setEditing(false)
          }}
        />
      )}
    </div>
  )
}

/** Removing a language cannot be undone: say what goes, what stays, and ask. */
function RemoveLanguage({ name, words, onCancel, onConfirm }: {
  name: string
  words: number | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-label={`Remove ${name}?`}
        onClick={(e) => e.stopPropagation()}
        className="glass anim-rise w-full max-w-sm rounded-3xl p-5"
      >
        <h2 className="text-[17px] font-semibold text-chalk">Remove {name}?</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mist">
          Its plan, {words ? `your ${words} saved word${words === 1 ? '' : 's'}` : 'saved words'} and conversation
          history are deleted. Your XP, level and streak stay. This can't be undone.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button className="h-11" onClick={onCancel}>Cancel</Button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-11 rounded-xl bg-[#e5484d] text-[13px] font-semibold text-white transition-colors hover:bg-[#d13d42]"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

/** A two-up tile on the home page: an icon, a name, a line of detail. */
function Tool({ Icon, title, detail, badge, onClick }: {
  Icon: typeof IconBooks
  title: string
  detail: string
  badge?: number
  onClick: () => void
}) {
  return (
    <Card onClick={onClick} className="rounded-[18px] p-3.5">
      <div className="flex items-center justify-between">
        <span className="grid size-10 place-items-center rounded-xl bg-jade-500/14 text-jade-400" aria-hidden>
          <Icon width={20} height={20} />
        </span>
        {badge !== undefined && (
          <span className="rounded-full bg-jade-500 px-2 py-0.5 text-[11.5px] font-semibold text-ink-900">{badge}</span>
        )}
      </div>
      <div className="mt-2.5 text-[14px] font-semibold text-chalk">{title}</div>
      <div className="text-[12px] text-mist">{detail}</div>
    </Card>
  )
}

function Stat({ label, value, bar, onClick }: { label: string; value: string; bar?: number; onClick: () => void }) {
  return (
    <Card onClick={onClick} className="p-3">
      <div className="text-[11px] font-medium text-faint">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-chalk">{value}</div>
      {bar !== undefined && <Bar value={bar} className="mt-2" />}
    </Card>
  )
}

/** The plan: chapters of objectives, as a path. */
export function PlanView({ state, busy, onStart, onBack }: {
  state: LanguageState
  busy: boolean
  onStart: StartTalk
  onBack: () => void
}) {
  const next = nextObjective(state.plan)
  return (
    <div className="pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]">
      <ScreenHeader eyebrow="Your plan" title={`${languageById(state.profile?.target).name} goals`} onBack={onBack} />
      <div className="grid gap-6 px-4 sm:px-6">
        {state.plan.map((chapter, c) => (
          <section key={c}>
            <div className="eyebrow" style={{ color: ACCENT_TEXT }}>Chapter {c + 1}</div>
            <h2 className="mt-1 text-[16px] font-semibold text-chalk">{chapter.title}</h2>
            <ol className="relative mt-3 grid gap-3 pl-9">
              <span className="absolute bottom-4 left-[15px] top-4 w-px bg-white/10" aria-hidden />
              {chapter.objectives.map((o) => {
                const current = next?.objective.id === o.id
                return (
                  <li key={o.id} className="relative">
                    <span
                      className={cn(
                        'absolute -left-9 top-3 grid size-[31px] place-items-center rounded-full border text-[12px] font-semibold',
                        o.done ? 'border-transparent text-ink-900' : current ? 'bg-ink-900 text-chalk' : 'border-white/12 bg-ink-900 text-faint',
                      )}
                      style={o.done ? { background: ACCENT } : current ? { borderColor: ACCENT } : undefined}
                      aria-hidden
                    >
                      {o.done ? <IconCheck width={15} height={15} /> : o.id.slice(-1)}
                    </span>
                    <Card className={cn(current && 'bg-white/[0.07]')}>
                      <div className="text-[14px] font-semibold text-chalk">{o.title}</div>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-mist">{o.goal}</p>
                      <Button
                        variant={current ? 'primary' : 'ghost'}
                        className="mt-3 h-9"
                        disabled={busy}
                        onClick={() => onStart({ objectiveId: o.id })}
                      >
                        {o.done ? 'Practise again' : 'Start'}
                      </Button>
                    </Card>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  )
}

/** Level, streak, words and the history of conversations. */
export function ProgressView({ state, onFeedback, onBack }: {
  state: LanguageState
  onFeedback: (sessionId: string) => void
  onBack: () => void
}) {
  const { progress, vocab } = state
  return (
    <div className="pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]">
      <ScreenHeader eyebrow="Progress" title="How you're doing" onBack={onBack} />
      <div className="grid gap-4 px-4 sm:px-6">
        <Card>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[12px] text-faint">Level</div>
              <div className="text-[32px] font-semibold leading-none text-chalk">{progress.level}</div>
            </div>
            <div className="text-right text-[12px] text-mist">
              {progress.of - progress.into} XP to level {progress.level + 1}
            </div>
          </div>
          <Bar value={progress.into / progress.of} className="mt-3" />
        </Card>
        <div className="grid grid-cols-2 gap-2">
          <Card>
            <IconFlame width={20} height={20} className={progress.streak ? 'text-[#fb923c]' : 'text-faint'} />
            <div className="mt-2 text-[22px] font-semibold text-chalk">{progress.streak}</div>
            <div className="text-[12px] text-mist">day streak</div>
          </Card>
          <Card>
            <IconBooks width={20} height={20} style={{ color: ACCENT }} />
            <div className="mt-2 text-[22px] font-semibold text-chalk">{vocab.total}</div>
            <div className="text-[12px] text-mist">new words</div>
          </Card>
        </div>

        <section>
          <h2 className="mb-2.5 text-[15px] font-semibold text-chalk">History</h2>
          {progress.history.length === 0 ? (
            <p className="text-[13px] text-mist">Your conversations will show here once their feedback is ready.</p>
          ) : (
            <div className="grid gap-2">
              {progress.history.map((h) => (
                <Card key={h.sessionId} onClick={() => onFeedback(h.sessionId)}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-chalk">{h.title}</div>
                      <div className="mt-0.5 text-[11.5px] text-faint">
                        {new Date(h.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                        {h.newWords ? ` · ${h.newWords} new words` : ''}
                        {h.objectiveMet ? ' · objective done' : ''}
                      </div>
                    </div>
                    {typeof h.score === 'number' && (
                      <span className="text-[16px] font-semibold tabular-nums" style={{ color: ACCENT_TEXT }}>{h.score}</span>
                    )}
                    <IconChevronRight width={16} height={16} className="text-faint" />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
