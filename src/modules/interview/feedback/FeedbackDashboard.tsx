import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { IconCheck, IconChevronRight, IconClose, IconFile, IconMic, IconTarget, IconVideo } from '@/components/ui/Icon'
import { ThinkingLogo } from '@/components/ui/ThinkingLogo'
import { PRACTICE_FORMATS, type SessionSetup } from '@/data/practice'
import { cn } from '@/lib/utils'
import { ApiError } from '@/platform/api/client'
import { saveFile } from '@/platform/native'
import { ArgumentMapSection } from '@/modules/debate/feedback/ArgumentMap'
import { useAppStore } from '@/state/useAppStore'
import {
  fetchTranscript,
  formatClock,
  getDownloadUrl,
  getFeedback,
  getPlaybackUrl,
  reprocessSession,
  resolveMediaUrl,
  retrySession,
  type ExampleVoice,
  type FeedbackEvent,
  type FeedbackResponse,
  type MediaKind,
  type ProcessingStatus,
  type ScoreSummary,
  type Severity,
  type TranscriptSegment,
} from '../api'
import { ExampleAudioButton } from './ExampleAudio'
import { practiceFor, type PracticeLink } from './practiceLinks'

/** The Practice Center location in the city (src/data/locations.ts). */
const PRACTICE_CENTER_ID = 'practice-center'

const SEVERITY: Record<Severity, { color: string; label: string; pill: string }> = {
  critical: { color: '#f87171', label: 'Critical', pill: 'bg-[#f87171]/15 text-[#fca5a5]' },
  major: { color: '#fb923c', label: 'Improve', pill: 'bg-[#fb923c]/15 text-[#fdba74]' },
  minor: { color: '#fcd34d', label: 'Polish', pill: 'bg-[#fcd34d]/15 text-[#fde68a]' },
  strength: { color: '#5fe3a8', label: 'Strength', pill: 'bg-jade-500/15 text-jade-400' },
}

const BANDS = [
  { min: 80, label: 'Strong', color: '#5fe3a8', text: 'text-jade-400', pill: 'bg-jade-500/15 text-jade-400' },
  { min: 60, label: 'Good', color: '#a3e635', text: 'text-[#bef264]', pill: 'bg-[#a3e635]/15 text-[#bef264]' },
  { min: 40, label: 'Developing', color: '#fcd34d', text: 'text-[#fde68a]', pill: 'bg-[#fcd34d]/15 text-[#fde68a]' },
  { min: 0, label: 'Needs work', color: '#fb923c', text: 'text-[#fdba74]', pill: 'bg-[#fb923c]/15 text-[#fdba74]' },
]
const bandFor = (score: number) => BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1]

const VOICE_SKILLS = ['comm.pace', 'comm.filler_words', 'comm.fluency', 'comm.intonation', 'comm.articulation', 'comm.projection', 'comm.delivery']
const PRESENCE_SKILLS = ['comm.eye_contact', 'comm.facial_expression', 'comm.composure']

const GROUPS: { id: string; title: string; subtitle: string; icon: ReactNode; match: (s: ScoreSummary) => boolean }[] = [
  {
    id: 'voice',
    title: 'How you sound',
    subtitle: 'Pace, fillers, intonation and clarity of speech',
    icon: <IconMic width={16} height={16} />,
    match: (s) => VOICE_SKILLS.includes(s.competencyId),
  },
  {
    id: 'presence',
    title: 'How you come across on camera',
    subtitle: 'Eye contact, expression and composure',
    icon: <IconVideo width={16} height={16} />,
    match: (s) => PRESENCE_SKILLS.includes(s.competencyId),
  },
  {
    id: 'content',
    title: 'What you say',
    subtitle: 'Structure, clarity and substance of your answers',
    icon: <IconFile width={16} height={16} />,
    match: (s) => s.category === 'communication' && !VOICE_SKILLS.includes(s.competencyId) && !PRESENCE_SKILLS.includes(s.competencyId),
  },
  {
    id: 'round',
    title: 'Round skills',
    subtitle: 'What this kind of interviewer is assessing',
    icon: <IconTarget width={16} height={16} />,
    match: (s) => s.category === 'round',
  },
]

const STEPS: { status: ProcessingStatus; label: string }[] = [
  { status: 'queued', label: 'Saving your recording' },
  { status: 'transcribing', label: 'Transcribing' },
  { status: 'analyzing', label: 'Analysing your answers' },
  { status: 'completed', label: 'Feedback ready' },
]

type Tab = 'overview' | 'moments' | 'skills' | 'transcript'

// -- building blocks ---------------------------------------------------------------------------

