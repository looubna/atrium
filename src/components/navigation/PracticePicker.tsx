import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  DURATION_DEFAULT,
  DURATION_MAX,
  DURATION_MIN,
  DURATION_STEP,
  GATHERING_FORMATS,
  MEETING_ROLES,
  NETWORKING_TAGS,
  EMOTIONAL_SCENARIOS,
  NEGOTIATION_SCENARIOS,
  LEADERSHIP_SCENARIOS,
  SALES_TYPES,
  PRACTICE_FORMATS,
  describeSession,
  type AttachedFile,
  type InterviewMode,
  type InterviewPanel,
  type GatheringFormat,
  type MeetingRole,
  type NetworkingTag,
  type EmotionalPartner,
  type EmotionalScenario,
  type NegotiationScenario,
  type LeadershipScenario,
  type SalesType,
  type Posture,
  type PracticeFormat,
} from '@/data/practice'
import type { Location } from '@/data/types'
import { useCoarsePointer } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import {
  createApplication,
  createInterviewSession,
  generateBlueprint,
  listApplications,
  listResumes,
  uploadResume,
  type ApplicationItem,
  type BlueprintRound,
  type ResumeItem,
} from '@/modules/interview/api'
import { ExamSetupForm } from '@/modules/exam/setup/ExamSetup'
import { JourneyReview } from '@/modules/interview/journey/JourneyReview'
import { roundMinutes } from '@/modules/interview/journey/rounds'
import { ApiError } from '@/platform/api/client'
import { firebase, firebaseConfigured, NotSignedIn } from '@/platform/firebase'
import { useLiveCollection } from '@/platform/firestore/live'
import { usePracticeProgress } from '@/modules/practice/api'
import { useAppStore, type JourneyRequest } from '@/state/useAppStore'
import { PracticeHeader } from '../practice/PracticeHeader'
import { Button } from '../ui/Button'
import { DeckPicker } from './SlideControls'
import {
  IconArrowLeft,
  IconChair,
  IconCheck,
  IconChevronRight,
  IconClose,
  IconFile,
  IconLayers,
  IconStanding,
  IconTimer,
  IconUpload,
} from '../ui/Icon'

type Step =
  | { kind: 'areas' }
  | { kind: 'formats'; area: string }
  | { kind: 'setup'; area: string; format: PracticeFormat }

const optionIdle = 'border-white/8 bg-white/4 text-mist hover:bg-white/8 hover:text-chalk'
const optionActive = 'border-jade-400/40 bg-jade-500/15 text-jade-400'
const stepper =
  'grid size-8 place-items-center rounded-lg border border-white/10 bg-white/4 text-[16px] text-mist transition-colors hover:bg-white/8 hover:text-chalk disabled:opacity-40'

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

function Duration({ minutes, setMinutes }: { minutes: number; setMinutes: (update: (m: number) => number) => void }) {
  return (
    <>
      <div className="mt-4 flex items-center justify-between">
        <div className="eyebrow">Duration</div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Five minutes less"
            disabled={minutes <= DURATION_MIN}
            onClick={() => setMinutes((m) => Math.max(DURATION_MIN, m - DURATION_STEP))}
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
            disabled={minutes >= DURATION_MAX}
            onClick={() => setMinutes((m) => Math.min(DURATION_MAX, m + DURATION_STEP))}
            className={stepper}
          >
            +
          </button>
        </div>
      </div>
      <input
        type="range"
        aria-label="Session duration in minutes"
        min={DURATION_MIN}
        max={DURATION_MAX}
        step={DURATION_STEP}
        value={minutes}
        onChange={(e) => {
          const v = Number(e.target.value)
          setMinutes(() => v)
        }}
        className="mt-2 h-2 w-full cursor-pointer accent-jade-500"
      />
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-faint">
        <span>{DURATION_MIN} min</span>
        <span>{DURATION_MAX} min</span>
      </div>
    </>
  )
}

/** Two or more mutually exclusive choices side by side. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { id: T; label: string; disabled?: boolean }[]
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-1.5', options.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={o.disabled}
          onClick={() => onChange(o.id)}
          className={cn(
            'flex h-9 items-center justify-center rounded-xl border text-[12.5px] font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40',
            value === o.id ? optionActive : optionIdle,
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Attach a document. The file stays on the device; the session keeps its name. */
function FilePick({
  label,
  file,
  onChange,
  accept = '.pdf,.doc,.docx,.txt,.rtf,.md,.odt',
}: {
  label: string
  file?: AttachedFile
  onChange: (file?: AttachedFile) => void
  accept?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onChange({ name: f.name, size: f.size, type: f.type })
          e.target.value = ''
        }}
      />
      {file ? (
        <div className="flex h-10 items-center gap-2 rounded-xl border border-jade-400/30 bg-jade-500/10 pl-3 pr-1.5">
          <IconFile width={15} height={15} className="shrink-0 text-jade-400" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[12px] font-medium text-chalk">{file.name}</div>
            <div className="text-[10px] text-faint">{label}</div>
          </div>
          <button
            type="button"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={() => onChange(undefined)}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-white/8 hover:text-chalk"
          >
            <IconClose width={13} height={13} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cn('flex h-10 w-full items-center gap-2 rounded-xl border border-dashed px-3 text-left text-[12.5px] font-medium transition-all duration-200', optionIdle)}
        >
          <IconUpload width={15} height={15} className="shrink-0" />
          <span className="flex-1">{label}</span>
          <span className="text-[10.5px] text-faint">Optional</span>
        </button>
      )}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow">{title}</div>
        {hint && <div className="text-[10.5px] text-faint">{hint}</div>}
      </div>
      <div className="mt-1.5">{children}</div>
    </section>
  )
}

