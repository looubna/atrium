import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { IconArrowLeft, IconCheck, IconClose, IconFile, IconLink, IconText } from '@/components/ui/Icon'
import type { PracticeFormat } from '@/data/practice'
import type { Location } from '@/data/types'
import { cn } from '@/lib/utils'
import {
  addMaterialLink,
  addMaterialText,
  createAdmissionSession,
  createPreparation,
  deleteMaterial,
  getPreparation,
  isReady,
  isWorking,
  KIND_LABELS,
  KIND_NOTES,
  kindLabel,
  listMaterials,
  listPreparations,
  uploadMaterial,
  type Material,
  type OpportunityKind,
  type Preparation,
  type Stage,
} from '@/modules/admission/api'
import { PrepDashboard } from '@/modules/admission/prep/PrepDashboard'
import { ApiError } from '@/platform/api/client'
import { NotSignedIn } from '@/platform/firebase'
import { useAppStore } from '@/state/useAppStore'

/**
 * Getting ready for a scholarship or admission interview.
 *
 * Three questions and a folder (§4): which kind of interview, what it is called, and
 * whatever the candidate already wrote for the application. Nothing asks them to say what
 * each document is — that is the analyzer's job, and asking would be asking them to do the
 * work they came here to have done.
 *
 * Research starts the moment the opportunity is named, so the materials step and the
 * checklist share a screen: hunting down a study plan takes a few minutes, which is roughly
 * how long the research takes, and neither should wait for the other.
 */

/** How often the checklist is re-read while work is outstanding. */
const POLL_MS = 2500
/** Scholarship interviews people practise for mostly run about 20 minutes. */
const INTERVIEW_MINUTES = 20

type Step = 'kind' | 'name' | 'materials'

/** The fix is in the account sheet (sign in, consent, verify email). */
interface SetupProblem {
  text: string
  account?: boolean
}

function describeProblem(error: unknown): SetupProblem {
  if (error instanceof NotSignedIn || (error instanceof ApiError && error.status === 401)) {
    return { text: 'Sign in to prepare for an interview.', account: true }
  }
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'consent_required':
        return { text: 'Allow AI processing in your account first.', account: true }
      case 'email_not_verified':
        return { text: 'Verify your email address, then try again.', account: true }
      case 'quota_exceeded':
        return { text: "You've reached the limit for now. Delete one you've finished with." }
      case 'rate_limited':
        return { text: 'Too many attempts. Try again in a minute.' }
      case 'unsupported_media':
        return { text: "That file couldn't be read. PDF, Word, text and photos all work." }
      case 'payload_too_large':
        return { text: 'That file is too large.' }
      case 'unavailable':
        return { text: 'The service is busy right now. Try again in a moment.' }
      default:
        return { text: 'Something went wrong. Try again.' }
    }
  }
  return { text: 'Something went wrong. Try again.' }
}

/** One line of the checklist. The state is the whole point, so it leads. */
function StageRow({ stage }: { stage: Stage }) {
  const done = stage.state === 'done' || stage.state === 'skipped'
  const failed = stage.state === 'failed'
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
          done && 'border-jade-400/50 bg-jade-500/15 text-jade-300',
          failed && 'border-white/15 bg-white/5 text-faint',
          !done && !failed && 'border-white/20',
        )}
      >
        {done && <IconCheck width={10} height={10} />}
        {stage.state === 'running' && <span className="size-1.5 animate-pulse rounded-full bg-chalk/70" />}
      </span>
      <span className="min-w-0">
        <span className={cn('block text-[12.5px]', done || failed ? 'text-mist' : 'text-chalk')}>{stage.label}</span>
        {stage.note && <span className="mt-0.5 block text-[11px] leading-relaxed text-faint">{stage.note}</span>}
      </span>
    </div>
  )
}