function ScoreRing({ score, size = 120, stroke = 10, caption }: { score: number; size?: number; stroke?: number; caption?: string }) {
  const band = bandFor(score)
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(score))
    return () => cancelAnimationFrame(frame)
  }, [score])
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={band.color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown / 100)}
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)', filter: `drop-shadow(0 0 12px ${band.color}66)` }}
        />
      </svg>
      <div className="text-center">
        <div className="font-semibold leading-none tabular-nums text-chalk" style={{ fontSize: size * 0.3 }}>
          {score}
        </div>
        {caption && <div className="mt-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-faint">{caption}</div>}
      </div>
    </div>
  )
}

function DeltaChip({ delta }: { delta: number | null | undefined }) {
  if (delta === null || delta === undefined) return null
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums',
        delta > 0 ? 'bg-jade-500/15 text-jade-400' : delta < 0 ? 'bg-[#f87171]/15 text-[#fca5a5]' : 'bg-white/8 text-faint',
      )}
    >
      {delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '±0'}
    </span>
  )
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('rounded-3xl border border-white/8 bg-white/[0.03] p-4 sm:p-5', className)}>{children}</section>
}

function SectionTitle({ title, subtitle, icon, aside }: { title: string; subtitle?: string; icon?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {icon && <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/6 text-chalk">{icon}</span>}
      <div className="min-w-0 flex-1">
        <h3 className="text-[14.5px] font-semibold text-chalk">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[11.5px] text-faint">{subtitle}</p>}
      </div>
      {aside}
    </div>
  )
}

function PracticeButton({ link, onPractice }: { link: PracticeLink; onPractice: (link: PracticeLink) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPractice(link)}
      className="group flex w-full items-center gap-2.5 rounded-2xl border border-[#5fd6de]/25 bg-[#5fd6de]/[0.07] px-3 py-2.5 text-left transition-colors hover:bg-[#5fd6de]/[0.13]"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#5fd6de]/15 text-[#8ee8ee]">
        <IconTarget width={15} height={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold text-chalk">Practice · {link.label}</span>
        <span className="block truncate text-[11px] text-mist">{link.why}</span>
      </span>
      <IconChevronRight width={15} height={15} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}

// -- skills ------------------------------------------------------------------------------------

function SkillRow({
  score,
  name,
  delta,
  onPractice,
}: {
  score: ScoreSummary
  name: string
  delta: number | null | undefined
  onPractice: (link: PracticeLink) => void
}) {
  const [open, setOpen] = useState(false)
  const band = bandFor(score.score)
  const link = practiceFor(score.competencyId)
  return (
    <li className={cn('rounded-2xl border transition-colors', open ? 'border-white/12 bg-white/[0.05]' : 'border-transparent hover:bg-white/[0.03]')}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full px-3 py-2.5 text-left">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-chalk">{name}</span>
          <DeltaChip delta={delta} />
          <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold', band.pill)}>{band.label}</span>
          <span className="w-7 text-right text-[14px] font-semibold tabular-nums text-chalk">{score.score}</span>
          <IconChevronRight width={14} height={14} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-90')} />
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full"
            style={{ width: `${score.score}%`, background: band.color, opacity: score.confidence === 'low' ? 0.45 : 1 }}
          />
        </div>
        {score.metric && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-full bg-white/8 px-2 py-0.5 font-medium tabular-nums text-chalk">
              {score.metric.label}: {score.metric.value} {score.metric.unit}
            </span>
            <span className="text-faint">target {score.metric.target}</span>
            <span className={band.text}>· {score.metric.verdict}</span>
          </div>
        )}
        {score.meaning && <p className="mt-2 text-[12px] leading-relaxed text-mist">{score.meaning}</p>}
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3 text-[12px] leading-relaxed">
          {score.metric?.details && <p className="text-faint">{score.metric.details}</p>}
          {score.measured && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">What we noticed</div>
              <p className="mt-1 text-mist">{score.measured}</p>
            </div>
          )}
          {score.rationale && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Why {score.score}</div>
              <p className="mt-1 text-mist">{score.rationale}</p>
            </div>
          )}
          {score.toReach100?.length ? (
            <div className="rounded-2xl bg-white/[0.04] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-jade-400">
                {score.score >= 95 ? 'Keep doing' : 'How to reach 100'}
              </div>
              <ol className="mt-2 space-y-1.5">
                {score.toReach100.map((step, i) => (
                  <li key={step} className="flex gap-2.5 text-chalk">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-jade-500/15 text-[10.5px] font-semibold text-jade-400">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="text-faint">Analyse this interview again to get a full explanation for this score.</p>
          )}
          {score.confidence === 'low' && <p className="text-faint">Low confidence: this interview gave little evidence for this skill.</p>}
          {link && <PracticeButton link={link} onPractice={onPractice} />}
        </div>
      )}
    </li>
  )
}

