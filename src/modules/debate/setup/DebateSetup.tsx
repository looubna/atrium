import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import {
  IconArrowLeft,
  IconBooks,
  IconCheck,
  IconChevronRight,
  IconClose,
  IconFile,
  IconLink,
  IconSettings,
  IconTarget,
  IconText,
  IconTimer,
  IconVideo,
} from '@/components/ui/Icon'
import type { PracticeFormat } from '@/data/practice'
import { DEBATE_DIFFICULTY_LABEL, DEBATE_FORMAT_LABEL } from '@/data/practice'
import type { Location } from '@/data/types'
import { cn } from '@/lib/utils'
import { AddMaterials, type MaterialDraft } from '@/modules/exam/setup/AddMaterials'
import {
  addDebateLink,
  addDebateText,
  createDebate,
  createDebateSession,
  deleteDebateMaterial,
  getDebate,
  listDebateMaterials,
  prepareDebate,
  suggestTopics,
  updateDebate,
  uploadDebateMaterial,
  type Debate,
  type DebateDifficulty,
  type DebateFormatId,
  type DebateMaterial,
  type DebatePosition,
  type DebatePositionMode,
  type TopicSuggestion,
} from '@/modules/debate/api'
import { ApiError } from '@/platform/api/client'
import { firebase, firebaseConfigured, NotSignedIn } from '@/platform/firebase'
import { useLiveCollection } from '@/platform/firestore/live'
import { useAppStore } from '@/state/useAppStore'

/**
 * Setting up a debate (§4, §32). The first screen asks one thing — what do you want to
 * debate — and offers the three ways to answer it:
 *
 *     [ I have a topic ]   [ Give me a topic ]   [ From my materials ]
 *
 * Everything else has a default that is already right, and lives behind "Debate settings"
 * for the people who want it. Nobody is made to configure a debate before having one.
 */

/** Long enough for an argument to develop, short enough to hold attention. */
const DEBATE_MINUTES = 15
const MIN_MINUTES = 5
const MAX_MINUTES = 60
const MINUTE_STEP = 5

/** `max_material_bytes` on the server. Checked here too: a refused upload should fail instantly. */
const MAX_FILE_BYTES = 40 * 1_048_576

type Way = 'topic' | 'suggest' | 'materials'

interface SetupProblem {
  text: string
  /** The fix is in the account sheet (sign in, consent, verify email). */
  account?: boolean
}

function describeProblem(error: unknown): SetupProblem {
  if (error instanceof NotSignedIn || (error instanceof ApiError && error.status === 401)) {
    return { text: 'Sign in to debate a live opponent.', account: true }
  }
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'consent_required':
        return { text: 'Allow recording and AI processing in your account first.', account: true }
      case 'email_not_verified':
        return { text: 'Verify your email address, then try again.', account: true }
      case 'trial_used':
        return { text: 'Your free minutes are used up. Choose a plan to keep practising.' }
      case 'quota_exceeded':
        return { text: "You've reached today's practice limit. It resets tomorrow." }
      case 'rate_limited':
        return { text: 'Too many attempts. Try again in a minute.' }
      case 'unsupported_media':
        return { text: "That file couldn't be read. PDF, PowerPoint, Word, text and photos all work." }
      case 'payload_too_large':
        return { text: 'That file is too large. Split it, or add the part you want to argue from.' }
      case 'unavailable':
        return { text: 'Debates are paused right now. Try again later.' }
      case 'bad_request':
        return { text: error.detail || error.message }
      default:
        return { text: error.message }
    }
  }
  if (error instanceof Error && error.message.includes('not configured')) {
    return { text: "Accounts aren't available in this build." }
  }
  return { text: 'Could not reach Atrium. Check your connection and try again.' }
}

const SOURCE_ICON = { file: IconFile, link: IconLink, text: IconText }

const optionIdle = 'border-white/8 bg-white/4 text-mist hover:bg-white/8 hover:text-chalk'
const optionActive = 'border-jade-400/40 bg-jade-500/15 text-jade-400'
const field =
  'w-full rounded-xl border border-white/8 bg-white/4 px-3 py-2.5 text-[12.5px] text-chalk outline-none ' +
  'placeholder:text-faint focus:border-jade-400/40'
const stepper =
  'grid size-8 place-items-center rounded-lg border border-white/10 bg-white/4 text-[16px] text-mist ' +
  'transition-colors hover:bg-white/8 hover:text-chalk disabled:opacity-40'