export function AdmissionSetupForm({
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
  const setAccountOpen = useAppStore((s) => s.setAccountOpen)

  const [step, setStep] = useState<Step>('kind')
  const [kind, setKind] = useState<OpportunityKind>('both')
  const [name, setName] = useState('')
  const [program, setProgram] = useState('')
  const [prep, setPrep] = useState<Preparation | null>(null)
  const setSession = useAppStore((s) => s.setSession)
  const enterCall = useAppStore((s) => s.enter)
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  /** Into the video call: the professor questions the candidate from this preparation. */
  const startInterview = async () => {
    if (!prep) return
    setJoining(true)
    setJoinError(null)
    try {
      const created = await createAdmissionSession(prep.id, INTERVIEW_MINUTES)
      setSession({
        locationId: location.id,
        area,
        format,
        minutes: INTERVIEW_MINUTES,
        admission: { prepId: prep.id, opportunity: prep.name, sessionId: created.id },
      })
      // Straight into the call: the candidate asked to start, not to find another button.
      onDone()
      enterCall()
    } catch (err) {
      setJoinError(
        err instanceof ApiError && err.status === 429
          ? "You've reached a practice limit for now. Try again later."
          : 'Could not start the interview. Try again in a moment.',
      )
    } finally {
      setJoining(false)
    }
  }
  const [materials, setMaterials] = useState<Material[]>([])
  const [saved, setSaved] = useState<Preparation[]>([])
  const [busy, setBusy] = useState<'creating' | 'adding' | null>(null)
  const [problem, setProblem] = useState<SetupProblem | null>(null)
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  /** Names of the files being sent right now, so the wait is visible rather than implied. */
  const [sending, setSending] = useState<string[]>([])
  const nameField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listPreparations()
      .then(setSaved)
      .catch(() => setSaved([]))
  }, [])

  useEffect(() => {
    if (step === 'name') nameField.current?.focus()
  }, [step])

  // The checklist, while anything on it is still moving.
  useEffect(() => {
    if (!prep || !isWorking(prep)) return
    let live = true
    const timer = window.setInterval(async () => {
      try {
        const next = await getPreparation(prep.id)
        if (live) setPrep(next)
      } catch {
        // A poll that fails is not worth telling the candidate about: the next one is 2.5s away.
      }
    }, POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [prep])

  const refreshMaterials = useCallback(async (prepId: string) => {
    try {
      setMaterials(await listMaterials(prepId))
    } catch {
      /* the list is a convenience; the upload either worked or reported its own error */
    }
  }, [])

  const begin = async () => {
    if (!name.trim() || busy) return
    setBusy('creating')
    setProblem(null)
    try {
      const created = await createPreparation(name.trim(), kind, program.trim())
      setPrep(created)
      setStep('materials')
      void refreshMaterials(created.id)
    } catch (caught) {
      setProblem(describeProblem(caught))
    } finally {
      setBusy(null)
    }
  }

  const addFiles = async (files: FileList | null) => {
    if (!prep || !files?.length) return
    const chosen = [...files]
    setSending((names) => [...names, ...chosen.map((f) => f.name)])
    setProblem(null)
    for (const file of chosen) {
      try {
        await uploadMaterial(prep.id, file)
      } catch (caught) {
        setProblem(describeProblem(caught))
      } finally {
        setSending((names) => names.filter((n) => n !== file.name))
      }
    }
    void refreshMaterials(prep.id)
  }

  const addLink = async () => {
    if (!prep) return
    const url = window.prompt('Link to a page about the scholarship, programme, or your application')
    if (!url?.trim()) return
    setBusy('adding')
    try {
      await addMaterialLink(prep.id, url.trim())
      await refreshMaterials(prep.id)
    } catch (caught) {
      setProblem(describeProblem(caught))
    } finally {
      setBusy(null)
    }
  }

  const addText = async () => {
    if (!prep || !pasted.trim()) return
    setBusy('adding')
    try {
      await addMaterialText(prep.id, pasted.trim())
      setPasted('')
      setPasting(false)
      await refreshMaterials(prep.id)
    } catch (caught) {
      setProblem(describeProblem(caught))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (materialId: string) => {
    if (!prep) return
    setMaterials((list) => list.filter((m) => m.id !== materialId))
    try {
      await deleteMaterial(prep.id, materialId)
    } finally {
      void refreshMaterials(prep.id)
    }
  }

  const header = (title: string, subtitle: string) => (
    <div className="mb-4">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 flex items-center gap-1.5 text-[12px] text-faint transition-colors hover:text-mist"
      >
        <IconArrowLeft width={13} height={13} />
        {area}
      </button>
      <h2 className="text-[17px] font-semibold text-chalk">{title}</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-mist">{subtitle}</p>
    </div>
  )

  const trouble = problem && (
    <div className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
      <p className="text-[12px] leading-relaxed text-mist">{problem.text}</p>
      {problem.account && (
        <button
          type="button"
          onClick={() => setAccountOpen(true)}
          className="mt-1.5 text-[12px] font-medium text-jade-300 hover:text-jade-200"
        >
          Open your account
        </button>
      )}
    </div>
  )

  if (step === 'kind') {
    return (
      <div className="px-1">
        {header('What are you interviewing for?', `At ${location.name}. This decides what the interview listens for.`)}
        <div className="flex flex-col gap-2">
          {(['admission', 'scholarship', 'both'] as OpportunityKind[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setKind(option)
                setStep('name')
              }}
              className="rounded-xl border border-white/10 bg-white/4 px-3.5 py-3 text-left transition-colors hover:bg-white/8"
            >
              <span className="block text-[13.5px] font-medium text-chalk">{KIND_LABELS[option]}</span>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-faint">{KIND_NOTES[option]}</span>
            </button>
          ))}
        </div>
        {saved.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-faint">Carry on with</p>
            {saved.slice(0, 4).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setPrep(item)
                  setKind(item.kind === 'university' ? 'admission' : item.kind)
                  setName(item.name)
                  setStep('materials')
                  void refreshMaterials(item.id)
                }}
                className="mb-1.5 flex w-full items-center justify-between rounded-lg border border-white/8 bg-white/4 px-3 py-2 text-left hover:bg-white/8"
              >
                <span className="text-[12.5px] text-chalk">{item.name}</span>
                <span className="text-[11px] text-faint">{kindLabel(item.kind)}</span>
              </button>
            ))}
          </div>
        )}
        {trouble}
      </div>
    )
  }

  if (step === 'name') {
    return (
      <div className="px-1">
        {header(
          'Which one?',
          'The scholarship, university or programme by name. We look it up before we ask you anything.',
        )}
        <input
          ref={nameField}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void begin()}
          placeholder="e.g. Global Korea Scholarship, or ETH Zurich MSc Robotics"
          className="w-full rounded-lg border border-white/12 bg-white/5 px-3 py-2.5 text-[13px] text-chalk placeholder:text-faint focus:border-white/25 focus:outline-none"
        />
        <input
          value={program}
          onChange={(e) => setProgram(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void begin()}
          placeholder="Programme or department (optional)"
          className="mt-2 w-full rounded-lg border border-white/12 bg-white/5 px-3 py-2.5 text-[13px] text-chalk placeholder:text-faint focus:border-white/25 focus:outline-none"
        />
        <Button
          variant="primary"
          className="mt-3 h-10 w-full"
          disabled={!name.trim() || busy === 'creating'}
          onClick={() => void begin()}
        >
          {busy === 'creating' ? 'Starting…' : 'Start preparing'}
        </Button>
        {trouble}
      </div>
    )
  }

  return (
    <div className="px-1">
      {header(prep?.name ?? name, 'Add whatever you already wrote. We work out what each one is.')}

      {prep && (
        <div className="rounded-xl border border-white/8 bg-white/4 px-3.5 py-2.5">
          {prep.stages.map((stage) => (
            <StageRow key={stage.stage} stage={stage} />
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <label className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/5 px-3 py-2.5 text-[12.5px] text-chalk hover:bg-white/8">
          <IconFile width={14} height={14} />
          Add files
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => void addLink()}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/5 px-3 py-2.5 text-[12.5px] text-chalk hover:bg-white/8"
        >
          <IconLink width={14} height={14} />
          Link
        </button>
        <button
          type="button"
          onClick={() => setPasting((open) => !open)}
          aria-pressed={pasting}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/5 px-3 py-2.5 text-[12.5px] text-chalk hover:bg-white/8"
        >
          <IconText width={14} height={14} />
          Paste
        </button>
      </div>

      {pasting && (
        <div className="mt-2">
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={5}
            placeholder="Paste your personal statement, study plan, or anything else you wrote"
            className="w-full rounded-lg border border-white/12 bg-white/5 px-3 py-2.5 text-[12.5px] text-chalk placeholder:text-faint focus:border-white/25 focus:outline-none"
          />
          <Button
            variant="ghost"
            className="mt-1.5 h-8 px-3 text-[12px]"
            disabled={!pasted.trim() || busy === 'adding'}
            onClick={() => void addText()}
          >
            Add it
          </Button>
        </div>
      )}

      {(materials.length > 0 || sending.length > 0) && (
        <div className="mt-3">
          {materials.map((material) => (
            <div
              key={material.id}
              className="mb-1.5 flex items-center justify-between rounded-lg border border-white/8 bg-white/4 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] text-chalk">{material.title}</span>
                {material.typeLabel && <span className="text-[11px] text-faint">{material.typeLabel}</span>}
              </span>
              <button
                type="button"
                aria-label={`Remove ${material.title}`}
                onClick={() => void remove(material.id)}
                className="ml-2 shrink-0 text-faint hover:text-mist"
              >
                <IconClose width={13} height={13} />
              </button>
            </div>
          ))}
          {sending.map((filename) => (
            <div
              key={filename}
              className="mb-1.5 flex items-center justify-between rounded-lg border border-white/8 bg-white/4 px-3 py-2 opacity-60"
            >
              <span className="truncate text-[12.5px] text-chalk">{filename}</span>
              <span className="ml-2 shrink-0 text-[11px] text-faint">Sending…</span>
            </div>
          ))}
        </div>
      )}

      {/* Once both halves are in, the preparation itself: the questions and why each is here. */}
      {prep && isReady(prep) && <PrepDashboard prepId={prep.id} />}

      {trouble}

      {prep && isReady(prep) ? (
        <>
          <Button variant="primary" className="mt-4 h-10 w-full" disabled={joining} onClick={() => void startInterview()}>
            {joining ? 'Joining the call…' : 'Start the interview'}
          </Button>
          <p className="mt-1.5 text-center text-[11px] leading-relaxed text-faint">
            A video call with a professor from the committee, who has read your application.
          </p>
          {joinError && (
            <p className="mt-1.5 text-center text-[12px] text-[#fca5a5]" role="alert">
              {joinError}
            </p>
          )}
          <Button variant="ghost" className="mt-2 h-9 w-full" disabled={joining} onClick={onDone}>
            Done for now
          </Button>
        </>
      ) : (
        <Button variant="primary" className="mt-4 h-10 w-full" onClick={onDone}>
          Done for now
        </Button>
      )}
      <p className="mt-2 text-center text-[11px] leading-relaxed text-faint">
        {format.note}. You can add more materials at any time.
      </p>
    </div>
  )
}