function SkillGroups({
  scores,
  names,
  deltas,
  onPractice,
  inPerson = false,
}: {
  scores: ScoreSummary[]
  names: Record<string, string>
  deltas: Map<string, number | null>
  onPractice: (link: PracticeLink) => void
  /** The interview happened in the room, not on a call. */
  inPerson?: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-[11px] text-faint">Scores out of 100 · 80+ strong · 60–79 good · 40–59 developing · under 40 needs work</p>
      {GROUPS.map((group) => {
        const items = scores.filter(group.match).sort((a, b) => a.score - b.score)
        if (!items.length) return null
        const average = Math.round(items.reduce((sum, s) => sum + s.score, 0) / items.length)
        return (
          <Card key={group.id}>
            <SectionTitle
              title={inPerson && group.id === 'presence' ? 'In-room presence' : group.title}
              subtitle={
                inPerson && group.id === 'presence' ? 'Eye contact with the panel, expression and composure' : group.subtitle
              }
              icon={group.icon}
              aside={<ScoreRing score={average} size={44} stroke={4} />}
            />
            <ul className="mt-3 flex flex-col gap-1">
              {items.map((s) => (
                <SkillRow key={s.competencyId} score={s} name={names[s.competencyId] ?? s.competencyId} delta={deltas.get(s.competencyId)} onPractice={onPractice} />
              ))}
            </ul>
          </Card>
        )
      })}
    </div>
  )
}

// -- moments -----------------------------------------------------------------------------------