interface SetupProblem {
  text: string
  /** The fix is in the account sheet (sign in, consent, verify email). */
  account?: boolean
}

function describeSetupProblem(error: unknown): SetupProblem {
  if (error instanceof NotSignedIn || (error instanceof ApiError && error.status === 401)) {
    return { text: 'Sign in to practise with the live interviewer.', account: true }
  }
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'consent_required':
        return { text: 'Allow recording and AI processing in your account first.', account: true }
      case 'email_not_verified':
        return { text: 'Verify your email address, then try again.', account: true }
      case 'account_deleting':
        return { text: 'This account is being deleted.' }
      case 'quota_exceeded':
        return { text: "You've reached today's practice limit. It resets tomorrow." }
      case 'rate_limited':
        return { text: 'Too many attempts. Try again in a minute.' }
      case 'unavailable':
        return { text: 'Live interviews are paused right now. Try again later.' }
      default:
        return { text: error.message }
    }
  }
  if (error instanceof Error && error.message.includes('not configured')) {
    return { text: 'Accounts aren’t available in this build.' }
  }
  return { text: 'Could not reach Atrium. Check your connection and try again.' }
}

const textField =
  'h-10 w-full rounded-xl border border-white/8 bg-white/4 px-3 text-[12.5px] text-chalk outline-none placeholder:text-faint focus:border-jade-400/40'

/** Pick one of the user's uploaded resumes, or upload a new one (processed on the server). */
function ResumePicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // Live, so "Reading…" becomes "Summarising…" and then "Ready" as the worker gets there.
  const uid = firebaseConfigured() ? firebase().auth.currentUser?.uid : undefined
  const resumes = useLiveCollection<ResumeItem>(
    uid ? `users/${uid}/resumes` : null,
    {
      orderByField: 'createdAt',
      max: 4,
      map: (id, data) => ({
        id,
        fileName: String(data.fileName ?? ''),
        status: data.status,
        stage: data.stage ?? null,
        failureReason: data.failureReason ?? null,
        currentTitle: data.profile?.currentTitle ?? null,
      }),
    },
    listResumes,
    { keepPolling: (items) => !items || items.some((r) => r.status === 'processing'), version: uploading },
  )

  const upload = async (file: File) => {
    setUploading(true)
    setNote(null)
    try {
      const created = await uploadResume(file)
      onChange(created.id)
    } catch (error) {
      setNote(describeSetupProblem(error).text)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept=".pdf,.docx,.txt,.md"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void upload(file)
          e.target.value = ''
        }}
      />
      <div className="flex flex-col gap-1.5">
        {(resumes ?? []).slice(0, 4).map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={value === r.id}
            disabled={r.status === 'failed'}
            onClick={() => onChange(value === r.id ? null : r.id)}
            className={cn(
              'flex h-10 items-center gap-2 rounded-xl border px-3 text-left transition-all duration-200 disabled:opacity-50',
              value === r.id ? optionActive : optionIdle,
            )}
          >
            <IconFile width={15} height={15} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{r.fileName}</span>
            <span className="text-[10.5px] text-faint">
              {r.status === 'processing'
                ? r.stage === 'summarising'
                  ? 'Summarising…'
                  : 'Reading…'
                : r.status === 'failed'
                  ? 'Unreadable'
                  : 'Ready'}
            </span>
          </button>
        ))}
        <button
          type="button"
          disabled={uploading}
          onClick={() => input.current?.click()}
          className={cn('flex h-10 w-full items-center gap-2 rounded-xl border border-dashed px-3 text-left text-[12.5px] font-medium transition-all duration-200', optionIdle)}
        >
          <IconUpload width={15} height={15} className="shrink-0" />
          <span className="flex-1">{uploading ? 'Uploading…' : 'Upload your resume'}</span>
          <span className="text-[10.5px] text-faint">PDF, Word or text</span>
        </button>
      </div>
      {note && <p className="mt-1 text-[11.5px] text-[#fca5a5]">{note}</p>}
    </div>
  )
}

type SetupStage = 'prepare' | 'journey' | 'format'

/** Jobs already researched: open their rounds again instead of starting over. */
function SavedJourneys({ onOpen }: { onOpen: (saved: ApplicationItem & { activeBlueprintId: string }) => void }) {
  const [saved, setSaved] = useState<(ApplicationItem & { activeBlueprintId: string })[]>([])
  useEffect(() => {
    let live = true
    listApplications()
      .then((items) => {
        if (live) setSaved(items.filter((a): a is ApplicationItem & { activeBlueprintId: string } => Boolean(a.activeBlueprintId)))
      })
      .catch(() => {
        /* signed out or offline: just no shortcuts */
      })
    return () => {
      live = false
    }
  }, [])
  if (saved.length === 0) return null
  return (
    <Section title="Your interview journeys" hint="Pick up where you left off">
      <div className="flex flex-col gap-1.5">
        {saved.slice(0, 5).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(item)}
            className="group flex items-center gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-left transition-all duration-200 hover:border-jade-400/40 hover:bg-jade-500/10 active:scale-[0.99]"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium text-chalk">{item.roleTitle}</div>
              <div className="truncate text-[11px] text-faint">{item.company}</div>
            </div>
            <IconChevronRight width={15} height={15} className="shrink-0 text-faint transition-colors group-hover:text-jade-400" />
          </button>
        ))}
      </div>
    </Section>
  )
}

