import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  DURATION_DEFAULT,
  DURATION_MAX,
  DURATION_MIN,
  DURATION_STEP,
  MEETING_ROLES,
  NETWORKING_TAGS,
  EMOTIONAL_SCENARIOS,
  NEGOTIATION_SCENARIOS,
  LEADERSHIP_DOMAINS,
  LEADERSHIP_SCENARIOS,
  SALES_TYPES,
  PRACTICE_FORMATS,
  describeSession,
  presentationFormatOf,
  showsLiveFace,
  type AttachedFile,
  type InterviewMode,
  type InterviewPanel,
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
import { AdmissionSetupForm } from '@/modules/admission/setup/AdmissionSetup'
import { DebateSetupForm } from '@/modules/debate/setup/DebateSetup'
import { ExamSetupForm } from '@/modules/exam/setup/ExamSetup'
import { JourneyReview } from '@/modules/interview/journey/JourneyReview'
import { roundMinutes } from '@/modules/interview/journey/rounds'
import { ApiError } from '@/platform/api/client'
import { createLeadershipSession } from '@/modules/leadership/api'
import { createMeetingSession, MAX_MATERIAL_BYTES } from '@/modules/meeting/api'
import { createNegotiationSession } from '@/modules/negotiation/api'
import { createPresentationSession } from '@/modules/presentation/api'
import { DECK_ACCEPT, DeckError, loadDeck } from '@/lib/loadDeck'
import { createSalesSession } from '@/modules/sales/api'
import { holdFaces } from '@/platform/avatar/faceWarmup'
import { StoryCourseList } from '../practice/StoryCourseList'
import { firebase, firebaseConfigured, NotSignedIn } from '@/platform/firebase'
import { useLiveCollection } from '@/platform/firestore/live'
import { usePracticeProgress } from '@/modules/practice/api'
import { useAppStore, type JourneyRequest } from '@/state/useAppStore'
import { PracticeHeader } from '../practice/PracticeHeader'
import { Button } from '../ui/Button'
import { ThinkingLogo } from '../ui/ThinkingLogo'
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
  /** The file's details, and the file itself for a form that reads it. */
  onChange: (file?: AttachedFile, raw?: File) => void
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
          if (f) onChange({ name: f.name, size: f.size, type: f.type }, f)
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
  const setAccountOpen = useAppStore((s) => s.setAccountOpen)
  const [scenario, setScenario] = useState<NegotiationScenario>('salary')
  const [group, setGroup] = useState(false)
  const [mode, setMode] = useState<InterviewMode>('online')
  const [description, setDescription] = useState('')
  const [field, setField] = useState('')
  const [minutes, setMinutes] = useState(15)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SetupProblem | null>(null)
  const other = scenario === 'other'
  const ready = !other || description.trim().length > 0
  // Only a situation of the user's own needs writing; a preset starts at once.
  const writing = Boolean(description.trim() || field.trim())
  const counterpart =
    scenario === 'salary' ? 'the hiring manager' : scenario === 'deadline' ? 'your manager' : scenario === 'partnership' ? 'the other company' : 'the client'
  // The other side is played live: the session is set up on the server before the user joins it.
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const created = await createNegotiationSession({
        scenario,
        group,
        mode,
        durationMinutes: minutes,
        description: description.trim(),
        field: field.trim(),
      })
      setSession({
        locationId: location.id,
        area,
        // Online is a video call and in person the room: both are the negotiation screen, not the building.
        format: { ...format, destination: 'call' },
        posture: 'sitting',
        minutes,
        negotiation: {
          scenario,
          group,
          mode,
          description: description.trim() || undefined,
          sessionId: created.id,
          people: created.people,
          briefing: created.briefing,
        },
      })
      onDone()
    } catch (e) {
      // Say what is wrong and where to fix it (consent, sign-in, email), not just that it failed.
      setError(describeSetupProblem(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div key="negotiation" className="anim-fade mt-4">
      <StepHeader title={format.label} hint="Set up your negotiation" onBack={onBack} />
      <div className="-mr-2 mt-1 max-h-[min(50vh,26rem)] overflow-y-auto pr-2 short:max-h-[40vh]">
        <Section title="Situation">
          <ChoiceList label="Negotiation situation" value={scenario} options={NEGOTIATION_SCENARIOS} onChange={setScenario} />
        </Section>
        <Section title="Your situation" hint={other ? 'Describe it' : 'Optional: make it yours'}>
          <TextField
            label="Your situation and what you want"
            value={description}
            onChange={setDescription}
            placeholder={
              other
                ? 'E.g. My landlord wants to raise the rent by 15%. I want to keep it under 5%.'
                : 'Optional. E.g. Offer of €55k as a data analyst in Paris; I want €62k.'
            }
            hint={other ? 'Describe the situation and what you want to achieve.' : 'Leave empty to practise the prepared case.'}
          />
          <input
            value={field}
            onChange={(e) => setField(e.target.value)}
            maxLength={80}
            placeholder="Your field or job (optional), e.g. Marketing manager"
            className={cn(textField, 'mt-2')}
          />
        </Section>
        <Section title="Format">
          <Segmented
            label="One person or a group"
            value={group ? 'group' : 'one'}
            onChange={(v) => setGroup(v === 'group')}
            options={[
              { id: 'one', label: 'One-to-one' },
              { id: 'group', label: 'Group' },
            ]}
          />
          <div className="mt-2">
            <Segmented
              label="Online or in person"
              value={mode}
              onChange={setMode}
              options={[
                { id: 'online', label: 'Online' },
                { id: 'in-person', label: 'In person' },
              ]}
            />
          </div>
          <p className="mt-1.5 text-[10.5px] text-faint">
            {mode === 'online' ? 'A video call' : 'In person, across the table'} with{' '}
            {group ? `three people, led by ${counterpart}` : counterpart}.
          </p>
        </Section>
        {busy && writing && (
          // The negotiation is being written for the user's situation: the Atrium mark turns while it works.
          <ThinkingLogo turning expected={25} size={34} label="Writing your negotiation" className="mt-3" />
        )}
        {error && (
          <p className="mt-2 text-[11.5px] text-[#fca5a5]">
            {error.text}
            {error.account && (
              <button type="button" onClick={() => setAccountOpen(true)} className="ml-1.5 font-semibold text-chalk underline">
                Open account
              </button>
            )}
          </p>
        )}
        <Duration minutes={minutes} setMinutes={setMinutes} />
      </div>
      <Button variant="primary" className="mt-4 w-full" disabled={!ready || busy} onClick={() => void confirm()}>
        <IconCheck width={15} height={15} />
        {busy ? (writing ? 'This takes about 20–30 seconds' : 'Setting up…') : ready ? 'Confirm session' : 'Describe your situation'}
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
  const setAccountOpen = useAppStore((s) => s.setAccountOpen)
  const [role, setRole] = useState<MeetingRole>('participant')
  const [topic, setTopic] = useState('')
  const [group, setGroup] = useState(true)
  const [mode, setMode] = useState<InterviewMode>('online')
  const [material, setMaterial] = useState<AttachedFile>()
  const [materialFile, setMaterialFile] = useState<File>()
  const [minutes, setMinutes] = useState(20)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SetupProblem | null>(null)
  const tooBig = (material?.size ?? 0) > MAX_MATERIAL_BYTES
  const ready = topic.trim().length > 0 && !tooBig
  // The others are played live: the meeting is written from the topic and material before the user joins.
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const created = await createMeetingSession({
        role,
        topic: topic.trim(),
        group,
        mode,
        durationMinutes: minutes,
        material: materialFile,
      })
      setSession({
        locationId: location.id,
        area,
        // Online is a video call and in person the room: both are the meeting screen, not the building.
        format: { ...format, destination: 'call' },
        posture: 'sitting',
        minutes,
        meeting: {
          role,
          topic: topic.trim(),
          group,
          mode,
          material,
          sessionId: created.id,
          people: created.people,
          briefing: created.briefing,
        },
      })
      onDone()
    } catch (e) {
      // Say what is wrong and where to fix it (consent, sign-in, email), not just that it failed.
      setError(describeSetupProblem(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div key="meeting" className="anim-fade mt-4">
      <StepHeader title={format.label} hint="Set up your meeting" onBack={onBack} />
      <div className="-mr-2 mt-1 max-h-[min(50vh,26rem)] overflow-y-auto pr-2 short:max-h-[40vh]">
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
        <Section title="Material" hint={tooBig ? 'Larger than 8 MB' : 'Optional: the meeting is built on it'}>
          <FilePick
            label="PDF, Word, PowerPoint or text"
            file={material}
            onChange={(file, raw) => {
              setMaterial(file)
              setMaterialFile(raw)
            }}
            accept=".pdf,.docx,.pptx,.txt,.md"
          />
        </Section>
        <Section title="Format">
          <Segmented
            label="One colleague or a group"
            value={group ? 'group' : 'one'}
            onChange={(v) => setGroup(v === 'group')}
            options={[
              { id: 'one', label: 'One-to-one' },
              { id: 'group', label: 'Group' },
            ]}
          />
          <div className="mt-2">
            <Segmented
              label="Online or in person"
              value={mode}
              onChange={setMode}
              options={[
                { id: 'online', label: 'Online' },
                { id: 'in-person', label: 'In person' },
              ]}
            />
          </div>
          <p className="mt-1.5 text-[10.5px] text-faint">
            {mode === 'online' ? 'A video call' : 'In person, around the table'} with{' '}
            {group ? 'three colleagues' : 'one colleague'}.{role === 'leader' && ' You open and run it.'}
          </p>
        </Section>
        {busy && (
          // The meeting is being written from the topic and material: the Atrium mark turns while it works.
          <ThinkingLogo turning expected={25} size={34} label="Preparing your meeting" className="mt-3" />
        )}
        {error && (
          <p className="mt-2 text-[11.5px] text-[#fca5a5]">
            {error.text}
            {error.account && (
              <button type="button" onClick={() => setAccountOpen(true)} className="ml-1.5 font-semibold text-chalk underline">
                Open account
              </button>
            )}
          </p>
        )}
        <Duration minutes={minutes} setMinutes={setMinutes} />
      </div>
      <Button variant="primary" className="mt-4 w-full" disabled={!ready || busy} onClick={() => void confirm()}>
        <IconCheck width={15} height={15} />
        {busy ? 'This takes about 20–30 seconds' : ready ? 'Confirm session' : tooBig ? 'Choose a smaller file' : 'Add the topic & context'}
      </Button>
    </div>
  )
}

/** Presentation: the talk, who it is for, the slides, and what the audience's questions are about. */
function PresentationSetupForm({
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
  const setAccountOpen = useAppStore((s) => s.setAccountOpen)
  const deck = useAppStore((s) => s.deck)
  const setDeck = useAppStore((s) => s.setDeck)
  const [title, setTitle] = useState('')
  const [audience, setAudience] = useState('')
  const [questions, setQuestions] = useState<'talk' | 'slides'>('talk')
  const [minutes, setMinutes] = useState(10)
  // The slides as picked: shown from the rendered deck, read for their text on the server.
  const [slidesFile, setSlidesFile] = useState<File>()
  const [loading, setLoading] = useState<string | null>(null)
  const [slideError, setSlideError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SetupProblem | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const pickSlides = async (list: FileList | null) => {
    const files = list ? [...list] : []
    if (files.length === 0) return
    setSlideError(null)
    setLoading('Preparing slides…')
    try {
      setDeck(await loadDeck(files, (done, total) => setLoading(total === 0 ? 'Converting PowerPoint…' : `Preparing slides… ${done}/${total}`)))
      setSlidesFile(files[0])
    } catch (e) {
      setSlideError(e instanceof DeckError ? e.message : 'These slides couldn’t be opened.')
    } finally {
      setLoading(null)
    }
  }
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const created = await createPresentationSession({
        format: presentationFormatOf(format),
        questions,
        title: title.trim(),
        audience: audience.trim(),
        durationMinutes: minutes,
        slides: deck ? slidesFile : undefined,
      })
      setSession({
        locationId: location.id,
        area,
        // All three formats are the presentation screen, with a live audience.
        format: { ...format, destination: 'call' },
        posture: 'standing',
        minutes,
        presentation: {
          format: presentationFormatOf(format),
          questions,
          title: title.trim() || undefined,
          sessionId: created.id,
          people: created.people,
          briefing: created.briefing,
        },
      })
      onDone()
    } catch (e) {
      // Say what is wrong and where to fix it (consent, sign-in, email), not just that it failed.
      setError(describeSetupProblem(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div key="presentation" className="anim-fade mt-4">
      <StepHeader title={format.label} hint="Set up your presentation" onBack={onBack} />
      <div className="-mr-2 mt-1 max-h-[min(50vh,26rem)] overflow-y-auto pr-2 short:max-h-[40vh]">
        <Section title="Your talk">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Title (optional), e.g. Q3 results and the plan for Q4"
            className={textField}
          />
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            maxLength={300}
            placeholder="Who it is for (optional), e.g. the leadership team"
            className={cn(textField, 'mt-2')}
          />
        </Section>
        <Section title="Slides" hint="Optional: the questions are built on them">
          <input
            ref={picker}
            type="file"
            accept={DECK_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              void pickSlides(e.target.files)
              e.target.value = ''
            }}
          />
          {deck ? (
            <div className="flex h-10 items-center gap-2 rounded-xl border border-jade-400/30 bg-jade-500/10 pl-3 pr-1.5">
              <IconFile width={15} height={15} className="shrink-0 text-jade-400" />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[12px] font-medium text-chalk">{deck.name}</div>
                <div className="text-[10px] text-faint">{deck.slides.length} slides</div>
              </div>
              <button
                type="button"
                aria-label="Remove slides"
                onClick={() => {
                  setDeck(null)
                  setSlidesFile(undefined)
                }}
                className="grid size-7 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-white/8 hover:text-chalk"
              >
                <IconClose width={13} height={13} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={Boolean(loading)}
              className="flex h-10 w-full items-center gap-2 rounded-xl border border-dashed border-white/8 bg-white/4 px-3 text-left text-[12.5px] font-medium text-mist transition-all duration-200 hover:bg-white/8 hover:text-chalk"
            >
              <IconUpload width={15} height={15} className="shrink-0" />
              <span className="flex-1">{loading ?? 'Upload your slides'}</span>
              <span className="text-[10.5px] text-faint">PDF or PowerPoint</span>
            </button>
          )}
          {slideError && <p className="mt-1 text-[10.5px] text-[#fca5a5]">{slideError}</p>}
        </Section>
        <Section title="Questions">
          <Segmented
            label="What the audience asks about"
            value={questions}
            onChange={setQuestions}
            options={[
              { id: 'talk', label: 'My talk & slides' },
              { id: 'slides', label: 'My slides only' },
            ]}
          />
          <p className="mt-1.5 text-[10.5px] text-faint">
            {questions === 'talk'
              ? 'The audience listens to your whole talk in silence, then asks about what you said and your slides.'
              : 'The audience does not hear your talk; after it, they ask about your slides.'}
          </p>
        </Section>
        {busy && (
          // The audience is being written from the talk and slides: the Atrium mark turns while it works.
          <ThinkingLogo turning expected={25} size={34} label="Preparing your audience" className="mt-3" />
        )}
        {error && (
          <p className="mt-2 text-[11.5px] text-[#fca5a5]">
            {error.text}
            {error.account && (
              <button type="button" onClick={() => setAccountOpen(true)} className="ml-1.5 font-semibold text-chalk underline">
                Open account
              </button>
            )}
          </p>
        )}
        <Duration minutes={minutes} setMinutes={setMinutes} />
      </div>
      <Button variant="primary" className="mt-4 w-full" disabled={busy || Boolean(loading)} onClick={() => void confirm()}>
        <IconCheck width={15} height={15} />
        {busy ? 'This takes about 20–30 seconds' : 'Confirm session'}
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
  const setAccountOpen = useAppStore((s) => s.setAccountOpen)
  const [type, setType] = useState<SalesType>('pitch-demo')
  const [mode, setMode] = useState<InterviewMode>('online')
  const [minutes, setMinutes] = useState(15)
  // The deal is written for what the user actually sells: someone else's objections teach little.
  const [product, setProduct] = useState('')
  const [company, setCompany] = useState('')
  const [customer, setCustomer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SetupProblem | null>(null)
  // An outreach call is remote by definition.
  const remoteOnly = type === 'call-outreach'
  const investors = type === 'investor-pitch'
  const effectiveMode: InterviewMode = remoteOnly ? 'online' : mode
  const who = investors ? 'three investors' : type === 'account-management' ? 'your client' : 'a prospect'
  const ready = product.trim().length > 1
  // The other side is played live: the session is set up on the server before the user joins it.
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const created = await createSalesSession({
        type,
        mode: effectiveMode,
        durationMinutes: minutes,
        product: product.trim(),
        company: company.trim(),
        customer: investors ? '' : customer.trim(),
      })
      setSession({
        locationId: location.id,
        area,
        // Online is a video call and in person a meeting room: both are the sales screen, not the building.
        format: { ...format, destination: 'call' },
        posture: 'sitting',
        minutes,
        sales: { type, mode: effectiveMode, sessionId: created.id, people: created.people, briefing: created.briefing },
      })
      onDone()
    } catch (e) {
      // Say what is wrong and where to fix it (consent, sign-in, email), not just that it failed.
      setError(describeSetupProblem(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div key="sales" className="anim-fade mt-4">
      <StepHeader title={format.label} hint="Set up your sales session" onBack={onBack} />
      <div className="-mr-2 mt-1 max-h-[min(50vh,26rem)] overflow-y-auto pr-2 short:max-h-[40vh]">
        <Section title="Situation">
          <ChoiceList label="Sales situation" value={type} options={SALES_TYPES} onChange={setType} />
        </Section>
        <Section
          title={investors ? 'Your startup' : 'What you sell'}
          hint={ready ? undefined : 'So the deal is your kind of deal'}
        >
          <input
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            maxLength={200}
            placeholder={
              investors
                ? 'What your startup does, e.g. AI bookkeeping for small restaurants'
                : 'Your product or service, e.g. cloud accounting software for SMEs'
            }
            className={textField}
          />
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            maxLength={80}
            placeholder={investors ? 'Startup name (optional)' : 'Your company (optional)'}
            className={cn(textField, 'mt-2')}
          />
          {!investors && (
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              maxLength={120}
              placeholder="Who you sell to (optional), e.g. hospitals, retail chains"
              className={cn(textField, 'mt-2')}
            />
          )}
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
            {effectiveMode === 'online' ? 'A video call' : 'In person, across the table'} with {who}.
            {remoteOnly && ' Outreach happens on a call.'}
          </p>
        </Section>
        {busy && (
          // The deal is being written for what the user sells: the Atrium mark turns while it works.
          <ThinkingLogo turning expected={25} size={34} label="Writing your deal for what you sell" className="mt-3" />
        )}
        {error && (
          <p className="mt-2 text-[11.5px] text-[#fca5a5]">
            {error.text}
            {error.account && (
              <button type="button" onClick={() => setAccountOpen(true)} className="ml-1.5 font-semibold text-chalk underline">
                Open account
              </button>
            )}
          </p>
        )}
        <Duration minutes={minutes} setMinutes={setMinutes} />
      </div>
      <Button variant="primary" className="mt-4 w-full" disabled={!ready || busy} onClick={() => void confirm()}>
        <IconCheck width={15} height={15} />
        {busy ? 'This takes about 20–30 seconds' : ready ? 'Confirm session' : investors ? 'Describe your startup' : 'Say what you sell'}
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
  const [minutes, setMinutes] = useState(20)
  // The call is set in the user's own field: a scenario from someone else's job teaches nothing.
  const [domain, setDomain] = useState<string>()
  const [otherDomain, setOtherDomain] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const field = domain === 'other' ? otherDomain.trim() : domain
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SetupProblem | null>(null)
  const setAccountOpen = useAppStore((s) => s.setAccountOpen)
  const ready = Boolean(field) && (mode === 'full' || Boolean(scenario))
  // The team's live faces need the face server, which takes a minute to start: start it now.
  useEffect(() => holdFaces(), [])
  // The team is played live: the call is set up on the server before the user joins it.
  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const chosen = mode === 'scenario' ? scenario : undefined
      const created = await createLeadershipSession({
        mode,
        scenario: chosen,
        durationMinutes: minutes,
        domain: field,
        jobTitle: jobTitle.trim(),
      })
      setSession({
        locationId: location.id,
        area,
        format,
        posture: 'sitting',
        minutes,
        leadership: { mode, scenario: chosen, sessionId: created.id, team: created.team, briefing: created.briefing },
      })
      onDone()
    } catch (e) {
      // Say what is wrong and where to fix it (consent, sign-in, email), not just that it failed.
      setError(describeSetupProblem(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div key="leadership" className="anim-fade mt-4">
      <StepHeader title={format.label} hint="Set up your leadership session" onBack={onBack} />
      <div className="-mr-2 mt-1 max-h-[min(50vh,26rem)] overflow-y-auto pr-2 short:max-h-[40vh]">
        <Section title="Your field" hint={field ? undefined : 'So the situations are your kind of work'}>
          <ChoiceList label="Your field" value={domain} options={LEADERSHIP_DOMAINS} onChange={setDomain} columns={2} />
          {domain === 'other' && (
            <input
              value={otherDomain}
              onChange={(e) => setOtherDomain(e.target.value)}
              maxLength={80}
              placeholder="e.g. Architecture firm, NGO, public administration"
              className={cn(textField, 'mt-2')}
            />
          )}
          <input
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            maxLength={80}
            placeholder="Your job title (optional), e.g. Engineering manager"
            className={cn(textField, 'mt-2')}
          />
        </Section>
        <Section title="Practice">
          <ChoiceList
            label="Full simulation or one scenario"
            value={mode}
            onChange={(m) => {
              setMode(m)
              if (m === 'full') setScenario(undefined)
            }}
            options={[
              {
                id: 'full',
                label: 'Full leadership simulation',
                note: 'A team call where a slipped launch, new projects and a conflict all come up',
              },
              { id: 'scenario', label: 'Practice a specific scenario', note: 'Pick one situation to work on' },
            ]}
          />
        </Section>
        {mode === 'scenario' && (
          <Section title="Scenario" hint={scenario ? undefined : 'Choose one'}>
            <ChoiceList label="Leadership scenario" value={scenario} options={LEADERSHIP_SCENARIOS} onChange={setScenario} />
          </Section>
        )}
        <p className="mt-2 text-[10.5px] text-faint">
          A video call with your team — Laura, Marcus and Nadia, in roles from your field. You lead it.
        </p>
        {busy && (
          // The scenario is being written for the user's field: the Atrium mark turns while it works.
          <ThinkingLogo turning expected={35} size={34} label="Writing your scenario for your field" className="mt-3" />
        )}
        {error && (
          <p className="mt-2 text-[11.5px] text-[#fca5a5]">
            {error.text}
            {error.account && (
              <button type="button" onClick={() => setAccountOpen(true)} className="ml-1.5 font-semibold text-chalk underline">
                Open account
              </button>
            )}
          </p>
        )}
        <Duration minutes={minutes} setMinutes={setMinutes} />
      </div>
      <Button
        variant="primary"
        className="mt-4 w-full"
        disabled={!ready || busy}
        onClick={() => void confirm()}
      >
        <IconCheck width={15} height={15} />
        {busy ? 'This takes about 30–40 seconds' : ready ? 'Confirm session' : field ? 'Choose a scenario' : 'Choose your field'}
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
export function PracticePicker({
  location,
  onSetupChange,
}: {
  location: Location
  /** Whether a setup form is open: the card around it then hides its own way-in buttons. */
  onSetupChange?: (open: boolean) => void
}) {
  const touch = useCoarsePointer()
  const session = useAppStore((s) => s.session)
  const setSession = useAppStore((s) => s.setSession)

  const journeyRequest = useAppStore((s) => s.journeyRequest)
  const clearJourneyRequest = useAppStore((s) => s.clearJourneyRequest)

  const [step, setStep] = useState<Step>({ kind: 'areas' })
  useEffect(() => {
    onSetupChange?.(step.kind === 'setup')
    return () => onSetupChange?.(false)
  }, [step.kind, onSetupChange])
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

  // The face server takes over a minute to start, so it starts the moment the setup of a session
  // with a face is opened; the setup and the walk in cover the wait.
  const warmFaces = step.kind === 'setup' && showsLiveFace(step.format)
  useEffect(() => (warmFaces ? holdFaces() : undefined), [warmFaces])

  const openArea = (area: string) => {
    const formats = PRACTICE_FORMATS[area] ?? []
    setStep(formats.length === 1 ? { kind: 'setup', area, format: formats[0] } : { kind: 'formats', area })
  }

  if (step.kind === 'formats') {
    const formats = PRACTICE_FORMATS[step.area] ?? []
    return (
      <div key="formats" className="anim-fade mt-4">
        <StepHeader
          title={step.area === 'Storytelling' ? 'Story Course' : step.area}
          hint={step.area === 'Storytelling' ? 'One technique per step, in order' : 'Choose a format'}
          onBack={() => setStep({ kind: 'areas' })}
        />
        {step.area === 'Storytelling' ? (
          <div className="mt-3">
            <StoryCourseList
              onPick={(id) => {
                const format = formats.find((f) => f.id === id)
                if (format) setStep({ kind: 'setup', area: step.area, format })
              }}
            />
          </div>
        ) : (
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
        )}
      </div>
    )
  }

  if (step.kind === 'setup') {
    const { format } = step
    const back = () =>
      setStep((PRACTICE_FORMATS[step.area] ?? []).length === 1 ? { kind: 'areas' } : { kind: 'formats', area: step.area })

    if (format.kind === 'presentation') {
      return <PresentationSetupForm location={location} area={step.area} format={format} onBack={back} onDone={() => setStep({ kind: 'areas' })} />
    }
    if (format.kind === 'debate') {
      return <DebateSetupForm location={location} area={step.area} format={format} onBack={back} onDone={() => setStep({ kind: 'areas' })} />
    }
    if (format.kind === 'admission') {
      return <AdmissionSetupForm location={location} area={step.area} format={format} onBack={back} onDone={() => setStep({ kind: 'areas' })} />
    }
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

        {format.destination !== 'meeting' && format.destination !== 'drill' && format.destination !== 'talk' && (
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
