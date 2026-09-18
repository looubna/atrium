import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import {
  IconArrowLeft,
  IconBoard,
  IconBooks,
  IconCheck,
  IconChevronRight,
  IconClose,
  IconFile,
  IconLink,
  IconText,
  IconUser,
  IconVideo,
} from '@/components/ui/Icon'
import type { PracticeFormat } from '@/data/practice'
import type { Location } from '@/data/types'
import { cn } from '@/lib/utils'
import {
  addMaterialLink,
  addMaterialText,
  analyseCourse,
  createCourse,
  createExamSession,
  deleteMaterial,
  effectiveStyle,
  getAnalysis,
  listCourses,
  listMaterials,
  materialLabel,
  setExamStyle,
  shouldAskStyle,
  uploadMaterial,
  type Analysis,
  type Course,
  type ExamStyle,
  type Material,
} from '@/modules/exam/api'
import { ApiError } from '@/platform/api/client'
import { firebase, firebaseConfigured, NotSignedIn } from '@/platform/firebase'
import { useLiveCollection, useLiveDocument } from '@/platform/firestore/live'
import { useAppStore } from '@/state/useAppStore'
import { AddMaterials, type MaterialDraft } from './AddMaterials'

/**
 * Setting up an oral exam: what you are preparing for, and whatever material you
 * have. Nothing else is asked up front — not the date, the length, the number of
 * questions, the difficulty, nor what each file is. The analyst reads the material
 * and works those out; the one question this screen may ask (how the exam is run)
 * appears only when the material genuinely didn't say.
 */

/** An oral exam runs about this long; short enough to sit again the same evening. */
const EXAM_MINUTES = 20

/** `max_material_bytes` on the server. Checked here too: a refused upload should fail instantly. */
const MAX_FILE_BYTES = 40 * 1_048_576

type Stage = 'prepare' | 'analysing' | 'question' | 'ready'

interface SetupProblem {
  text: string
  /** The fix is in the account sheet (sign in, consent, verify email). */
  account?: boolean
}

function describeProblem(error: unknown): SetupProblem {
  if (error instanceof NotSignedIn || (error instanceof ApiError && error.status === 401)) {
    return { text: 'Sign in to prepare with a live examiner.', account: true }
  }
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'consent_required':
        return { text: 'Allow recording and AI processing in your account first.', account: true }
      case 'email_not_verified':
        return { text: 'Verify your email address, then try again.', account: true }
      case 'quota_exceeded':
        return { text: "You've reached today's practice limit. It resets tomorrow." }
      case 'rate_limited':
        return { text: 'Too many attempts. Try again in a minute.' }
      case 'unsupported_media':
        return { text: "That file couldn't be read. PDF, PowerPoint, Word, text and photos all work." }
      case 'payload_too_large':
        return { text: 'That file is too large. Split it, or upload the chapters you need.' }
      case 'unavailable':
        return { text: 'Preparation is paused right now. Try again later.' }
      default:
        return { text: error.message }
    }
  }
  if (error instanceof Error && error.message.includes('not configured')) {
    return { text: "Accounts aren't available in this build." }
  }
  return { text: 'Could not reach Atrium. Check your connection and try again.' }
}

const STAGE_TEXT: Record<string, string> = {
  starting: 'Opening your materials…',
  reading: 'Reading your materials…',
  repair: 'Going over it once more…',
  format: 'Checking how your exam is run…',
  done: 'Ready',
}

const SOURCE_ICON = { file: IconFile, link: IconLink, text: IconText }

/**
 * Why an analysis stopped, in the student's terms. The server stores the exception's name,
 * and most of them mean "the model didn't answer" — which is not the student's material's
 * fault and must not be described as if it were.
 */
export function analysisFailure(reason?: string): string {
  if (reason === 'no_readable_material') {
    return "I couldn't read any of that. Scanned pages and photos need to be clear enough to read."
  }
  if (reason === 'course_deleted') return 'That course is no longer here.'
  // AiUnavailable, ClientError, ModelBusy, StructuredOutputError, a timeout…
  return "The AI service didn't answer, so I couldn't read your materials. They are saved — try again."
}