function StepHeader({ title, hint, onBack }: { title: string; hint: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/4 text-mist transition-colors hover:bg-white/8 hover:text-chalk"
      >
        <IconArrowLeft width={14} height={14} />
      </button>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[14px] font-semibold tracking-tight text-chalk">{title}</div>
        <div className="mt-0.5 text-[11px] text-faint">{hint}</div>
      </div>
    </div>
  )
}

function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 1,
}: {
  label: string
  value: T
  options: { id: T; label: string; note?: string }[]
  onChange: (value: T) => void
  columns?: 1 | 2
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('grid gap-1.5', columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}
    >
      {options.map((option) => {
        const active = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.id)}
            className={cn(
              'rounded-xl border px-3 py-2 text-left transition-all duration-200',
              active ? optionActive : optionIdle,
            )}
          >
            <span className="block text-[12.5px] font-medium leading-tight">{option.label}</span>
            {option.note && (
              <span className="mt-0.5 block text-[10.5px] leading-tight text-faint">{option.note}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="eyebrow mb-1.5">{title}</div>
      {children}
    </div>
  )
}

/** The three ways in. This is the whole of the first screen. */
function Ways({ onPick }: { onPick: (way: Way) => void }) {
  const ways: { id: Way; title: string; note: string; icon: typeof IconTarget }[] = [
    {
      id: 'topic',
      title: 'I have a topic',
      note: 'Type what you want to argue about',
      icon: IconTarget,
    },
    {
      id: 'suggest',
      title: 'Give me a topic',
      note: "We'll suggest motions worth arguing either side of",
      icon: IconBooks,
    },
    {
      id: 'materials',
      title: 'From my materials',
      note: 'An article, a paper, course notes — we find what can be argued',
      icon: IconFile,
    },
  ]
  return (
    <div className="mt-3 grid gap-1.5">
      {ways.map((way) => (
        <button
          key={way.id}
          type="button"
          onClick={() => onPick(way.id)}
          className="flex w-full items-start gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-2.5 text-left transition-all duration-200 hover:border-jade-400/40 hover:bg-jade-500/10 active:scale-[0.99]"
        >
          <span className="mt-0.5 shrink-0 text-jade-400">
            <way.icon width={15} height={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-chalk">{way.title}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-faint">{way.note}</span>
          </span>
          <IconChevronRight width={14} height={14} className="mt-1 shrink-0 text-faint" />
        </button>
      ))}
    </div>
  )
}

/** The advanced settings, folded away. Opening them is optional and always was (§5). */
function Settings({
  position,
  setPosition,
  positionMode,
  setPositionMode,
  format,
  setFormat,
  difficulty,
  setDifficulty,
  minutes,
  setMinutes,
  research,
  setResearch,
  camera,
  setCamera,
  willResearch,
}: {
  position: DebatePosition
  setPosition: (p: DebatePosition) => void
  positionMode: DebatePositionMode
  setPositionMode: (m: DebatePositionMode) => void
  format: DebateFormatId
  setFormat: (f: DebateFormatId) => void
  difficulty: DebateDifficulty
  setDifficulty: (d: DebateDifficulty) => void
  minutes: number
  setMinutes: (update: (m: number) => number) => void
  research: boolean | null
  setResearch: (value: boolean | null) => void
  camera: boolean
  setCamera: (on: boolean) => void
  willResearch: boolean | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-4 border-t border-white/8 pt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-center gap-2 text-left text-[12px] font-medium text-mist transition-colors hover:text-chalk"
      >
        <IconSettings width={14} height={14} className="text-faint" />
        Debate settings
        <IconChevronRight
          width={13}
          height={13}
          className={cn('ml-auto text-faint transition-transform', open && 'rotate-90')}
        />
      </button>
      {!open && (
        <p className="mt-1.5 text-[10.5px] leading-snug text-faint">
          {[
            positionMode === 'user'
              ? position === 'for'
                ? 'Arguing FOR'
                : 'Arguing AGAINST'
              : positionMode === 'random'
                ? 'Side decided at random'
                : 'We pick your side',
            DEBATE_FORMAT_LABEL[format],
            DEBATE_DIFFICULTY_LABEL[difficulty],
            `${minutes} min`,
          ].join(' · ')}
        </p>
      )}

      {open && (
        <div className="anim-fade">
          <Section title="Your position">
            <Choices
              label="Your position"
              value={positionMode === 'user' ? position : positionMode}
              options={[
                { id: 'for' as const, label: 'Argue FOR', note: 'You defend the motion' },
                { id: 'against' as const, label: 'Argue AGAINST', note: 'You oppose the motion' },
                {
                  id: 'assigned' as const,
                  label: 'Pick a side for me',
                  note: 'Good for arguing a case you did not choose',
                },
                {
                  id: 'random' as const,
                  label: 'Random',
                  note: 'Decided by a coin toss when the debate is prepared',
                },
              ]}
              onChange={(value) => {
                if (value === 'for' || value === 'against') {
                  setPositionMode('user')
                  setPosition(value)
                } else {
                  setPositionMode(value)
                }
              }}
              columns={2}
            />
            {positionMode !== 'user' && (
              <p className="mt-1.5 text-[10.5px] leading-snug text-faint">
                You may end up defending a position you disagree with. That is the point — it is the
                hardest and most useful thing to practise.
              </p>
            )}
          </Section>

          <Section title="Style">
            <Choices
              label="Style"
              value={format}
              options={[
                { id: 'free', label: DEBATE_FORMAT_LABEL.free, note: 'A natural back-and-forth' },
                {
                  id: 'structured',
                  label: DEBATE_FORMAT_LABEL.structured,
                  note: 'Opening, rebuttal, counterargument, closing',
                },
                {
                  id: 'socratic',
                  label: DEBATE_FORMAT_LABEL.socratic,
                  note: 'Your opponent asks rather than asserts',
                },
                { id: 'oxford', label: DEBATE_FORMAT_LABEL.oxford, note: 'Longer, formal turns' },
                {
                  id: 'devils_advocate',
                  label: DEBATE_FORMAT_LABEL.devils_advocate,
                  note: 'It argues the other side as hard as it can be argued',
                },
              ]}
              onChange={setFormat}
            />
          </Section>

          <Section title="How hard">
            <Choices
              label="How hard"
              value={difficulty}
              options={[
                { id: 'beginner', label: 'Beginner', note: 'One clear objection at a time' },
                {
                  id: 'intermediate',
                  label: 'Intermediate',
                  note: 'Counterexamples, evidence and assumptions',
                },
                {
                  id: 'advanced',
                  label: 'Advanced',
                  note: 'Holds you to what you said earlier, and finds the assumptions you did not state',
                },
              ]}
              onChange={setDifficulty}
            />
          </Section>

          <div className="mt-4 flex items-center justify-between">
            <div className="eyebrow inline-flex items-center gap-1.5">
              <IconTimer width={12} height={12} /> Length
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Five minutes less"
                disabled={minutes <= MIN_MINUTES}
                onClick={() => setMinutes((m) => Math.max(MIN_MINUTES, m - MINUTE_STEP))}
                className={stepper}
              >
                −
              </button>
              <span className="min-w-[4.5rem] text-center text-[15px] font-semibold tabular-nums text-chalk">
                {minutes} min
              </span>
              <button
                type="button"
                aria-label="Five minutes more"
                disabled={minutes >= MAX_MINUTES}
                onClick={() => setMinutes((m) => Math.min(MAX_MINUTES, m + MINUTE_STEP))}
                className={stepper}
              >
                +
              </button>
            </div>
          </div>

          <Section title="Research">
            <Choices
              label="Research"
              value={research === null ? 'auto' : research ? 'on' : 'off'}
              options={[
                {
                  id: 'auto' as const,
                  label: 'Decide for me',
                  note:
                    willResearch === null
                      ? 'Looked up only where current facts matter'
                      : willResearch
                        ? "We'll look this one up first"
                        : "No need to look this one up",
                },
                { id: 'on' as const, label: 'Research it', note: 'Find sources before we start' },
                { id: 'off' as const, label: 'Skip it', note: 'Start sooner; argue from reasoning' },
              ]}
              onChange={(value) => setResearch(value === 'auto' ? null : value === 'on')}
            />
          </Section>

          <button
            type="button"
            aria-pressed={camera}
            onClick={() => setCamera(!camera)}
            className={cn(
              'mt-4 flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all',
              camera ? optionActive : optionIdle,
            )}
          >
            <IconVideo width={15} height={15} className="shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium leading-tight">Camera on</span>
              <span className="mt-0.5 block text-[10.5px] leading-tight text-faint">
                Adds feedback on how you come across. Measured on your device.
              </span>
            </span>
            {camera && <IconCheck width={14} height={14} className="shrink-0" />}
          </button>
        </div>
      )}
    </div>
  )
}

function MaterialRow({ material, onRemove }: { material: DebateMaterial; onRemove: () => void }) {
  const Icon = SOURCE_ICON[material.source] ?? IconFile
  const failed = material.status === 'failed'
  return (
    <div
      className={cn(
        'flex h-10 items-center gap-2 rounded-xl border pl-3 pr-1.5',
        failed ? 'border-[#fca5a5]/30 bg-[#fca5a5]/8' : 'border-white/8 bg-white/4',
      )}
    >
      <Icon width={15} height={15} className={cn('shrink-0', failed ? 'text-[#fca5a5]' : 'text-jade-400')} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[12px] font-medium text-chalk">{material.name}</div>
        <div className="truncate text-[10px] text-faint">
          {material.status === 'processing' ? 'Reading…' : failed ? "Couldn't be read" : 'Ready'}
        </div>
      </div>
      <button
        type="button"
        aria-label={`Remove ${material.name}`}
        onClick={onRemove}
        className="grid size-7 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-white/8 hover:text-chalk"
      >
        <IconClose width={13} height={13} />
      </button>
    </div>
  )
}

/** Why a preparation stopped, in the user's terms rather than the exception's name. */
export function preparationFailure(reason?: string): string {
  if (reason === 'BriefRejected') {
    return "I couldn't build a fair case for both sides of that. Try rewording the motion, or pick another."
  }
  if (reason === 'debate_deleted') return 'That debate is no longer here.'
  // AiUnavailable, ModelBusy, StructuredOutputError, a timeout…
  return "The AI service didn't answer, so the debate couldn't be prepared. Try again."
}

export function DebateSetupForm({
  location,
  area,
  format: practiceFormat,
  onBack,
  onDone,
}: {
  location: Location
  area: string
  format: PracticeFormat
  onBack: () => void
  onDone: () => void
}) {
  const setSession = useAppStore((s) => s.setSession)
  const setAccountOpen = useAppStore((s) => s.setAccountOpen)

  const [way, setWay] = useState<Way | null>(null)
  const [topic, setTopic] = useState('')
  const [debate, setDebate] = useState<Debate | null>(null)
  const [suggestions, setSuggestions] = useState<TopicSuggestion[] | null>(null)
  const [interest, setInterest] = useState('')
  const [adding, setAdding] = useState(false)
  const [pending, setPending] = useState<'topics' | 'material' | 'start' | null>(null)
  const [problem, setProblem] = useState<SetupProblem | null>(null)

  // Settings, all defaulted so that starting without opening them is the normal path.
  const [position, setPosition] = useState<DebatePosition>('for')
  const [positionMode, setPositionMode] = useState<DebatePositionMode>('user')
  const [debateFormat, setDebateFormat] = useState<DebateFormatId>('free')
  const [difficulty, setDifficulty] = useState<DebateDifficulty>('intermediate')
  const [minutes, setMinutes] = useState(DEBATE_MINUTES)
  const [research, setResearch] = useState<boolean | null>(null)
  const [camera, setCamera] = useState(false)

  const topicField = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (way === 'topic') topicField.current?.focus()
  }, [way])

  const uid = firebaseConfigured() ? firebase().auth.currentUser?.uid : undefined
  const materials = useLiveCollection<DebateMaterial>(
    uid && debate ? `users/${uid}/debates/${debate.id}/materials` : null,
    {
      orderByField: 'createdAt',
      max: 100,
      map: (id, data) => ({ id, ...(data as Omit<DebateMaterial, 'id'>) }),
    },
    () => (debate ? listDebateMaterials(debate.id) : Promise.resolve([])),
  )
  const attached = materials ?? []

  const fail = useCallback((error: unknown) => setProblem(describeProblem(error)), [])

  /** The debate record, created on first need so the simple path costs nothing up front. */
  const ensureDebate = useCallback(async (): Promise<Debate> => {
    if (debate) return debate
    const created = await createDebate({
      topic,
      format: debateFormat,
      difficulty,
      positionMode,
      position,
      durationMinutes: minutes,
      researchEnabled: research,
    })
    setDebate(created)
    return created
  }, [debate, topic, debateFormat, difficulty, positionMode, position, minutes, research])

  const askForTopics = async () => {
    setPending('topics')
    setProblem(null)
    try {
      setSuggestions((await suggestTopics(interest)).topics)
    } catch (error) {
      fail(error)
    } finally {
      setPending(null)
    }
  }

  const addMaterial = async (draft: MaterialDraft) => {
    setPending('material')
    setProblem(null)
    try {
      const target = await ensureDebate()
      if (draft.kind === 'files') {
        for (const file of draft.files) {
          if (file.size > MAX_FILE_BYTES) {
            setProblem({ text: `${file.name} is too large. Files can be up to 40 MB.` })
            continue
          }
          await uploadDebateMaterial(target.id, file)
        }
      } else if (draft.kind === 'link') {
        await addDebateLink(target.id, draft.url)
      } else {
        await addDebateText(target.id, draft.text)
      }
      setDebate(await getDebate(target.id))
    } catch (error) {
      fail(error)
    } finally {
      setPending(null)
    }
  }

  const removeMaterial = async (materialId: string) => {
    if (!debate) return
    try {
      await deleteDebateMaterial(debate.id, materialId)
      setDebate(await getDebate(debate.id))
    } catch (error) {
      fail(error)
    }
  }

  /** Straight in: no research, no brief, the argument starts now (§32). */
  const startNow = async () => {
    setPending('start')
    setProblem(null)
    try {
      const created = await createDebateSession({
        topic,
        format: debateFormat,
        difficulty,
        positionMode,
        position,
        durationMinutes: minutes,
        camera,
      })
      setSession({
        locationId: location.id,
        area,
        format: practiceFormat,
        minutes,
        debate: {
          motion: created.motion,
          position: created.userPosition,
          aiPosition: created.aiPosition,
          format: created.format,
          difficulty: created.difficulty,
          sessionId: created.id,
          opponentName: created.opponentName,
          camera,
        },
      })
      onDone()
    } catch (error) {
      fail(error)
    } finally {
      setPending(null)
    }
  }

  /** Prepare first: research where it matters, read the material, build the brief. */
  const prepare = async () => {
    setPending('start')
    setProblem(null)
    try {
      const target = await ensureDebate()
      // The settings may have changed since the record was created for a file upload.
      const synced =
        target.activePrepId === null
          ? await updateDebate(target.id, {
              topic,
              format: debateFormat,
              difficulty,
              positionMode,
              position,
              durationMinutes: minutes,
              ...(research === null ? {} : { researchEnabled: research }),
            })
          : target
      const { prepId } = await prepareDebate(synced.id)
      setSession({
        locationId: location.id,
        area,
        format: practiceFormat,
        minutes,
        debate: {
          motion: synced.topic || topic,
          position: synced.askedPosition ?? position,
          aiPosition: (synced.askedPosition ?? position) === 'for' ? 'against' : 'for',
          format: debateFormat,
          difficulty,
          debateId: synced.id,
          prepId,
          camera,
        },
      })
      onDone()
    } catch (error) {
      fail(error)
    } finally {
      setPending(null)
    }
  }

  const readable = attached.filter((m) => m.status !== 'failed')
  const canStart =
    way === 'materials' ? readable.length > 0 : topic.trim().length > 2
  const busy = pending !== null
  const willResearch = debate?.willResearch ?? null

  const settings = (
    <Settings
      position={position}
      setPosition={setPosition}
      positionMode={positionMode}
      setPositionMode={setPositionMode}
      format={debateFormat}
      setFormat={setDebateFormat}
      difficulty={difficulty}
      setDifficulty={setDifficulty}
      minutes={minutes}
      setMinutes={setMinutes}
      research={research}
      setResearch={setResearch}
      camera={camera}
      setCamera={setCamera}
      willResearch={willResearch}
    />
  )

  const error = problem && (
    <div className="mt-3" role="alert">
      <p className="text-[11.5px] leading-snug text-[#fca5a5]">{problem.text}</p>
      {problem.account && (
        <button
          type="button"
          onClick={() => setAccountOpen(true)}
          className="mt-1 text-[11.5px] font-medium text-jade-400 underline-offset-2 hover:underline"
        >
          Open your account
        </button>
      )}
    </div>
  )

  // The first screen: one question, three ways to answer it.
  if (way === null) {
    return (
      <div key="ways" className="anim-fade mt-4">
        <StepHeader title="Debate" hint="What do you want to debate?" onBack={onBack} />
        <Ways onPick={setWay} />
        <p className="mt-3 text-[10.5px] leading-snug text-faint">
          You take a side; your opponent takes the other and argues it properly — it remembers what
          you said and comes back to it.
        </p>
      </div>
    )
  }

  return (
    <div key={way} className="anim-fade mt-4">
      <StepHeader
        title={
          way === 'topic' ? 'Your topic' : way === 'suggest' ? 'Pick a motion' : 'Debate from your materials'
        }
        hint={
          way === 'topic'
            ? 'What should the debate be about?'
            : way === 'suggest'
              ? 'Both sides are arguable in each of these'
              : 'We find what can be argued in them'
        }
        onBack={() => {
          setWay(null)
          setProblem(null)
        }}
      />

      <div className="-mr-2 mt-3 max-h-[min(50vh,26rem)] overflow-y-auto pr-2 short:max-h-[40vh]">
        {way === 'topic' && (
          <textarea
            ref={topicField}
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            rows={3}
            maxLength={300}
            placeholder="Should governments regulate generative AI?"
            className={cn(field, 'resize-none leading-snug')}
            aria-label="What you want to debate"
          />
        )}

        {way === 'suggest' && (
          <>
            {suggestions === null ? (
              <>
                <input
                  value={interest}
                  onChange={(event) => setInterest(event.target.value)}
                  maxLength={200}
                  placeholder="Anything you're interested in? (optional)"
                  className={field}
                  aria-label="A subject you are interested in"
                />
                <Button
                  variant="primary"
                  className="mt-2 w-full"
                  disabled={busy}
                  onClick={() => void askForTopics()}
                >
                  {pending === 'topics' ? 'Thinking…' : 'Suggest motions'}
                </Button>
              </>
            ) : (
              <div className="grid gap-1.5">
                {suggestions.map((suggestion) => {
                  const active = topic === suggestion.motion
                  return (
                    <button
                      key={suggestion.motion}
                      type="button"
                      onClick={() => setTopic(suggestion.motion)}
                      className={cn(
                        'rounded-xl border px-3 py-2 text-left transition-all duration-200',
                        active ? optionActive : optionIdle,
                      )}
                    >
                      <span className="block text-[12.5px] font-medium leading-snug">
                        {suggestion.motion}
                      </span>
                      <span className="mt-1 block text-[10.5px] leading-snug text-faint">
                        {suggestion.area} — {suggestion.why}
                      </span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void askForTopics()}
                  className="mt-0.5 text-[11.5px] font-medium text-jade-400 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {pending === 'topics' ? 'Thinking…' : 'Suggest different ones'}
                </button>
              </div>
            )}
          </>
        )}

        {way === 'materials' && (
          <>
            {attached.length > 0 && (
              <div className="grid gap-1.5">
                {attached.map((material) => (
                  <MaterialRow
                    key={material.id}
                    material={material}
                    onRemove={() => void removeMaterial(material.id)}
                  />
                ))}
              </div>
            )}
            <Button
              variant="ghost"
              className="mt-2 w-full"
              disabled={busy}
              onClick={() => setAdding(true)}
            >
              {pending === 'material'
                ? 'Adding…'
                : attached.length
                  ? 'Add something else'
                  : 'Add an article, paper or notes'}
            </Button>
            <p className="mt-2 text-[10.5px] leading-snug text-faint">
              We read them for claims, evidence and assumptions, and find the motions they support
              arguing about. Your own side is not decided by what they say.
            </p>
            <textarea
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              rows={2}
              maxLength={300}
              placeholder="A motion, if you already have one in mind (optional)"
              className={cn(field, 'mt-2 resize-none leading-snug')}
              aria-label="A motion, if you have one"
            />
          </>
        )}

        {settings}
      </div>

      {error}

      <div className="mt-4 grid gap-1.5">
        <Button variant="primary" disabled={busy || !canStart} onClick={() => void prepare()}>
          {pending === 'start' ? 'One moment…' : 'Prepare and debate'}
        </Button>
        <p className="text-[10.5px] leading-snug text-faint">
          {way === 'materials'
            ? 'We read your material, then show you what to be ready to defend.'
            : willResearch === false || research === false
              ? "We'll build the case on both sides, then show you what to be ready to defend."
              : "We'll look the topic up where current facts matter, then show you what to be ready to defend."}
        </p>
        {way !== 'materials' && (
          <button
            type="button"
            disabled={busy || !canStart}
            onClick={() => void startNow()}
            className="mt-0.5 text-[11.5px] font-medium text-mist underline-offset-2 transition-colors hover:text-chalk hover:underline disabled:opacity-50"
          >
            Skip preparation — start the debate now
          </button>
        )}
      </div>

      {adding && (
        <AddMaterials
          onAdd={(draft) => {
            setAdding(false)
            void addMaterial(draft)
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}