/**
 * Setting up a job interview: the company, role, job description and resume;
 * then the likely interview journey Agent 1 researched (editable); then how the
 * chosen round happens — online or in person, one interviewer or a panel.
 */
function InterviewSetupForm({
  location,
  area,
  format,
  journey,
  onBack,
  onDone,
}: {
  location: Location
  area: string
  format: PracticeFormat
  /** Open straight on this journey's rounds: it was researched before. */
  journey?: JourneyRequest
  onBack: () => void
  onDone: () => void
}) {
  const setSession = useAppStore((s) => s.setSession)
  const setAccountOpen = useAppStore((s) => s.setAccountOpen)
  const [stage, setStage] = useState<SetupStage>(journey ? 'journey' : 'prepare')
  const [general, setGeneral] = useState(false)
  const [company, setCompany] = useState(journey?.company ?? '')
  const [roleTitle, setRoleTitle] = useState(journey?.roleTitle ?? '')
  const [place, setPlace] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [resumeId, setResumeId] = useState<string | null>(null)
  const [applicationId, setApplicationId] = useState<string | null>(journey?.applicationId ?? null)
  const [blueprintId, setBlueprintId] = useState<string | null>(journey?.blueprintId ?? null)
  const [round, setRound] = useState<BlueprintRound | null>(null)
  const [mode, setMode] = useState<InterviewMode>('online')
  const [panel, setPanel] = useState<InterviewPanel>('one-to-one')
  const [minutes, setMinutes] = useState(30)
  const [pending, setPending] = useState(false)
  const [problem, setProblem] = useState<SetupProblem | null>(null)

  const run = async (work: () => Promise<void>) => {
    setPending(true)
    setProblem(null)
    try {
      await work()
    } catch (error) {
      setProblem(describeSetupProblem(error))
    } finally {
      setPending(false)
    }
  }

  const buildJourney = () =>
    run(async () => {
      const app =
        applicationId ??
        (
          await createApplication({
            company: company.trim(),
            roleTitle: roleTitle.trim(),
            location: place.trim(),
            jobDescription: jobDescription.trim(),
            resumeId,
          })
        ).id
      setApplicationId(app)
      const { blueprintId: next } = await generateBlueprint(app)
      setBlueprintId(next)
      setStage('journey')
    })

  const confirm = () =>
    run(async () => {
      const created = await createInterviewSession({
        ...(general || !round || !applicationId || !blueprintId
          ? { practice: 'general_behavioral' as const }
          : { applicationId, blueprintId, roundId: round.id }),
        mode: mode === 'in-person' ? 'in_person' : 'online',
        panel: panel === 'panel' ? 'panel' : 'one_to_one',
        durationMinutes: minutes,
      })
      // Online, the live interviewer joins by video call; in person, the candidate goes to the
      // company, checks in at reception and meets them in the meeting room.
      setSession({
        locationId: location.id,
        area,
        format: { ...format, destination: mode === 'in-person' ? 'meeting' : 'call' },
        posture: mode === 'in-person' ? 'sitting' : undefined,
        minutes,
        interview: {
          general,
          type: 'behavioral',
          mode,
          panel,
          location: place.trim() || undefined,
          sessionId: created.id,
          applicationId: applicationId ?? undefined,
          blueprintId: blueprintId ?? undefined,
          roundId: round?.id,
          roundTitle: round?.title,
          // General practice is a behavioral round on the server too, so the same interviewer shows.
          roundType: round?.type ?? (general ? 'behavioral' : undefined),
          company: company.trim() || undefined,
          roleTitle: roleTitle.trim() || undefined,
        },
      })
      onDone()
    })

  const problemBanner = problem && (
    <div className="mt-2 flex items-start justify-between gap-2 text-[12px] text-[#fca5a5]" role="alert">
      <span>{problem.text}</span>
      {problem.account && (
        <button type="button" onClick={() => setAccountOpen(true)} className="shrink-0 font-medium text-chalk underline">
          Open account
        </button>
      )}
    </div>
  )

  if (stage === 'journey' && applicationId && blueprintId) {
    return (
      <div key="journey" className="anim-fade mt-4">
        <StepHeader title={`${roleTitle} · ${company}`} hint="Prepare a round with likely questions and ideas, or practise it now" onBack={() => setStage('prepare')} />
        <div className="-mr-2 max-h-[min(55vh,30rem)] overflow-y-auto pr-2 short:max-h-[45vh]">
          <JourneyReview
            applicationId={applicationId}
            blueprintId={blueprintId}
            company={company}
            onBlueprintChange={setBlueprintId}
            onChoose={(blueprint, chosen) => {
              setBlueprintId(blueprint.id)
              setRound(chosen)
              setMinutes(roundMinutes(chosen))
              setStage('format')
            }}
          />
        </div>
        {problemBanner}
      </div>
    )
  }

  if (stage === 'format') {
    return (
      <div key="format" className="anim-fade mt-4">
        <StepHeader
          title={round?.title ?? 'General behavioral interview'}
          hint="How the interview happens"
          onBack={() => setStage(general ? 'prepare' : 'journey')}
        />
        <div className="-mr-2 mt-1 max-h-[min(50vh,26rem)] overflow-y-auto pr-2 short:max-h-[40vh]">
        <Section title="Format">
          <div className="flex flex-col gap-1.5">
            <Segmented
              label="Online or in person"
              value={mode}
              onChange={setMode}
              options={[
                { id: 'online', label: 'Online' },
                { id: 'in-person', label: 'In person' },
              ]}
            />
            <Segmented
              label="One interviewer or a panel"
              value={panel}
              onChange={setPanel}
              options={[
                { id: 'one-to-one', label: 'One-to-one' },
                { id: 'panel', label: 'Panel' },
              ]}
            />
          </div>
          <p className="mt-1.5 text-[10.5px] text-faint">
            {mode === 'in-person'
              ? panel === 'panel'
                ? 'At the office: check in at reception, then meet the lead, two colleagues who ask their own questions, and an observer in the boardroom.'
                : 'At the office: check in at reception, then sit down with your interviewer in the boardroom.'
              : panel === 'panel'
                ? 'A video call with a lead interviewer, two colleagues on camera who ask their own questions, and an observer.'
                : 'One interviewer on a video call.'}
          </p>
        </Section>

        <Duration minutes={minutes} setMinutes={setMinutes} />
        </div>

        <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
          A live AI interviewer listens and responds to your answers. The session is recorded so feedback can point to
          exact moments.
        </p>
        <Button variant="primary" className="mt-3 w-full" disabled={pending} onClick={() => void confirm()}>
          <IconCheck width={15} height={15} />
          {pending ? 'Preparing your interviewer…' : 'Confirm interview'}
        </Button>
        {problemBanner}
      </div>
    )
  }

  // Changing the job after a journey was built starts a fresh application.
  const editJob = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setApplicationId(null)
  }
  const jobReady = company.trim().length > 0 && roleTitle.trim().length > 0

  return (
    <div key="interview" className="anim-fade mt-4">
      <StepHeader title={format.label} hint="Set up your interview" onBack={onBack} />

      <div className="-mr-2 mt-1 max-h-[min(50vh,26rem)] overflow-y-auto pr-2 short:max-h-[40vh]">
        <Section title="Practice">
          <Segmented
            label="What to practise"
            value={general ? 'general' : 'job'}
            onChange={(value) => setGeneral(value === 'general')}
            options={[
              { id: 'job', label: 'A specific job' },
              { id: 'general', label: 'General behavioral' },
            ]}
          />
        </Section>

        {!general && (
          <>
            <SavedJourneys
              onOpen={(saved) => {
                setCompany(saved.company)
                setRoleTitle(saved.roleTitle)
                setPlace(saved.location ?? '')
                setApplicationId(saved.id)
                setBlueprintId(saved.activeBlueprintId)
                setStage('journey')
              }}
            />
            <Section title="The job">
              <div className="flex flex-col gap-1.5">
                <input
                  aria-label="Company"
                  value={company}
                  maxLength={120}
                  onChange={(e) => editJob(setCompany)(e.target.value)}
                  placeholder="Company"
                  className={textField}
                />
                <input
                  aria-label="Role title"
                  value={roleTitle}
                  maxLength={160}
                  onChange={(e) => editJob(setRoleTitle)(e.target.value)}
                  placeholder="Role title"
                  className={textField}
                />
                <input
                  aria-label="Location"
                  value={place}
                  maxLength={120}
                  onChange={(e) => editJob(setPlace)(e.target.value)}
                  placeholder="Location — city or country (optional)"
                  className={textField}
                />
                <textarea
                  aria-label="Job description"
                  value={jobDescription}
                  maxLength={50_000}
                  rows={4}
                  onChange={(e) => editJob(setJobDescription)(e.target.value)}
                  placeholder="Paste the job description (recommended)"
                  className="w-full resize-y rounded-xl border border-white/8 bg-white/4 p-3 text-[12.5px] leading-relaxed text-chalk outline-none placeholder:text-faint focus:border-jade-400/40"
                />
              </div>
            </Section>
            <Section title="Your resume" hint="Recommended">
              <ResumePicker
                value={resumeId}
                onChange={(id) => {
                  setResumeId(id)
                  setApplicationId(null)
                }}
              />
            </Section>
          </>
        )}
      </div>

      <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
        {general
          ? 'Practise common behavioral questions with a live AI interviewer.'
          : 'We research the company and role to predict the rounds you are likely to face. You can edit them.'}
      </p>
      <Button
        variant="primary"
        className="mt-3 w-full"
        disabled={pending || (!general && !jobReady)}
        onClick={() => (general ? setStage('format') : void buildJourney())}
      >
        <IconCheck width={15} height={15} />
        {general ? 'Continue' : pending ? 'Starting research…' : 'Build my interview journey'}
      </Button>
      {problemBanner}
    </div>
  )
}