function MaterialRow({ material, onRemove }: { material: Material; onRemove: () => void }) {
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
        <div className="truncate text-[12px] font-medium text-chalk">{material.detectedTitle || material.name}</div>
        <div className="truncate text-[10px] text-faint">
          {material.status === 'processing'
            ? 'Reading…'
            : failed
              ? "Couldn't be read"
              : materialLabel(material.detectedType)}
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

/** "I found 5 materials" plus what they turned out to be — shown only once there are some. */
function FoundSummary({ materials }: { materials: Material[] }) {
  const readable = materials.filter((m) => m.status !== 'failed')
  const kinds = Array.from(
    new Set(readable.map((m) => materialLabel(m.detectedType)).filter((label) => label !== 'Course material')),
  )
  if (readable.length === 0) return null
  return (
    <div className="anim-fade mt-3 rounded-xl border border-jade-400/30 bg-jade-500/10 px-3 py-2.5">
      <div className="text-[12.5px] font-medium text-chalk">
        {readable.length === 1 ? 'I found 1 material.' : `I found ${readable.length} materials.`}
      </div>
      {kinds.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {kinds.map((kind) => (
            <span
              key={kind}
              className="inline-flex items-center gap-1 rounded-lg bg-white/6 px-1.5 py-0.5 text-[10.5px] font-medium text-mist"
            >
              <IconCheck width={11} height={11} className="text-jade-400" />
              {kind}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const STYLE_OPTIONS: { id: ExamStyle; label: string; note: string; icon: typeof IconUser }[] = [
  {
    id: 'oral_questions',
    label: 'The professor asks questions',
    note: 'You sit across the desk and answer out loud',
    icon: IconUser,
  },
  {
    id: 'board_work',
    label: 'I solve problems on the board',
    note: 'You work at the board while the examiner watches',
    icon: IconBoard,
  },
  { id: 'unknown', label: "I'm not sure", note: 'We decide from your material and how your course runs', icon: IconBooks },
]

export function ExamSetupForm({
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
  const enterExam = useAppStore((s) => s.enter)
  const setAccountOpen = useAppStore((s) => s.setAccountOpen)

  const [stage, setStage] = useState<Stage>('prepare')
  const [subject, setSubject] = useState('')
  const [course, setCourse] = useState<Course | null>(null)
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const [saved, setSaved] = useState<Course[]>([])
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<'adding' | 'starting' | 'beginning' | null>(null)
  const [problem, setProblem] = useState<SetupProblem | null>(null)
  const [answeredStyle, setAnsweredStyle] = useState<ExamStyle | null>(null)
  const [camera, setCamera] = useState(false)
  const [version, setVersion] = useState(0)
  /** Names of the materials being sent right now: shown as rows so the wait is visible. */
  const [sending, setSending] = useState<string[]>([])
  const subjectField = useRef<HTMLInputElement>(null)

  const courseId = course?.id ?? null
  const uid = firebaseConfigured() ? firebase().auth.currentUser?.uid : undefined

  // The materials, live: each one goes from "Reading…" to what it turned out to be.
  const materialsPath = uid && courseId ? `users/${uid}/courses/${courseId}/materials` : null
  const loaded = useLiveCollection<Material>(
    materialsPath,
    {
      orderByField: 'createdAt',
      max: 60,
      map: (id, data) => ({
        id,
        source: data.source ?? 'file',
        name: String(data.name ?? ''),
        url: data.url ?? null,
        status: data.status ?? 'processing',
        failureReason: data.failureReason ?? null,
        detectedType: data.detectedType ?? null,
        detectedTitle: data.detectedTitle ?? null,
        sizeBytes: data.sizeBytes ?? null,
      }),
    },
    useCallback(() => (courseId ? listMaterials(courseId) : Promise.resolve([])), [courseId]),
    { keepPolling: (items) => !items || items.some((m) => m.status === 'processing'), version },
  )
  // The listener returns newest first; the student added them in order.
  const materials = useMemo(() => (loaded ? [...loaded].reverse() : []), [loaded])

  // The analysis, live: its progress is what the "reading your materials" screen shows.
  const analysisPath = uid && courseId && analysisId ? `users/${uid}/courses/${courseId}/analyses/${analysisId}` : null
  const analysis = useLiveDocument<Analysis>(
    analysisPath,
    useCallback(
      () => (courseId && analysisId ? getAnalysis(courseId, analysisId) : Promise.resolve(null as never)),
      [courseId, analysisId],
    ),
    // Nothing to wait for until an analysis has been asked for.
    { keepPolling: (a) => Boolean(analysisId) && (!a || a.status === 'queued' || a.status === 'analyzing') },
  )

  // Courses prepared before: the student comes back to their material, not to an empty box.
  useEffect(() => {
    let live = true
    listCourses()
      .then((items) => live && setSaved(items.filter((c) => c.materialCount > 0)))
      .catch(() => {
        /* signed out or offline: just no shortcuts */
      })
    return () => {
      live = false
    }
  }, [])

  const run = async (kind: 'adding' | 'starting' | 'beginning', work: () => Promise<void>) => {
    setBusy(kind)
    setProblem(null)
    try {
      await work()
    } catch (error) {
      setProblem(describeProblem(error))
    } finally {
      setBusy(null)
    }
  }

  const ensureCourse = async (): Promise<Course> => {
    if (course) return course
    const created = await createCourse(subject.trim())
    setCourse(created)
    return created
  }

  const addMaterial = (draft: MaterialDraft) => {
    const names =
      draft.kind === 'files' ? draft.files.map((f) => f.name) : [draft.kind === 'link' ? draft.url : 'Pasted text']
    setSending((current) => [...current, ...names])
    const done = () => setSending((current) => current.filter((name) => !names.includes(name)))
    return run('adding', async () => {
      try {
        const current = await ensureCourse()
        if (draft.kind === 'files') {
          const tooBig = draft.files.filter((file) => file.size > MAX_FILE_BYTES)
          // One at a time, so a file that is refused doesn't take the others with it.
          for (const file of draft.files) {
            if (file.size > MAX_FILE_BYTES) continue
            await uploadMaterial(current.id, file)
          }
          if (tooBig.length > 0) {
            setProblem({
              text: `${tooBig.map((f) => f.name).join(', ')} — over 40 MB. Upload the chapters or weeks you need.`,
            })
          }
        } else if (draft.kind === 'link') {
          await addMaterialLink(current.id, draft.url)
        } else {
          await addMaterialText(current.id, draft.text)
        }
        setVersion((v) => v + 1)
        // Adding material invalidates an older analysis: it was built from less.
        setAnalysisId(null)
      } finally {
        done()
      }
    })
  }

  const removeMaterial = (materialId: string) =>
    run('adding', async () => {
      if (!courseId) return
      await deleteMaterial(courseId, materialId)
      setVersion((v) => v + 1)
      setAnalysisId(null)
    })

  const startPreparation = () =>
    run('starting', async () => {
      const current = await ensureCourse()
      if (analysisId && analysis?.status === 'ready') {
        // Nothing has changed since these materials were read: don't read (and charge) again.
        setStage(shouldAskStyle(analysis, course) ? 'question' : 'ready')
        return
      }
      if (materials.filter((m) => m.status !== 'failed').length === 0) {
        // Nothing to read: go straight on rather than blocking. The exam runs on the subject alone.
        setStage('question')
        return
      }
      const { analysisId: id } = await analyseCourse(current.id)
      setAnalysisId(id)
      setStage('analysing')
    })

  const answerStyle = (style: ExamStyle) =>
    run('starting', async () => {
      setAnsweredStyle(style)
      if (courseId) setCourse(await setExamStyle(courseId, style))
      setStage('ready')
    })

  const begin = () =>
    run('beginning', async () => {
      const usable = analysis?.status === 'ready' ? analysis : null
      const created = await createExamSession({
        courseId: usable && courseId ? courseId : undefined,
        analysisId: usable ? usable.id : undefined,
        style: answeredStyle ?? 'unknown',
        durationMinutes: EXAM_MINUTES,
      })
      setSession({
        locationId: location.id,
        area,
        format,
        minutes: EXAM_MINUTES,
        exam: {
          subject: (course?.subject ?? subject).trim(),
          courseId: usable && courseId ? courseId : undefined,
          analysisId: usable?.id,
          style: created.examStyle,
          sessionId: created.id,
          camera,
        },
      })
      // Straight into the exam room: the student asked to start, not to find another button.
      onDone()
      enterExam()
    })

  // Once the analyst is done, either ask the one question that is still open, or go.
  const analysisReady = analysis?.status === 'ready'
  const askStyle = analysisReady && shouldAskStyle(analysis, course)
  useEffect(() => {
    if (stage !== 'analysing' || !analysisReady) return
    setStage(askStyle ? 'question' : 'ready')
  }, [stage, analysisReady, askStyle])

  /** The subject is the one thing we need first, so ask for it where the eye is, never with a dead button. */
  const askForMaterials = () => {
    if ((course?.subject ?? subject).trim().length >= 2) {
      setProblem(null)
      setAdding(true)
      return
    }
    setProblem({ text: "Tell me what you're preparing for first — the subject or course name." })
    subjectField.current?.focus()
  }

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

  const header = (title: string, hint: string, back: () => void) => (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={back}
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

  if (stage === 'analysing') {
    return (
      <div key="analysing" className="anim-fade mt-4">
        {header(course?.subject || subject, 'Reading what you gave me', () => setStage('prepare'))}
        <Analysing analysis={analysis} materials={materials} />
        {analysis?.status === 'failed' && (
          <div className="mt-3 flex flex-col gap-1.5">
            <p className="text-[12px] text-[#fca5a5]" role="alert">
              {analysisFailure(analysis.failureReason)}
            </p>
            <Button variant="primary" disabled={busy !== null} onClick={() => void startPreparation()}>
              Try again
            </Button>
            <Button variant="ghost" onClick={() => setStage('question')}>
              Start without them
            </Button>
          </div>
        )}
        {problemBanner}
      </div>
    )
  }

  if (stage === 'question') {
    return (
      <div key="question" className="anim-fade mt-4">
        {header('How will your oral exam work?', 'Optional — it only changes how the room looks', () =>
          setStage(analysisReady ? 'analysing' : 'prepare'),
        )}
        <div className="mt-3 flex flex-col gap-1.5">
          {STYLE_OPTIONS.map((option) => {
            const Icon = option.icon
            return (
              <button
                key={option.id}
                type="button"
                disabled={busy !== null}
                onClick={() => void answerStyle(option.id)}
                className="group flex items-center gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-2.5 text-left transition-all duration-200 hover:border-jade-400/40 hover:bg-jade-500/10 active:scale-[0.99] disabled:opacity-60"
              >
                <Icon width={16} height={16} className="shrink-0 text-jade-400" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium text-chalk">{option.label}</div>
                  <div className="mt-0.5 text-[10.5px] text-faint">{option.note}</div>
                </div>
                <IconChevronRight width={15} height={15} className="shrink-0 text-faint group-hover:text-jade-400" />
              </button>
            )
          })}
        </div>
        {problemBanner}
      </div>
    )
  }

  if (stage === 'ready') {
    const style = answeredStyle && answeredStyle !== 'unknown' ? answeredStyle : effectiveStyle(analysis, course)
    return (
      <div key="ready" className="anim-fade mt-4">
        {header(course?.subject || subject, 'Ready when you are', () => setStage('prepare'))}
        <div className="-mr-2 mt-3 max-h-[min(46vh,24rem)] overflow-y-auto pr-2 short:max-h-[38vh]">
          <ExamBrief analysis={analysisReady ? analysis : null} style={style} />
          <button
            type="button"
            role="switch"
            aria-checked={camera}
            onClick={() => setCamera((on) => !on)}
            className={cn(
              'mt-3 flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200',
              camera
                ? 'border-jade-400/40 bg-jade-500/15'
                : 'border-white/8 bg-white/4 hover:bg-white/8',
            )}
          >
            <IconVideo width={16} height={16} className={cn('mt-0.5 shrink-0', camera ? 'text-jade-400' : 'text-mist')} />
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium text-chalk">Feedback on how you come across</span>
              <span className="mt-0.5 block text-[10.5px] leading-snug text-faint">
                Turns on your camera so your feedback can cover eye contact, expression and composure. The exam works
                the same without it.
              </span>
            </span>
            <span
              className={cn(
                'mt-0.5 grid size-4 shrink-0 place-items-center rounded-md border',
                camera ? 'border-jade-400 bg-jade-400 text-ink-900' : 'border-white/25',
              )}
            >
              {camera && <IconCheck width={11} height={11} />}
            </span>
          </button>
        </div>
        <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
          About {EXAM_MINUTES} minutes with a live examiner. The exam is recorded so your feedback can point to exact
          moments.
        </p>
        <Button variant="primary" className="mt-3 w-full" disabled={busy !== null} onClick={() => void begin()}>
          <IconCheck width={15} height={15} />
          {busy === 'beginning' ? 'Preparing your examiner…' : 'Start exam'}
        </Button>
        {problemBanner}
      </div>
    )
  }

  const readable = materials.filter((m) => m.status !== 'failed')
  const reading = materials.some((m) => m.status === 'processing')

  return (
    <div key="prepare" className="relative anim-fade mt-4">
      {header('Prepare for your oral exam', 'Give me whatever you have', onBack)}

      <div className="-mr-2 mt-3 max-h-[min(50vh,26rem)] overflow-y-auto pr-2 short:max-h-[40vh]">
        <label className="block">
          <span className="eyebrow">What are you preparing for?</span>
          <input
            ref={subjectField}
            aria-label="Subject or course name"
            value={course?.subject ?? subject}
            disabled={Boolean(course)}
            maxLength={160}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Fluid Mechanics"
            className="mt-1.5 h-10 w-full rounded-xl border border-white/8 bg-white/4 px-3 text-[13px] text-chalk outline-none placeholder:text-faint focus:border-jade-400/40 disabled:text-mist"
          />
        </label>

        {!course && saved.length > 0 && (
          <section className="mt-4">
            <div className="eyebrow">Or pick up where you left off</div>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {saved.slice(0, 3).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setCourse(item)
                    setSubject(item.subject)
                    setAnalysisId(item.activeAnalysisId)
                  }}
                  className="group flex items-center gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-left transition-all duration-200 hover:border-jade-400/40 hover:bg-jade-500/10 active:scale-[0.99]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-chalk">{item.subject}</div>
                    <div className="truncate text-[11px] text-faint">
                      {item.materialCount} {item.materialCount === 1 ? 'material' : 'materials'}
                    </div>
                  </div>
                  <IconChevronRight width={15} height={15} className="shrink-0 text-faint group-hover:text-jade-400" />
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="mt-4">
          <div className="eyebrow">Add your study materials</div>
          <p className="mt-1 text-[11px] leading-relaxed text-faint">
            Upload your slides, notes, syllabus, textbook, previous exams, or anything your professor provided.
          </p>

          {(materials.length > 0 || sending.length > 0) && (
            <div className="mt-2 flex flex-col gap-1.5">
              {materials.map((material) => (
                <MaterialRow
                  key={material.id}
                  material={material}
                  onRemove={() => void removeMaterial(material.id)}
                />
              ))}
              {sending.map((name) => (
                <div
                  key={name}
                  className="flex h-10 items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-3"
                  role="status"
                >
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-jade-400" aria-hidden />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-[12px] font-medium text-chalk">{name}</div>
                    <div className="text-[10px] text-faint">Sending…</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <FoundSummary materials={materials} />
        </section>
      </div>

      {/* Below the scroll, so the way forward is on screen whatever the window is doing. */}
      {problemBanner}
      <Button
        variant={readable.length > 0 ? 'ghost' : 'primary'}
        className="mt-2.5 w-full"
        disabled={busy === 'adding'}
        onClick={askForMaterials}
      >
        {busy === 'adding' ? 'Adding…' : readable.length > 0 ? '+ Add more materials' : '+ Add materials'}
      </Button>

      {readable.length > 0 ? (
        <div className="anim-fade mt-3">
          <div className="text-[12.5px] font-medium text-chalk">Ready to prepare?</div>
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-faint">
            I'll read everything, work out what you're likely to be asked, and start the exam.
          </p>
          <Button
            variant="primary"
            className="mt-2 w-full"
            disabled={busy !== null || reading}
            onClick={() => void startPreparation()}
          >
            <IconCheck width={15} height={15} />
            {busy === 'starting' ? 'Starting…' : reading ? 'Reading your files…' : 'Start preparation'}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void startPreparation()}
          disabled={busy !== null}
          className="mt-2 w-full text-center text-[11px] text-faint underline-offset-2 transition-colors hover:text-mist hover:underline"
        >
          Start without materials
        </button>
      )}

      {adding && (
        <AddMaterials
          onClose={() => setAdding(false)}
          onAdd={(draft) => {
            setAdding(false)
            void addMaterial(draft)
          }}
        />
      )}
    </div>
  )
}

/** While the analyst works: what it is doing, and what it has found so far. */
function Analysing({ analysis, materials }: { analysis: Analysis | null; materials: Material[] }) {
  const progress = analysis?.progress ?? null
  const stage = progress?.stage ?? 'starting'
  const topics = progress?.topics ?? []
  const settled = useRef(false)
  if (analysis?.status === 'ready') settled.current = true

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <span className="size-1.5 animate-pulse rounded-full bg-jade-400" aria-hidden />
        <span className="text-[12.5px] text-chalk" role="status">
          {analysis?.status === 'failed' ? 'Stopped' : STAGE_TEXT[stage] ?? 'Working…'}
        </span>
        <span className="ml-auto text-[10.5px] tabular-nums text-faint">
          {materials.filter((m) => m.status !== 'failed').length} materials
        </span>
      </div>
      {progress?.busy && (
        <p className="mt-1.5 text-[10.5px] text-faint">The model is busy; this picks up again on its own.</p>
      )}
      {progress?.summary && <p className="mt-2 text-[11.5px] leading-relaxed text-mist">{progress.summary}</p>}
      {topics.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {topics.slice(0, 12).map((topic) => (
            <span
              key={topic.name}
              className={cn(
                'anim-fade rounded-lg border px-1.5 py-0.5 text-[10.5px] font-medium',
                topic.importance === 'high'
                  ? 'border-jade-400/35 bg-jade-500/10 text-jade-400'
                  : 'border-white/8 bg-white/4 text-mist',
              )}
            >
              {topic.name}
            </span>
          ))}
        </div>
      )}
      {progress?.sources && progress.sources.length > 0 && (
        <p className="mt-2 text-[10.5px] text-faint">
          Looked up: {progress.sources.map((s) => s.domain).slice(0, 3).join(' · ')}
        </p>
      )}
    </div>
  )
}

/** What the exam will be, in the fewest words that are still worth reading. */
function ExamBrief({ analysis, style }: { analysis: Analysis | null; style: ExamStyle }) {
  const topics = (analysis?.topics ?? []).slice(0, 8)
  return (
    <div>
      <div className="flex items-center gap-2 rounded-xl border border-jade-400/30 bg-jade-500/10 px-3 py-2">
        {style === 'board_work' ? (
          <IconBoard width={15} height={15} className="shrink-0 text-jade-400" />
        ) : (
          <IconUser width={15} height={15} className="shrink-0 text-jade-400" />
        )}
        <div className="min-w-0 text-[12px] font-medium leading-snug text-chalk">
          {style === 'board_work'
            ? 'You work problems at the board while the examiner questions you.'
            : 'The examiner questions you across the desk.'}
        </div>
      </div>
      {analysis?.examStyleEvidence && (
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">{analysis.examStyleEvidence}</p>
      )}
      {analysis?.courseSummary && (
        <p className="mt-3 text-[11.5px] leading-relaxed text-mist">{analysis.courseSummary}</p>
      )}
      {topics.length > 0 && (
        <section className="mt-3">
          <div className="eyebrow">What you'll be asked about</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {topics.map((topic) => (
              <span
                key={topic.name}
                title={topic.why}
                className={cn(
                  'rounded-lg border px-1.5 py-0.5 text-[10.5px] font-medium',
                  topic.importance === 'high'
                    ? 'border-jade-400/35 bg-jade-500/10 text-jade-400'
                    : 'border-white/8 bg-white/4 text-mist',
                )}
              >
                {topic.name}
              </span>
            ))}
          </div>
        </section>
      )}
      {analysis?.caveats && analysis.caveats.length > 0 && (
        <p className="mt-2 text-[10.5px] leading-relaxed text-faint">{analysis.caveats[0]}</p>
      )}
    </div>
  )
}
