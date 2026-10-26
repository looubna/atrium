import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { ApiError } from '@/platform/api/client'
import { firebase, firebaseConfigured } from '@/platform/firebase'
import { useLiveDocument } from '@/platform/firestore/live'
import { RoundGuide } from './RoundGuide'
import {
  ROUND_TYPES,
  editBlueprint,
  generateBlueprint,
  getBlueprint,
  roundTypeLabel,
  type Blueprint,
  type BlueprintRound,
  type RoundEdit,
} from '../api'

const CONFIDENCE: Record<string, { label: string; className: string }> = {
  high: { label: 'High confidence', className: 'bg-jade-500/15 text-jade-400' },
  medium: { label: 'Medium confidence', className: 'bg-[#fcd34d]/12 text-[#fcd34d]' },
  low: { label: 'Low confidence', className: 'bg-white/8 text-faint' },
}

const field =
  'h-8 min-w-0 rounded-lg border border-white/8 bg-white/4 px-2 text-[12px] text-chalk outline-none focus:border-jade-400/40'

function RoundCard({
  round,
  names,
  sources,
  onChoose,
  onPrepare,
}: {
  round: BlueprintRound
  names: Record<string, string>
  sources: Map<string, string>
  onChoose: () => void
  onPrepare: () => void
}) {
  const [open, setOpen] = useState(false)
  const confidence = CONFIDENCE[round.confidence] ?? CONFIDENCE.low
  const focus = round.competencyIds.slice(0, 3).map((id) => names[id] ?? id)
  return (
    <li className="rounded-xl border border-white/8 bg-white/4 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <div className="eyebrow">Round {round.order}</div>
          <div className="mt-0.5 truncate text-[13px] font-semibold text-chalk">{round.title}</div>
          <div className="mt-0.5 text-[11px] text-mist">
            {roundTypeLabel(round.type, round.customLabel)}
            {round.format ? ` · ${round.format}` : ''}
            {round.durationMin ? ` · ~${round.durationMin} min` : ''}
          </div>
          {focus.length > 0 && <div className="mt-1 truncate text-[11px] text-faint">Focus: {focus.join(', ')}</div>}
        </button>
        <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium', confidence.className)}>
          {confidence.label}
        </span>
      </div>
      {open && (
        <div className="mt-2 space-y-1.5 border-t border-white/8 pt-2 text-[11.5px] leading-relaxed text-mist">
          {round.rationale && <p>{round.rationale}</p>}
          {round.questionFamilies.length > 0 && (
            <p>
              <span className="text-chalk">Likely question areas: </span>
              {round.questionFamilies.map((f) => f.name).join(', ')}
            </p>
          )}
          {round.reportedQuestions.length > 0 && (
            <div>
              <div className="text-chalk">Reported by candidates</div>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {round.reportedQuestions.map((q) => (
                  <li key={q.text}>
                    {q.text}{' '}
                    <span className="text-faint">({q.sourceIds.map((s) => sources.get(s) ?? s).join(', ')})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {round.resumeFocus.length > 0 && (
            <p>
              <span className="text-chalk">From your resume: </span>
              {round.resumeFocus.join('; ')}
            </p>
          )}
        </div>
      )}
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Button variant="ghost" className="h-8 text-[12px]" onClick={onPrepare}>
          Questions & ideas
        </Button>
        <Button variant="primary" className="h-8 text-[12px]" onClick={onChoose}>
          Practise this round
        </Button>
      </div>
    </li>
  )
}

function Editor({
  blueprint,
  onCancel,
  onSaved,
}: {
  blueprint: Blueprint
  onCancel: () => void
  onSaved: (next: Blueprint) => void
}) {
  const [rounds, setRounds] = useState<RoundEdit[]>(() =>
    (blueprint.rounds ?? []).map((r) => ({
      id: r.id,
      type: r.type,
      customLabel: r.customLabel,
      title: r.title,
      format: r.format,
      durationMinutes: r.durationMin ?? 0,
    })),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (index: number, patch: Partial<RoundEdit>) =>
    setRounds((all) => all.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  const move = (index: number, delta: number) =>
    setRounds((all) => {
      const target = index + delta
      if (target < 0 || target >= all.length) return all
      const next = [...all]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const save = async (applicationId: string) => {
    setSaving(true)
    setError(null)
    try {
      onSaved(await editBlueprint(applicationId, blueprint, rounds))
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 412
          ? 'This journey changed elsewhere. Close the editor and try again.'
          : err instanceof ApiError
            ? err.message
            : 'Could not save your changes.',
      )
    } finally {
      setSaving(false)
    }
  }

  return { rounds, saving, error, update, move, setRounds, save, onCancel }
}

function EditPanel({
  applicationId,
  blueprint,
  onCancel,
  onSaved,
}: {
  applicationId: string
  blueprint: Blueprint
  onCancel: () => void
  onSaved: (next: Blueprint) => void
}) {
  const editor = Editor({ blueprint, onCancel, onSaved })
  return (
    <div className="mt-2">
      <ol className="flex flex-col gap-2">
        {editor.rounds.map((round, index) => (
          <li key={round.id ?? `new-${index}`} className="rounded-xl border border-white/8 bg-white/4 p-2">
            <div className="flex items-center gap-1.5">
              <span className="w-5 text-center text-[11px] tabular-nums text-faint">{index + 1}</span>
              <input
                aria-label="Round title"
                value={round.title}
                maxLength={100}
                onChange={(e) => editor.update(index, { title: e.target.value })}
                className={cn(field, 'flex-1')}
              />
              <button type="button" aria-label="Move up" onClick={() => editor.move(index, -1)} className="px-1 text-mist hover:text-chalk">
                ↑
              </button>
              <button type="button" aria-label="Move down" onClick={() => editor.move(index, 1)} className="px-1 text-mist hover:text-chalk">
                ↓
              </button>
              <button
                type="button"
                aria-label="Remove round"
                disabled={editor.rounds.length <= 1}
                onClick={() => editor.setRounds((all) => all.filter((_, i) => i !== index))}
                className="px-1 text-[#fca5a5] disabled:opacity-30"
              >
                ✕
              </button>
            </div>
            <div className="mt-1.5 flex gap-1.5 pl-6">
              <select
                aria-label="Round type"
                value={round.type}
                onChange={(e) => editor.update(index, { type: e.target.value })}
                className={cn(field, 'flex-1')}
              >
                {ROUND_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                aria-label="Duration in minutes"
                type="number"
                min={0}
                max={240}
                value={round.durationMinutes ?? 0}
                onChange={(e) => editor.update(index, { durationMinutes: Math.max(0, Math.min(240, Number(e.target.value) || 0)) })}
                className={cn(field, 'w-16')}
              />
              <span className="self-center text-[11px] text-faint">min</span>
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        disabled={editor.rounds.length >= 12}
        onClick={() => editor.setRounds((all) => [...all, { type: 'behavioral', title: 'New round', durationMinutes: 30 }])}
        className="mt-2 text-[12px] text-mist underline hover:text-chalk disabled:opacity-40"
      >
        Add a round
      </button>
      {editor.error && <p className="mt-2 text-[12px] text-[#fca5a5]">{editor.error}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={editor.saving} onClick={() => void editor.save(applicationId)}>
          {editor.saving ? 'Saving…' : 'Save journey'}
        </Button>
      </div>
    </div>
  )
}

type StepState = 'waiting' | 'active' | 'done'

/**
 * The journey taking shape, streamed from the strategist: what it searched,
 * the sites it found, its notes, then each round as soon as it is written.
 * Nothing here is final until the journey has been checked.
 */
function JourneyProgress({
  blueprint,
  company,
  error,
}: {
  blueprint: Blueprint | null
  company: string
  error: string | null
}) {
  const progress = blueprint?.progress
  const stage = blueprint?.status === 'ready' ? 'done' : (progress?.stage ?? 'starting')
  const researching = stage === 'starting' || stage === 'research'
  const steps: { label: string; state: StepState }[] = [
    { label: `Researching ${company || 'the company'} and the role`, state: researching ? 'active' : 'done' },
    {
      label: stage === 'repair' ? 'Refining your interview rounds' : 'Drafting your interview rounds',
      state: researching ? 'waiting' : stage === 'done' ? 'done' : 'active',
    },
    { label: 'Checking sources and confidence', state: stage === 'done' ? 'active' : 'waiting' },
  ]
  const domains = [...new Set((progress?.sources ?? []).map((s) => s.domain))].slice(0, 8)
  const queries = (progress?.queries ?? []).slice(-3)
  const rounds = progress?.rounds ?? []
  const notes = progress?.notes ?? ''

  return (
    <div className="mt-3 rounded-xl border border-white/8 bg-white/4 px-3 py-3" aria-live="polite">
      <ol className="space-y-1.5">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-2 text-[12.5px]">
            <span
              className={cn(
                'size-2 shrink-0 rounded-full',
                step.state === 'done' && 'bg-jade-400',
                step.state === 'active' && 'animate-pulse bg-jade-400',
                step.state === 'waiting' && 'bg-white/15',
              )}
            />
            <span className={step.state === 'waiting' ? 'text-faint' : 'text-chalk'}>
              {step.label}
              {step.state === 'active' ? '…' : ''}
            </span>
          </li>
        ))}
      </ol>

      {progress?.busy && stage !== 'done' && (
        <p className="mt-2.5 flex items-center gap-2 text-[11.5px] text-[#fcd34d]" role="status">
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[#fcd34d]" />
          The AI service is busy right now — retrying automatically…
        </p>
      )}
      {queries.length > 0 && (
        <p className="mt-2.5 text-[11px] leading-relaxed text-faint">
          Searched {queries.map((q) => `“${q}”`).join(' · ')}
        </p>
      )}
      {domains.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {domains.map((domain) => (
            <span key={domain} className="anim-fade rounded-md bg-white/6 px-1.5 py-0.5 text-[10.5px] text-mist">
              {domain}
            </span>
          ))}
        </div>
      )}
      {researching && notes && (
        <p className="mt-2 line-clamp-4 text-[11px] leading-relaxed text-mist">
          {notes.length > 360 ? `…${notes.slice(-360)}` : notes}
        </p>
      )}

      {progress?.summary && !researching && (
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-mist">{progress.summary}</p>
      )}
      {!researching && (
        <ol className="mt-2 flex flex-col gap-1.5">
          {rounds.map((round, index) => {
            const confidence = CONFIDENCE[round.confidence] ?? CONFIDENCE.low
            return (
              <li key={`${index}-${round.title}`} className="anim-fade rounded-lg border border-white/8 bg-white/4 px-2.5 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="eyebrow">Round {round.order || index + 1}</div>
                    <div className="truncate text-[12.5px] font-semibold text-chalk">{round.title}</div>
                    <div className="truncate text-[11px] text-mist">
                      {roundTypeLabel(round.type, round.customLabel)}
                      {round.format ? ` · ${round.format}` : ''}
                      {round.durationMin ? ` · ~${round.durationMin} min` : ''}
                    </div>
                  </div>
                  <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium', confidence.className)}>
                    {confidence.label}
                  </span>
                </div>
              </li>
            )
          })}
          {stage !== 'done' && (
            <li className="h-12 animate-pulse rounded-lg border border-dashed border-white/10" aria-hidden />
          )}
        </ol>
      )}

      {!progress && (
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Looking at the job, your resume and what candidates report about this interview process.
        </p>
      )}
      {error && <p className="mt-2 text-[12px] text-[#fca5a5]">{error}</p>}
    </div>
  )
}

/**
 * "Your likely interview journey": the rounds Agent 1 predicted for this
 * application, with evidence and confidence. The user can correct the journey
 * before choosing a round to practise.
 */
export function JourneyReview({
  applicationId,
  blueprintId,
  company,
  onBlueprintChange,
  onChoose,
}: {
  applicationId: string
  blueprintId: string
  company: string
  onBlueprintChange: (blueprintId: string) => void
  onChoose: (blueprint: Blueprint, round: BlueprintRound) => void
}) {
  const [saved, setSaved] = useState<Blueprint | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [retrying, setRetrying] = useState(false)
  // The round whose preparation guide is open, if any.
  const [preparing, setPreparing] = useState<BlueprintRound | null>(null)

  // The journey document, live: progress appears the moment the strategist writes it.
  const uid = firebaseConfigured() ? firebase().auth.currentUser?.uid : undefined
  const live = useLiveDocument<Blueprint>(
    uid ? `users/${uid}/applications/${applicationId}/blueprints/${blueprintId}` : null,
    () => getBlueprint(applicationId, blueprintId),
    { keepPolling: (b) => !b || b.status === 'queued' || b.status === 'researching' },
  )

  // Once ready, the API view adds competency names for the round cards.
  useEffect(() => {
    if (live?.status !== 'ready') return
    let cancelled = false
    getBlueprint(applicationId, blueprintId)
      .then((next) => {
        if (!cancelled) setSaved(next)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your interview journey.')
      })
    return () => {
      cancelled = true
    }
  }, [live?.status, applicationId, blueprintId])

  const blueprint = saved?.id === blueprintId ? saved : live

  const retry = async () => {
    setRetrying(true)
    try {
      const { blueprintId: next } = await generateBlueprint(applicationId)
      onBlueprintChange(next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start again.')
    } finally {
      setRetrying(false)
    }
  }

  const inProgress = !blueprint || blueprint.status === 'queued' || blueprint.status === 'researching'
  if (inProgress || (blueprint.status === 'ready' && saved?.id !== blueprintId)) {
    return <JourneyProgress blueprint={blueprint} company={company} error={error} />
  }

  if (blueprint.status === 'failed') {
    return (
      <div className="mt-3 rounded-xl border border-white/8 bg-white/4 px-3 py-3">
        <p className="text-[12.5px] text-chalk">We couldn&rsquo;t build this interview journey.</p>
        {error && <p className="mt-1 text-[12px] text-[#fca5a5]">{error}</p>}
        <Button variant="primary" className="mt-2 w-full" disabled={retrying} onClick={() => void retry()}>
          {retrying ? 'Starting…' : 'Try again'}
        </Button>
      </div>
    )
  }

  const sources = new Map((blueprint.sources ?? []).map((s) => [s.id, s.domain]))
  const prepared = preparing && blueprint.rounds?.find((r) => r.id === preparing.id)
  if (prepared) {
    return (
      <RoundGuide
        applicationId={applicationId}
        blueprintId={blueprint.id}
        round={prepared}
        onBack={() => setPreparing(null)}
        onPractise={() => onChoose(blueprint, prepared)}
      />
    )
  }

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow">Your likely interview journey</div>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-[11.5px] text-mist underline hover:text-chalk">
            Edit
          </button>
        )}
      </div>
      {blueprint.processSummary && <p className="mt-1 text-[11.5px] leading-relaxed text-mist">{blueprint.processSummary}</p>}
      {blueprint.modelAttribution?.provider === 'Nebius Token Factory' && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[#76b900]/25 bg-[#76b900]/8 px-2 py-1 text-[10px] font-medium text-[#b6e36b]">
          NVIDIA Nemotron · Nebius Token Factory
        </div>
      )}

      {editing ? (
        <EditPanel
          applicationId={applicationId}
          blueprint={blueprint}
          onCancel={() => setEditing(false)}
          onSaved={(next) => {
            setEditing(false)
            setSaved(next)
            onBlueprintChange(next.id)
          }}
        />
      ) : (
        <ol className="mt-2 flex flex-col gap-2">
          {(blueprint.rounds ?? []).map((round) => (
            <RoundCard
              key={round.id}
              round={round}
              names={blueprint.competencyNames ?? {}}
              sources={sources}
              onChoose={() => onChoose(blueprint, round)}
              onPrepare={() => setPreparing(round)}
            />
          ))}
        </ol>
      )}

      {(blueprint.sources?.length ?? 0) > 0 && (
        <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
          Sources: {(blueprint.sources ?? []).map((s) => s.domain).join(', ')}. Predictions, not guarantees — processes
          vary by team and change over time.
        </p>
      )}
      {blueprint.caveats?.map((caveat) => (
        <p key={caveat} className="mt-1 text-[10.5px] text-faint">
          {caveat}
        </p>
      ))}
      {blueprint.searchSuggestionsHtml && (
        // Google Search suggestions must be shown with grounded results; isolated from the app.
        <iframe
          title="Google Search suggestions"
          sandbox=""
          srcDoc={blueprint.searchSuggestionsHtml}
          className="mt-2 h-16 w-full rounded-lg border border-white/8 bg-white"
        />
      )}
    </div>
  )
}