function MomentCard({
  event,
  name,
  sessionId,
  active,
  open,
  voice,
  onToggle,
  onWatch,
  onPractice,
  onHearExample,
}: {
  event: FeedbackEvent
  name: string
  sessionId: string
  active: boolean
  open: boolean
  voice: ExampleVoice
  onToggle: () => void
  onWatch: () => void
  onPractice: (link: PracticeLink) => void
  onHearExample: () => void
}) {
  const severity = SEVERITY[event.severity]
  const link = event.severity === 'strength' ? null : practiceFor(event.competencyId)
  return (
    <li
      className={cn(
        'overflow-hidden rounded-3xl border transition-colors',
        active ? 'border-jade-400/40 bg-jade-500/[0.06]' : 'border-white/8 bg-white/[0.03]',
      )}
    >
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3.5 text-left">
        <span className="mt-0.5 rounded-xl bg-white/8 px-2 py-1 text-[11.5px] font-semibold tabular-nums text-chalk">
          {formatClock(event.timestampStart)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold leading-snug text-chalk">{event.title}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className={cn('rounded-full px-2 py-0.5 font-semibold', severity.pill)}>{severity.label}</span>
            <span className="text-faint">{name}</span>
          </span>
        </span>
        <IconChevronRight width={16} height={16} className={cn('mt-1 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
      </button>

      {open && (
        <div className="space-y-3 px-4 pb-4 text-[12.5px] leading-relaxed">
          {(event.evidence.quote || event.example) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {event.evidence.quote && (
                <div className="rounded-2xl bg-white/[0.04] p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">You said</div>
                  <p className="mt-1.5 text-mist">“{event.evidence.quote}”</p>
                  <button type="button" onClick={onWatch} className="mt-2 text-[11.5px] font-medium text-chalk underline decoration-white/30 underline-offset-2 hover:decoration-white">
                    Replay this moment
                  </button>
                </div>
              )}
              {event.example && (
                <div className="rounded-2xl border border-jade-400/25 bg-gradient-to-br from-jade-500/[0.14] to-transparent p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-jade-400">A stronger answer</div>
                    <ExampleAudioButton sessionId={sessionId} eventId={event.id} voice={voice} onPlay={onHearExample} />
                  </div>
                  <p className="mt-1.5 text-chalk">“{event.example}”</p>
                </div>
              )}
            </div>
          )}
          <dl className="grid gap-2.5">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">What happened</dt>
              <dd className="mt-0.5 text-mist">{event.observation}</dd>
            </div>
            {event.whyItMatters && (
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Why it matters</dt>
                <dd className="mt-0.5 text-mist">{event.whyItMatters}</dd>
              </div>
            )}
            {event.recommendation && (
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
                  {event.severity === 'strength' ? 'Keep doing' : 'What to change'}
                </dt>
                <dd className="mt-0.5 text-chalk">{event.recommendation}</dd>
              </div>
            )}
          </dl>
          {!event.evidence.quote && (
            <Button variant="ghost" className="h-8 px-3 text-[12px]" onClick={onWatch}>
              Replay this moment
            </Button>
          )}
          {link && <PracticeButton link={link} onPractice={onPractice} />}
        </div>
      )}
    </li>
  )
}

// -- processing --------------------------------------------------------------------------------

function Processing({ data, onReprocess, busy }: { data: FeedbackResponse; onReprocess: () => void; busy: boolean }) {
  const status = data.session.processingStatus
  const failed = status === 'failed'
  const reached = STEPS.findIndex((s) => s.status === status)
  // Each finished step is real ground covered; the step in flight only claims
  // its own start, so the number never runs ahead of the work.
  const through = reached < 0 ? 0 : reached / (STEPS.length - 1)
  return (
    <div className="grid min-h-0 flex-1 place-items-center">
      <Card className="w-full max-w-sm">
        <div className="eyebrow">{failed ? 'Something went wrong' : 'Preparing your feedback'}</div>
        {failed ? (
          <>
            <p className="mt-2 text-[12.5px] leading-relaxed text-mist">
              {data.session.failure?.retryable === false && data.session.failure.step === 'prepare_submit_stt'
                ? 'We couldn’t find enough of your voice in this recording to give feedback.'
                : 'Processing this interview failed. You can try again.'}
            </p>
            <Button variant="primary" className="mt-4 w-full" disabled={busy} onClick={onReprocess}>
              {busy ? 'Starting…' : 'Try again'}
            </Button>
          </>
        ) : (
          <>
            <ThinkingLogo
              layout="stack"
              size={52}
              className="mt-5"
              progress={through}
              done={status === 'completed'}
              label="Working through your interview"
              doneLabel="Feedback ready"
            />
            <ol className="mt-5 flex flex-col gap-3">
              {STEPS.map((step, i) => (
                <li key={step.status} className="flex items-center gap-3 text-[13px]">
                  <span
                    className={cn(
                      'grid size-6 place-items-center rounded-full text-[11px]',
                      i < reached ? 'bg-jade-500 text-ink-900' : i === reached ? 'bg-jade-500/30 text-jade-300' : 'bg-white/8 text-faint',
                    )}
                  >
                    {i < reached ? <IconCheck width={12} height={12} /> : i + 1}
                  </span>
                  <span className={i <= reached ? 'text-chalk' : 'text-faint'}>{step.label}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </Card>
    </div>
  )
}

// -- report ------------------------------------------------------------------------------------

function Report({
  data,
  sessionId,
  onReanalyse,
  reanalysing,
}: {
  data: FeedbackResponse
  sessionId: string
  onReanalyse: () => void
  reanalysing: boolean
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(0)
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([])
  const [retrying, setRetrying] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [voice, setVoice] = useState<ExampleVoice>('warm')
  const setSession = useAppStore((s) => s.setSession)
  const currentSession = useAppStore((s) => s.session)

  const names = data.competencyNames ?? {}
  const summary = data.session.summary
  const scores = useMemo(() => summary?.scores ?? [], [summary])
  const durationMs = Math.max(1, data.session.media.durationMs)
  const deltas = useMemo(() => new Map((summary?.deltas ?? []).map((d) => [d.competencyId, d.delta])), [summary])
  const overall = data.evaluation?.overallScore ?? summary?.overallScore ?? 0
  const band = bandFor(overall)
  const improvements = data.events.filter((e) => e.severity !== 'strength')
  const [openMoment, setOpenMoment] = useState<string | null>(() => improvements[0]?.id ?? data.events[0]?.id ?? null)

  const loadAudio = useCallback(async () => {
    if (!data.session.media.hasAudio) return
    try {
      const { url } = await getPlaybackUrl(sessionId)
      setSrc(resolveMediaUrl(url))
      setMediaError(null)
    } catch {
      setMediaError('The recording is not available.')
    }
  }, [data.session.media.hasAudio, sessionId])

  useEffect(() => {
    void loadAudio()
  }, [loadAudio])

  // Camera video follows the audio timeline, offset by when the camera started.
  const video = useRef<HTMLVideoElement>(null)
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const videoReady = data.session.media.video?.state === 'ready'
  const videoOffsetS = (data.session.media.video?.startedAtMediaMs ?? 0) / 1000
  const [cameraShown, setCameraShown] = useState(false)

  const loadVideo = useCallback(async () => {
    if (!videoReady) return
    try {
      const { url } = await getPlaybackUrl(sessionId, 'video')
      setVideoSrc(resolveMediaUrl(url))
    } catch {
      setVideoSrc(null)
    }
  }, [sessionId, videoReady])

  useEffect(() => {
    void loadVideo()
  }, [loadVideo])

  const syncVideo = useCallback(() => {
    const player = audio.current
    const camera = video.current
    if (!player || !camera) return
    const target = player.currentTime - videoOffsetS
    const inRange = target >= 0 && (!Number.isFinite(camera.duration) || target <= camera.duration)
    setCameraShown(inRange)
    if (!inRange) {
      if (!camera.paused) camera.pause()
      return
    }
    if (Math.abs(camera.currentTime - target) > 0.3) camera.currentTime = target
    if (player.paused && !camera.paused) camera.pause()
    if (!player.paused && camera.paused) void camera.play().catch(() => {})
  }, [videoOffsetS])

  useEffect(() => {
    if (!data.transcriptUrl) return
    fetchTranscript(data.transcriptUrl)
      .then(setTranscript)
      .catch(() => setTranscript([]))
  }, [data.transcriptUrl])

  const seek = (ms: number) => {
    const el = audio.current
    if (!el) return
    el.currentTime = ms / 1000
    void el.play().catch(() => {})
  }

  const download = async (kind: MediaKind) => {
    try {
      const { url, fileName } = await getDownloadUrl(sessionId, kind)
      await saveFile(resolveMediaUrl(url), fileName)
    } catch {
      setNotice('The download link could not be created.')
    }
  }

  const retry = async () => {
    const format = PRACTICE_FORMATS['Interview']?.[0]
    if (!format) return
    setRetrying(true)
    try {
      const created = await retrySession(sessionId)
      const base: SessionSetup = currentSession?.interview ? currentSession : { locationId: 'company', area: 'Interview', format, minutes: 30 }
      setSession({
        ...base,
        format: { ...base.format, destination: 'call' },
        interview: { general: true, type: 'behavioral', mode: 'online', panel: 'one-to-one', ...base.interview, sessionId: created.id },
      })
      useAppStore.setState({ view: 'call', feedbackSessionId: null, selectedId: base.locationId })
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : 'Could not start a new attempt.')
    } finally {
      setRetrying(false)
    }
  }

  // Straight into the Practice Center drill for the skill (e.g. Framework Challenge preset to STAR).
  const openPractice = (link: PracticeLink) => {
    const format = PRACTICE_FORMATS[link.area]?.[0]
    if (!format) return
    setSession({
      locationId: PRACTICE_CENTER_ID,
      area: link.area,
      format,
      minutes: 10,
      drill: link.framework ? { framework: link.framework } : undefined,
    })
    useAppStore.setState({ view: 'drill', feedbackSessionId: null, selectedId: PRACTICE_CENTER_ID })
  }

  const watchMoment = (event: FeedbackEvent) => seek(event.timestampStart)
  const pauseRecording = () => audio.current?.pause()

  const activeEvent = data.events.find((e) => nowMs >= e.timestampStart && nowMs <= e.timestampEnd)
  const activeSegment = transcript.find((s) => nowMs >= s.start_ms && nowMs <= s.end_ms)
  const needsReanalysis = scores.some((s) => !s.meaning)
  const improved = (summary?.deltas ?? []).filter((d) => (d.delta ?? 0) > 0).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
  const headline = improved.length
    ? `You improved ${(names[improved[0].competencyId] ?? improved[0].competencyId).toLowerCase()} by ${improved[0].delta} points.`
    : data.evaluation?.improvements[0] ?? [...scores].sort((a, b) => a.score - b.score)[0]?.meaning ?? 'Here’s how your interview went.'
  const focus = [...scores]
    .filter((s) => s.confidence !== 'low' && practiceFor(s.competencyId))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)

  const moments = (
    <ul className="flex flex-col gap-2.5">
      {data.events.map((event) => (
        <MomentCard
          key={event.id}
          event={event}
          name={names[event.competencyId] ?? event.competencyId}
          sessionId={sessionId}
          active={activeEvent?.id === event.id}
          open={openMoment === event.id}
          voice={voice}
          onToggle={() => setOpenMoment((current) => (current === event.id ? null : event.id))}
          onWatch={() => watchMoment(event)}
          onPractice={openPractice}
          onHearExample={pauseRecording}
        />
      ))}
    </ul>
  )

  return (
    <div className="-mr-2 mt-3 min-h-0 flex-1 overflow-y-auto pr-2">
      <div className="mx-auto grid max-w-6xl gap-4 pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Left: the result and the recording, kept in view on wide screens. */}
        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-0 lg:self-start">
          <section
            className="relative overflow-hidden rounded-3xl border border-white/8 p-5"
            style={{
              background: `radial-gradient(120% 100% at 0% 0%, ${band.color}26, transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015))`,
            }}
          >
            <div className="flex items-center gap-5">
              <ScoreRing score={overall} caption="Overall" />
              <div className="min-w-0 flex-1">
                <span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold', band.pill)}>{band.label}</span>
                <h2 className="mt-2 text-[17px] font-semibold leading-snug text-chalk">{headline}</h2>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-mist">
                  <span className="rounded-full bg-white/8 px-2.5 py-1">Attempt {data.session.attemptNo}</span>
                  <span className="rounded-full bg-white/8 px-2.5 py-1">{formatClock(durationMs)} recorded</span>
                  <span className="rounded-full bg-white/8 px-2.5 py-1">{improvements.length} to improve</span>
                  <span className="rounded-full bg-white/8 px-2.5 py-1">{data.events.length - improvements.length} strengths</span>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {/* A language conversation is practised again from the Language Center. */}
              {data.session.module !== 'language' && (
                <Button variant="primary" disabled={retrying} onClick={() => void retry()}>
                  {retrying ? 'Starting…' : 'Try again with new questions'}
                </Button>
              )}
              <Button variant="ghost" className={cn(data.session.module === 'language' && 'col-span-2')} onClick={() => setTab('moments')}>
                Review moments
              </Button>
            </div>
            {data.session.retryPlan?.competencyNames.length ? (
              <p className="mt-2 text-[11px] text-faint">
                Your next attempt focuses on {data.session.retryPlan.competencyNames.join(', ').toLowerCase()}.
              </p>
            ) : null}
          </section>

          {needsReanalysis && (
            <section className="flex items-center gap-3 rounded-3xl border border-[#5fd6de]/25 bg-[#5fd6de]/[0.07] p-4 text-[12px] text-mist">
              <p className="min-w-0 flex-1">Analysed before explained scores, voice and body-language feedback were added.</p>
              <Button variant="ghost" className="h-8 shrink-0 px-3 text-[12px]" disabled={reanalysing} onClick={onReanalyse}>
                {reanalysing ? 'Starting…' : 'Analyse again'}
              </Button>
            </section>
          )}

          <section className="overflow-hidden rounded-3xl border border-white/8 bg-white/[0.03]">
            {videoSrc ? (
              <div className="relative aspect-video w-full bg-black">
                <video
                  ref={video}
                  src={videoSrc}
                  muted
                  playsInline
                  preload="metadata"
                  aria-label="Your camera during the interview"
                  className="size-full object-cover"
                  onLoadedMetadata={syncVideo}
                  onError={() => void loadVideo()}
                />
                {!cameraShown && (
                  <div className="absolute inset-0 grid place-items-center bg-black/40 text-[12px] text-mist">Camera off at this point</div>
                )}
              </div>
            ) : (
              <div className="flex h-20 items-center gap-3 bg-gradient-to-r from-jade-500/10 to-transparent px-5">
                <span className="grid size-10 place-items-center rounded-2xl bg-jade-500/15 text-jade-400">
                  <IconMic width={18} height={18} />
                </span>
                <span className="text-[13px] font-medium text-chalk">{data.session.module === 'language' ? 'Your conversation recording' : 'Your interview recording'}</span>
              </div>
            )}
            <div className="p-4">
              {src ? (
                <audio
                  ref={audio}
                  src={src}
                  controls
                  preload="metadata"
                  className="w-full"
                  onTimeUpdate={(e) => {
                    setNowMs(e.currentTarget.currentTime * 1000)
                    syncVideo()
                  }}
                  onPlay={syncVideo}
                  onPause={syncVideo}
                  onSeeked={syncVideo}
                  onError={() => void loadAudio()}
                />
              ) : (
                <p className="text-[12px] text-faint">{mediaError ?? 'Loading recording…'}</p>
              )}
              <div className="relative mt-3 h-7" aria-label="Moments on the timeline">
                <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/8" />
                <div
                  className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/30"
                  style={{ width: `${Math.min(100, (nowMs / durationMs) * 100)}%` }}
                />
                {data.events.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    title={`${formatClock(event.timestampStart)} · ${event.title}`}
                    aria-label={`Jump to ${formatClock(event.timestampStart)}: ${event.title}`}
                    onClick={() => {
                      seek(event.timestampStart)
                      setOpenMoment(event.id)
                      setTab('moments')
                    }}
                    className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-ink-900 transition-transform hover:scale-125"
                    style={{ left: `${(event.timestampStart / durationMs) * 100}%`, background: SEVERITY[event.severity].color }}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
                <span className="flex items-center gap-3 text-faint">
                  {(['strength', 'major', 'critical'] as const).map((s) => (
                    <span key={s} className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: SEVERITY[s].color }} />
                      {SEVERITY[s].label}
                    </span>
                  ))}
                </span>
                <span className="flex items-center gap-3">
                  {data.session.media.hasAudio && (
                    <button type="button" onClick={() => void download('audio')} className="text-mist underline decoration-white/25 underline-offset-2 hover:text-chalk">
                      Download audio
                    </button>
                  )}
                  {videoReady && (
                    <button type="button" onClick={() => void download('video')} className="text-mist underline decoration-white/25 underline-offset-2 hover:text-chalk">
                      Download video
                    </button>
                  )}
                </span>
              </div>
              {notice && <p className="mt-2 text-[12px] text-[#fca5a5]">{notice}</p>}
            </div>
          </section>
        </div>

        {/* Right: what to work on. */}
        <div className="flex min-w-0 flex-col gap-4">
          <div role="tablist" aria-label="Feedback sections" className="sticky top-0 z-10 grid grid-cols-4 gap-1 rounded-2xl border border-white/8 bg-[#0b0f16]/90 p-1 backdrop-blur">
            {(
              [
                ['overview', 'Overview'],
                ['moments', `Moments · ${data.events.length}`],
                ['skills', 'Skills'],
                ['transcript', 'Transcript'],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  'h-9 truncate rounded-xl px-2 text-[12px] font-semibold transition-colors',
                  tab === id ? 'bg-white/10 text-chalk' : 'text-faint hover:text-chalk',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <>
              {/* A debate is judged on how the argument went, so the map of it comes first:
                  every mark on it was recorded while the debate ran. */}
              {data.session.module === 'debate' && (
                <ArgumentMapSection sessionId={sessionId} onSeek={seek} />
              )}
              {focus.length > 0 && (
                <Card>
                  <SectionTitle title="Start with these" subtitle="Your biggest opportunities, and the drill that trains each one" icon={<IconTarget width={16} height={16} />} />
                  <div className="mt-4 flex flex-col gap-3">
                    {focus.map((s) => {
                      const skillBand = bandFor(s.score)
                      const link = practiceFor(s.competencyId)
                      return (
                        <div key={s.competencyId} className="rounded-2xl bg-white/[0.04] p-3">
                          <div className="flex items-center gap-3">
                            <ScoreRing score={s.score} size={42} stroke={4} />
                            <div className="min-w-0 flex-1">
                              <div className="text-[13.5px] font-semibold text-chalk">{names[s.competencyId] ?? s.competencyId}</div>
                              <div className={cn('text-[11px] font-medium', skillBand.text)}>
                                {skillBand.label}
                                {s.metric ? ` · ${s.metric.label}: ${s.metric.value} ${s.metric.unit} (target ${s.metric.target})` : ''}
                              </div>
                            </div>
                          </div>
                          {s.meaning && <p className="mt-2 text-[12px] leading-relaxed text-mist">{s.meaning}</p>}
                          {s.toReach100?.[0] && (
                            <p className="mt-1.5 text-[12px] leading-relaxed text-chalk">
                              <span className="font-semibold text-jade-400">Next time: </span>
                              {s.toReach100[0]}
                            </p>
                          )}
                          {link && (
                            <div className="mt-2.5">
                              <PracticeButton link={link} onPractice={openPractice} />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )}

              {improvements[0] && (
                <Card>
                  <SectionTitle
                    title="Hear the difference"
                    subtitle="What you said, and a stronger version read aloud"
                    icon={<IconMic width={16} height={16} />}
                    aside={
                      <div className="flex rounded-full bg-white/6 p-0.5 text-[11px]" role="radiogroup" aria-label="Example voice">
                        {(['warm', 'deep'] as ExampleVoice[]).map((v) => (
                          <button
                            key={v}
                            type="button"
                            role="radio"
                            aria-checked={voice === v}
                            onClick={() => setVoice(v)}
                            className={cn('rounded-full px-2.5 py-1 font-medium capitalize', voice === v ? 'bg-white/12 text-chalk' : 'text-faint')}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    }
                  />
                  <ul className="mt-4 flex flex-col gap-2.5">
                    {improvements
                      .filter((e) => e.example)
                      .slice(0, 2)
                      .map((event) => (
                        <MomentCard
                          key={event.id}
                          event={event}
                          name={names[event.competencyId] ?? event.competencyId}
                          sessionId={sessionId}
                          active={activeEvent?.id === event.id}
                          open
                          voice={voice}
                          onToggle={() => {
                            setOpenMoment(event.id)
                            setTab('moments')
                          }}
                          onWatch={() => watchMoment(event)}
                          onPractice={openPractice}
                          onHearExample={pauseRecording}
                        />
                      ))}
                  </ul>
                </Card>
              )}

              {(data.evaluation?.strengths.length || data.evaluation?.improvements.length) && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Card>
                    <SectionTitle title="What went well" icon={<IconCheck width={16} height={16} />} />
                    <ul className="mt-3 space-y-2 text-[12.5px] leading-relaxed">
                      {data.evaluation.strengths.map((s) => (
                        <li key={s} className="flex gap-2 text-mist">
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-jade-400" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </Card>
                  <Card>
                    <SectionTitle title="What to work on" icon={<IconTarget width={16} height={16} />} />
                    <ul className="mt-3 space-y-2 text-[12.5px] leading-relaxed">
                      {data.evaluation.improvements.map((s) => (
                        <li key={s} className="flex gap-2 text-mist">
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#fb923c]" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
              )}
            </>
          )}

          {tab === 'moments' && moments}

          {tab === 'skills' && <SkillGroups
              scores={scores}
              names={names}
              deltas={deltas}
              onPractice={openPractice}
              inPerson={data?.session.context.mode === 'in_person'}
            />}

          {tab === 'transcript' && (
            <Card>
              {transcript.length ? (
                <ol className="flex flex-col gap-1">
                  {transcript.map((segment) => (
                    <li key={segment.id}>
                      <button
                        type="button"
                        onClick={() => seek(segment.start_ms)}
                        className={cn(
                          'flex w-full gap-3 rounded-xl px-2.5 py-2 text-left text-[12.5px] leading-relaxed transition-colors hover:bg-white/6',
                          activeSegment?.id === segment.id && 'bg-jade-500/10',
                        )}
                      >
                        <span className="w-10 shrink-0 tabular-nums text-faint">{formatClock(segment.start_ms)}</span>
                        <span className="min-w-0">
                          <span className={cn('block text-[10px] font-semibold uppercase tracking-[0.14em]', segment.speaker === 'interviewer' ? 'text-faint' : 'text-jade-400')}>
                            {segment.speaker === 'interviewer' ? 'Interviewer' : 'You'}
                          </span>
                          <span className={segment.speaker === 'interviewer' ? 'text-mist' : 'text-chalk'}>{segment.text}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[12px] text-faint">The transcript isn’t available.</p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function FeedbackScreen({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [data, setData] = useState<FeedbackResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const next = await getFeedback(sessionId)
        if (cancelled) return
        setData(next)
        setError(null)
        if (!next.evaluation && next.session.processingStatus !== 'failed') timer = setTimeout(load, 4000)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError && err.status === 404 ? 'This session could not be found.' : 'Could not load feedback.')
        timer = setTimeout(load, 8000)
      }
    }
    void load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [sessionId, nonce])

  const reprocess = async () => {
    setBusy(true)
    try {
      await reprocessSession(sessionId)
      setNonce((n) => n + 1)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not restart processing.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="anim-fade absolute inset-0 z-[45] flex flex-col hud-inset"
      style={{ background: 'radial-gradient(80% 50% at 50% 0%, rgba(52,211,153,0.08), transparent 70%), #070b14' }}
    >
      <header className="mx-auto flex w-full max-w-6xl items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold tracking-[0.16em] text-jade-400">
            {data?.session.module === 'debate'
              ? 'DEBATE FEEDBACK'
              : data?.session.module === 'exam'
                ? 'EXAM FEEDBACK'
                : data?.session.module === 'language'
                  ? 'LANGUAGE FEEDBACK'
                  : 'INTERVIEW FEEDBACK'}
          </div>
          <div className="mt-0.5 truncate text-[15px] font-semibold text-chalk">
            {String(
              data?.session.context.roundTitle ??
                (data?.session.context.scene as { title?: string } | undefined)?.title ??
                data?.session.context.motion ??
                data?.session.context.subject ??
                (data?.session.module === 'debate' ? 'Debate' : 'Behavioral interview'),
            )}
          </div>
        </div>
        <Button variant="icon" aria-label="Close feedback" onClick={onClose}>
          <IconClose width={14} height={14} />
        </Button>
      </header>
      {error && <p className="mx-auto mt-2 w-full max-w-6xl text-[12px] text-[#fca5a5]">{error}</p>}
      {!data ? (
        <div className="grid flex-1 place-items-center text-[12.5px] text-faint">Loading…</div>
      ) : data.evaluation ? (
        <Report data={data} sessionId={sessionId} onReanalyse={() => void reprocess()} reanalysing={busy} />
      ) : (
        <Processing data={data} busy={busy} onReprocess={() => void reprocess()} />
      )}
    </div>
  )
}

/** Timestamped feedback for one practice session: score, moments, recording, skills and transcript. */
export function FeedbackDashboard() {
  const view = useAppStore((s) => s.view)
  const sessionId = useAppStore((s) => s.feedbackSessionId)
  const close = useAppStore((s) => s.closeFeedback)
  if (view !== 'feedback' || !sessionId) return null
  return <FeedbackScreen key={sessionId} sessionId={sessionId} onClose={close} />
}