/** A drill's challenge level on its chip, once the user has practised it. */
function DrillLevel({ drillId }: { drillId?: string }) {
  const drill = usePracticeProgress((s) => (drillId ? s.progress?.drills[drillId] : undefined))
  if (!drill || drill.rounds === 0) return null
  return (
    <span className="rounded bg-jade-500/15 px-1 text-[9.5px] font-semibold tabular-nums text-jade-300" title={drill.skills.map((k) => k.label).join(' · ')}>
      {drill.mastered ? '✓' : `L${drill.level}`}
    </span>
  )
}

/** A list of choices, each with a one-line description; one is selected. */
function ChoiceList<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 1,
}: {
  label: string
  value: T | undefined
  options: { id: T; label: string; note: string }[]
  onChange: (v: T) => void
  columns?: 1 | 2
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-1.5', columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
      {options.map((o) => {
        const active = value === o.id
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            className={cn('rounded-xl border px-3 py-2 text-left transition-all duration-200', active ? optionActive : optionIdle)}
          >
            <span className="block text-[12.5px] font-medium leading-tight">{o.label}</span>
            <span className="mt-0.5 block text-[10.5px] leading-tight text-faint">{o.note}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Networking: whether the user can see who they're talking to, and if so, who they are. */
function EmotionalSetupForm({
  location,
  area,
  format,
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
  const [partner, setPartner] = useState<EmotionalPartner>('woman')
  const [scenario, setScenario] = useState<EmotionalScenario>('share-feelings')
  const [minutes, setMinutes] = useState(DURATION_DEFAULT)

  return (
    <div key="emotional" className="anim-fade mt-4">
      <StepHeader title={format.label} hint="Set up your conversation" onBack={onBack} />
      <div className="-mr-2 mt-1 max-h-[min(50vh,26rem)] overflow-y-auto pr-2 short:max-h-[40vh]">
        <Section title="Who you talk with">
          <ChoiceList
            label="Who you talk with"
            value={partner}
            onChange={setPartner}
            options={[
              { id: 'woman', label: 'A woman', note: 'She sits with you on the bench' },
              { id: 'man', label: 'A man', note: 'He sits with you on the bench' },
            ]}
          />
        </Section>
        <Section title="The conversation">
          <ChoiceList label="The conversation" value={scenario} onChange={setScenario} options={EMOTIONAL_SCENARIOS} />
        </Section>
        <Duration minutes={minutes} setMinutes={setMinutes} />
      </div>
      <Button
        variant="primary"
        className="mt-4 w-full"
        onClick={() => {
          setSession({ locationId: location.id, area, format, minutes, emotional: { partner, scenario } })
          onDone()
        }}
      >
        <IconCheck width={15} height={15} />
        Confirm session
      </Button>
    </div>
  )
}

function NetworkingSetupForm({
  location,
  area,
  format,
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
  const [visibility, setVisibility] = useState<'visible' | 'unknown'>('visible')
  const [tags, setTags] = useState<NetworkingTag[]>([])
  const [minutes, setMinutes] = useState(15)
  const visible = visibility === 'visible'
  const ready = !visible || tags.length > 0
  const toggle = (t: NetworkingTag) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))

  return (
    <div key="networking" className="anim-fade mt-4">
      <StepHeader title={format.label} hint="Set up your networking session" onBack={onBack} />
      <div className="-mr-2 mt-1 max-h-[min(50vh,26rem)] overflow-y-auto pr-2 short:max-h-[40vh]">
        <Section title="Who you meet">
          <ChoiceList
            label="Role visible or unknown"
            value={visibility}
            onChange={setVisibility}
            options={[
              { id: 'visible', label: 'Role visible', note: 'A badge or an introduction tells you who they are' },
              { id: 'unknown', label: 'Role unknown', note: "You find out who they are as you talk" },
            ]}
          />
        </Section>
        {visible && (
          <Section title="Their role" hint={tags.length ? `${tags.length} selected` : 'Choose one or more'}>
            <div role="group" aria-label="Their role" className="grid grid-cols-2 gap-1.5">
              {NETWORKING_TAGS.map((t) => {
                const on = tags.includes(t.id)
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(t.id)}
                    className={cn('flex items-start gap-2 rounded-xl border px-2.5 py-2 text-left transition-all duration-200', on ? optionActive : optionIdle)}
                  >
                    <span
                      className={cn(
                        'mt-0.5 grid size-4 shrink-0 place-items-center rounded-md border',
                        on ? 'border-jade-400 bg-jade-400 text-ink-900' : 'border-white/25',
                      )}
                    >
                      {on && <IconCheck width={11} height={11} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12px] font-medium leading-tight">{t.label}</span>
                      <span className="mt-0.5 block text-[10px] leading-tight text-faint">{t.note}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </Section>
        )}
        <Duration minutes={minutes} setMinutes={setMinutes} />
      </div>
      <Button
        variant="primary"
        className="mt-4 w-full"
        disabled={!ready}
        onClick={() => {
          setSession({
            locationId: location.id,
            area,
            format,
            posture: 'sitting',
            minutes,
            networking: { roleVisible: visible, tags: visible ? tags : [] },
          })
          onDone()
        }}
      >
        <IconCheck width={15} height={15} />
        {ready ? 'Confirm session' : 'Choose their role'}
      </Button>
    </div>
  )
}

/** Where it happens: across a table with one person, with several, or on a video call. */
function GatheringChoice({ value, onChange, who }: { value: GatheringFormat; onChange: (v: GatheringFormat) => void; who: string }) {
  return (
    <>
      <Segmented label="One-to-one, group or virtual" value={value} onChange={onChange} options={GATHERING_FORMATS} />
      <p className="mt-1.5 text-[10.5px] text-faint">
        {value === 'virtual'
          ? `A video call with ${who}.`
          : value === 'group'
            ? 'In the meeting room, seated at the table with several people.'
            : `In the meeting room, seated across the table from ${who}.`}
      </p>
    </>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  hint?: string
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        maxLength={600}
        className="block w-full resize-none rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-[12.5px] leading-relaxed text-chalk outline-none placeholder:text-faint focus:border-jade-400/40"
      />
      {hint && <span className="mt-1 block text-[10.5px] text-faint">{hint}</span>}
    </label>
  )
}

/** Negotiation: one-to-one, group or virtual, and the situation — or the user's own. */
function NegotiationSetupForm({
  location,
  area,
  format,
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
  const [gathering, setGathering] = useState<GatheringFormat>('one-to-one')
  const [scenario, setScenario] = useState<NegotiationScenario>('salary')
  const [description, setDescription] = useState('')
  const [minutes, setMinutes] = useState(15)
  const ready = scenario !== 'other' || description.trim().length > 0
  const counterpart =
    scenario === 'salary' ? 'the hiring manager' : scenario === 'deadline' ? 'your manager' : scenario === 'partnership' ? 'the other company' : 'the client'

  return (
    <div key="negotiation" className="anim-fade mt-4">
      <StepHeader title={format.label} hint="Set up your negotiation" onBack={onBack} />
      <div className="-mr-2 mt-1 max-h-[min(50vh,26rem)] overflow-y-auto pr-2 short:max-h-[40vh]">
        <Section title="Format">
          <GatheringChoice value={gathering} onChange={setGathering} who={counterpart} />
        </Section>
        <Section title="Situation">
          <ChoiceList label="Negotiation situation" value={scenario} options={NEGOTIATION_SCENARIOS} onChange={setScenario} />
        </Section>
        {scenario === 'other' && (
          <Section title="Your situation">
            <TextField
              label="Describe your situation and what you want to achieve"
              value={description}
              onChange={setDescription}
              placeholder="E.g. My landlord wants to raise the rent by 15%. I want to keep it under 5%."
              hint="Describe the situation and what you want to achieve."
            />
          </Section>
        )}
        <Duration minutes={minutes} setMinutes={setMinutes} />
      </div>
      <Button
        variant="primary"
        className="mt-4 w-full"
        disabled={!ready}
        onClick={() => {
          setSession({
            locationId: location.id,
            area,
            format: { ...format, destination: gathering === 'virtual' ? 'call' : 'meeting' },
            posture: gathering === 'virtual' ? undefined : 'sitting',
            minutes,
            negotiation: {
              format: gathering,
              scenario,
              description: scenario === 'other' ? description.trim() : undefined,
            },
          })
          onDone()
        }}
      >
        <IconCheck width={15} height={15} />
        {ready ? 'Confirm session' : 'Describe your situation'}
      </Button>
    </div>
  )
}

/** Meeting: one-to-one, group or virtual; the user's role; what it's about; material to bring. */
function MeetingSetupForm({
  location,
  area,
  format,
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
  const [gathering, setGathering] = useState<GatheringFormat>('group')
  const [role, setRole] = useState<MeetingRole>('participant')
  const [topic, setTopic] = useState('')
  const [material, setMaterial] = useState<AttachedFile>()
  const [minutes, setMinutes] = useState(20)
  const ready = topic.trim().length > 0

  return (
    <div key="meeting" className="anim-fade mt-4">
      <StepHeader title={format.label} hint="Set up your meeting" onBack={onBack} />
      <div className="-mr-2 mt-1 max-h-[min(50vh,26rem)] overflow-y-auto pr-2 short:max-h-[40vh]">
        <Section title="Format">
          <GatheringChoice value={gathering} onChange={setGathering} who="a colleague" />
        </Section>
        <Section title="Your role">
          <ChoiceList label="Your role in the meeting" value={role} options={MEETING_ROLES} onChange={setRole} />
        </Section>
        <Section title="Topic & context">
          <TextField
            label="Topic and context"
            value={topic}
            onChange={setTopic}
            placeholder="E.g. Weekly project sync: the launch slipped two weeks and we need a new plan."
          />
        </Section>
        <Section title="Material" hint="Optional">
          <FilePick
            label="Upload relevant material"
            file={material}
            onChange={setMaterial}
            accept=".pdf,.doc,.docx,.txt,.rtf,.md,.odt,.ppt,.pptx,.key,.xls,.xlsx,.csv,.png,.jpg,.jpeg"
          />
        </Section>
        <Duration minutes={minutes} setMinutes={setMinutes} />
      </div>
      <Button
        variant="primary"
        className="mt-4 w-full"
        disabled={!ready}
        onClick={() => {
          setSession({
            locationId: location.id,
            area,
            format: { ...format, destination: gathering === 'virtual' ? 'call' : 'meeting' },
            posture: gathering === 'virtual' ? undefined : 'sitting',
            minutes,
            meeting: { format: gathering, role, topic: topic.trim(), material },
          })
          onDone()
        }}
      >
        <IconCheck width={15} height={15} />
        {ready ? 'Confirm session' : 'Add the topic & context'}
      </Button>
    </div>
  )
}

/** Sales: what kind of conversation, and whether it happens online or in person. */
function SalesSetupForm({
  location,
  area,
  format,
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
  const [type, setType] = useState<SalesType>('pitch-demo')
  const [mode, setMode] = useState<InterviewMode>('online')
  const [minutes, setMinutes] = useState(15)
  // An outreach call is remote by definition.
  const remoteOnly = type === 'call-outreach'
  const effectiveMode: InterviewMode = remoteOnly ? 'online' : mode
  const who =
    type === 'investor-pitch' ? 'a panel of investors' : type === 'account-management' ? 'your client' : 'a prospect'

  return (
    <div key="sales" className="anim-fade mt-4">
      <StepHeader title={format.label} hint="Set up your sales session" onBack={onBack} />
      <div className="-mr-2 mt-1 max-h-[min(50vh,26rem)] overflow-y-auto pr-2 short:max-h-[40vh]">
        <Section title="Situation">
          <ChoiceList label="Sales situation" value={type} options={SALES_TYPES} onChange={setType} />
        </Section>
        <Section title="Format">
          <Segmented
            label="Online or in person"
            value={effectiveMode}
            onChange={setMode}
            options={[
              { id: 'online', label: 'Online' },
              { id: 'in-person', label: 'In person', disabled: remoteOnly },
            ]}
          />
          <p className="mt-1.5 text-[10.5px] text-faint">
            {effectiveMode === 'online' ? 'A video call' : 'In the meeting room, seated at the table'} with {who}.
            {remoteOnly && ' Outreach happens on a call.'}
          </p>
        </Section>
        <Duration minutes={minutes} setMinutes={setMinutes} />
      </div>
      <Button
        variant="primary"
        className="mt-4 w-full"
        onClick={() => {
          setSession({
            locationId: location.id,
            area,
            format: { ...format, destination: effectiveMode === 'online' ? 'call' : 'meeting' },
            posture: effectiveMode === 'in-person' ? 'sitting' : undefined,
            minutes,
            sales: { type, mode: effectiveMode },
          })
          onDone()
        }}
      >
        <IconCheck width={15} height={15} />
        Confirm session
      </Button>
    </div>
  )
}

/** Leadership: the full simulation, or one specific scenario with the team in the meeting room. */
function LeadershipSetupForm({
  location,
  area,
  format,
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
  const [mode, setMode] = useState<'full' | 'scenario'>('full')
  const [scenario, setScenario] = useState<LeadershipScenario>()
  const [minutes, setMinutes] = useState(30)
  const ready = mode === 'full' || Boolean(scenario)

  return (
    <div key="leadership" className="anim-fade mt-4">
      <StepHeader title={format.label} hint="Set up your leadership session" onBack={onBack} />
      <div className="-mr-2 mt-1 max-h-[min(50vh,26rem)] overflow-y-auto pr-2 short:max-h-[40vh]">
        <Section title="Practice">
          <ChoiceList
            label="Full simulation or one scenario"
            value={mode}
            onChange={(m) => {
              setMode(m)
              if (m === 'full') setScenario(undefined)
            }}
            options={[
              { id: 'full', label: 'Full leadership simulation', note: 'Several situations in a row, as they come' },
              { id: 'scenario', label: 'Practice a specific scenario', note: 'Pick one situation to work on' },
            ]}
          />
        </Section>
        {mode === 'scenario' && (
          <Section title="Scenario" hint={scenario ? undefined : 'Choose one'}>
            <ChoiceList label="Leadership scenario" value={scenario} options={LEADERSHIP_SCENARIOS} onChange={setScenario} />
          </Section>
        )}
        <p className="mt-2 text-[10.5px] text-faint">In the meeting room, seated at the table with your team.</p>
        <Duration minutes={minutes} setMinutes={setMinutes} />
      </div>
      <Button
        variant="primary"
        className="mt-4 w-full"
        disabled={!ready}
        onClick={() => {
          setSession({
            locationId: location.id,
            area,
            format,
            posture: 'sitting',
            minutes,
            leadership: { mode, scenario: mode === 'scenario' ? scenario : undefined },
          })
          onDone()
        }}
      >
        <IconCheck width={15} height={15} />
        {ready ? 'Confirm session' : 'Choose a scenario'}
      </Button>
    </div>
  )
}

/**
 * The practice areas of a location, and the steps to set a session up:
 * area → format → duration (and posture, for formats that ask). An area with a
 * single format goes straight to its setup. Areas without formats yet stay as
 * plain labels.
 */
export function PracticePicker({ location }: { location: Location }) {
  const touch = useCoarsePointer()
  const session = useAppStore((s) => s.session)
  const setSession = useAppStore((s) => s.setSession)

  const journeyRequest = useAppStore((s) => s.journeyRequest)
  const clearJourneyRequest = useAppStore((s) => s.clearJourneyRequest)

  const [step, setStep] = useState<Step>({ kind: 'areas' })
  const [posture, setPosture] = useState<Posture>('standing')
  const [minutes, setMinutes] = useState(DURATION_DEFAULT)
  const [journey, setJourney] = useState<JourneyRequest | undefined>()

  useEffect(() => {
    setStep({ kind: 'areas' })
    setJourney(undefined)
  }, [location.id])

  // Back from a call to "all rounds": open that journey without researching again.
  useEffect(() => {
    if (!journeyRequest || journeyRequest.locationId !== location.id) return
    setJourney(journeyRequest)
    setStep({ kind: 'setup', area: journeyRequest.area, format: journeyRequest.format })
    clearJourneyRequest()
  }, [journeyRequest, location.id, clearJourneyRequest])

  const ready = session?.locationId === location.id ? session : null

  const openArea = (area: string) => {
    const formats = PRACTICE_FORMATS[area] ?? []
    setStep(formats.length === 1 ? { kind: 'setup', area, format: formats[0] } : { kind: 'formats', area })
  }

  if (step.kind === 'formats') {
    const formats = PRACTICE_FORMATS[step.area] ?? []
    return (
      <div key="formats" className="anim-fade mt-4">
        <StepHeader title={step.area} hint="Choose a format" onBack={() => setStep({ kind: 'areas' })} />
        <div className="mt-3 flex flex-col gap-1.5">
          {formats.map((format) => (
            <button
              key={format.id}
              type="button"
              onClick={() => setStep({ kind: 'setup', area: step.area, format })}
              className="group flex items-center gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-2.5 text-left transition-all duration-200 hover:border-jade-400/40 hover:bg-jade-500/10 active:scale-[0.99]"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-chalk">{format.label}</div>
                <div className="mt-0.5 text-[11px] text-faint">{format.note}</div>
              </div>
              <IconChevronRight
                width={15}
                height={15}
                className="shrink-0 text-faint transition-colors group-hover:text-jade-400"
              />
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (step.kind === 'setup') {
    const { format } = step
    const back = () =>
      setStep((PRACTICE_FORMATS[step.area] ?? []).length === 1 ? { kind: 'areas' } : { kind: 'formats', area: step.area })

    if (format.kind === 'exam') {
      return <ExamSetupForm location={location} area={step.area} format={format} onBack={back} onDone={() => setStep({ kind: 'areas' })} />
    }
    if (format.kind === 'emotional') {
      return <EmotionalSetupForm location={location} area={step.area} format={format} onBack={back} onDone={() => setStep({ kind: 'areas' })} />
    }
    if (format.kind === 'networking') {
      return <NetworkingSetupForm location={location} area={step.area} format={format} onBack={back} onDone={() => setStep({ kind: 'areas' })} />
    }
    if (format.kind === 'negotiation') {
      return <NegotiationSetupForm location={location} area={step.area} format={format} onBack={back} onDone={() => setStep({ kind: 'areas' })} />
    }
    if (format.kind === 'meeting') {
      return <MeetingSetupForm location={location} area={step.area} format={format} onBack={back} onDone={() => setStep({ kind: 'areas' })} />
    }
    if (format.kind === 'sales') {
      return <SalesSetupForm location={location} area={step.area} format={format} onBack={back} onDone={() => setStep({ kind: 'areas' })} />
    }
    if (format.kind === 'leadership') {
      return <LeadershipSetupForm location={location} area={step.area} format={format} onBack={back} onDone={() => setStep({ kind: 'areas' })} />
    }
    if (format.kind === 'interview') {
      return (
        <InterviewSetupForm
          key={journey?.blueprintId ?? 'new'}
          location={location}
          area={step.area}
          format={format}
          journey={journey}
          onBack={() => {
            setJourney(undefined)
            back()
          }}
          onDone={() => {
            setJourney(undefined)
            setStep({ kind: 'areas' })
          }}
        />
      )
    }

    return (
      <div key="setup" className="anim-fade mt-4">
        <StepHeader title={format.label} hint="Set up your session" onBack={back} />

        {format.askPosture && (
          <>
            <div className="eyebrow mt-4">Posture</div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {(['sitting', 'standing'] as const).map((p) => {
                const Icon = p === 'sitting' ? IconChair : IconStanding
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={posture === p}
                    onClick={() => setPosture(p)}
                    className={cn(
                      'flex h-10 items-center justify-center gap-2 rounded-xl border text-[12.5px] font-medium transition-all duration-200',
                      posture === p ? optionActive : optionIdle,
                    )}
                  >
                    <Icon width={15} height={15} />
                    {p === 'sitting' ? 'Sitting' : 'Standing'}
                  </button>
                )
              })}
            </div>
          </>
        )}

        {format.destination !== 'meeting' && format.destination !== 'drill' && (
          <Section title="Slides" hint="Optional">
            <DeckPicker />
          </Section>
        )}

        <Duration minutes={minutes} setMinutes={setMinutes} />

        <Button
          variant="primary"
          className="mt-4 w-full"
          onClick={() => {
            setSession({
              locationId: location.id,
              area: step.area,
              format,
              posture: format.askPosture ? posture : undefined,
              minutes,
            })
            setStep({ kind: 'areas' })
          }}
        >
          <IconCheck width={15} height={15} />
          Confirm session
        </Button>
      </div>
    )
  }

  const selectable = location.practiceAreas.some((area) => PRACTICE_FORMATS[area])
  // The Practice Center is the only place with progress; nothing else depends on it.
  const practiceCenter = location.id === 'practice-center'
  const openDrill = (drillId: string) => {
    const area = location.practiceAreas.find((a) => (PRACTICE_FORMATS[a] ?? []).some((f) => f.id === drillId))
    if (area) openArea(area)
  }

  return (
    <div key="areas" className="mt-4">
      {practiceCenter && <PracticeHeader onOpenDrill={openDrill} />}

      <div className={cn('flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.12em] text-faint', practiceCenter && 'mt-3')}>
        <IconLayers width={12} height={12} />
        {practiceCenter ? 'DRILLS' : 'PRACTICE AREAS HERE'}
      </div>

      {ready && (
        <div className="anim-fade mt-2 flex items-center gap-2 rounded-xl border border-jade-400/30 bg-jade-500/10 px-3 py-2">
          <IconTimer width={14} height={14} className="shrink-0 text-jade-400" />
          <div className="min-w-0 flex-1 text-[12px] font-medium leading-snug text-chalk">{describeSession(ready)}</div>
          <button
            type="button"
            onClick={() => setSession(null)}
            className="shrink-0 text-[11px] font-medium text-faint transition-colors hover:text-chalk"
          >
            Clear
          </button>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {location.practiceAreas.map((area) =>
          PRACTICE_FORMATS[area] ? (
            <button
              key={area}
              type="button"
              onClick={() => openArea(area)}
              className="inline-flex items-center gap-1 rounded-lg border border-jade-400/35 bg-jade-500/10 py-1 pl-2 pr-1.5 text-[11px] font-medium text-jade-400 transition-all duration-200 hover:bg-jade-500/20 active:scale-[0.97]"
            >
              {area}
              {practiceCenter && <DrillLevel drillId={PRACTICE_FORMATS[area]?.[0]?.id} />}
              <IconChevronRight width={12} height={12} />
            </button>
          ) : (
            <span
              key={area}
              className="rounded-lg border border-white/8 bg-white/4 px-2 py-1 text-[11px] font-medium text-mist"
            >
              {area}
            </span>
          ),
        )}
      </div>

      {selectable && !ready && (
        <p className="mt-2 text-[11px] text-faint">
          {touch ? 'Tap' : 'Click'} a highlighted area to set up a session.
        </p>
      )}
    </div>
  )
}
