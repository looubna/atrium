import { useEffect, useRef, useState } from 'react'
import {
  DRILLS,
  STORY_COURSE,
  isDrillId,
  isStoryDrill,
  makePrompt,
  paceWindow,
  type Drill,
  type DrillId,
  type DrillPrompt,
} from '@/data/drills'
import { PRACTICE_FORMATS } from '@/data/practice'
import { useCamera } from '@/lib/useCamera'
import { clock, useCountdown } from '@/lib/useCountdown'
import { FaceTracker } from '@/platform/media/faceMetrics'
import { cn } from '@/lib/utils'
import { useVoiceActivity } from '@/lib/useVoiceActivity'
import { ApiError } from '@/platform/api/client'
import {
  THINK_PREP_SECONDS,
  formatMetric,
  submitPracticeRound,
  usePracticeProgress,
  type DrillProgress,
  type RoundResult,
} from '@/modules/practice/api'
import { useAppStore } from '@/state/useAppStore'
import { RoundFeedback } from '../practice/RoundFeedback'
import { IconCheck, IconChevronRight, IconClose, IconMic, IconMicOff, IconTimer } from '../ui/Icon'

/**
 * A round: optionally read a passage, prepare, speak against the clock, then look back
 * and rate it. `intro` explains the drill once, before the first round.
 */
type Phase = 'intro' | 'read' | 'prep' | 'speak' | 'review'
type Timed = 'read' | 'prep' | 'speak'
/** The analysis of the round just spoken. */
type Analysis =
  | { state: 'idle' }
  | { state: 'working' }
  | { state: 'done'; result: RoundResult }
  | { state: 'failed'; message: string }

const isTimed = (p: Phase): p is Timed => p === 'read' || p === 'prep' || p === 'speak'

/** The Practice Center's drills: a full-screen practice room, reached straight from the map. */
export function DrillStage() {
  const view = useAppStore((s) => s.view)
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  const leave = useAppStore((s) => s.leaveDrill)
  const setSession = useAppStore((s) => s.setSession)
  const mine = session && session.locationId === selectedId && session.format.destination === 'drill' ? session : null

  if (view !== 'drill' || !mine || !isDrillId(mine.format.id)) return null
  const framework = mine.drill?.framework
  // The Story Course goes on to its next step in the same session, from the Park.
  const nextStep = STORY_COURSE[STORY_COURSE.indexOf(mine.format.id) + 1]
  const nextFormat = STORY_COURSE.includes(mine.format.id)
    ? PRACTICE_FORMATS.Storytelling?.find((f) => f.id === nextStep)
    : undefined
  return (
    <DrillRunner
      key={`${mine.format.id}-${framework ?? ''}`}
      id={mine.format.id}
      minutes={mine.minutes}
      framework={framework}
      place={mine.locationId === 'park' ? 'PARK · STORY COURSE' : 'PRACTICE CENTER'}
      onNextStep={nextFormat ? () => setSession({ ...mine, format: nextFormat }) : undefined}
      onLeave={leave}
    />
  )
}

function DrillRunner({ id, minutes, framework, place, onNextStep, onLeave }: {
  id: DrillId
  minutes: number
  /** Keep Framework Challenge on this framework. */
  framework?: string
  /** Where the drill is taken, for the header. */
  place: string
  /** The Story Course: go on to the next step. */
  onNextStep?: () => void
  onLeave: () => void
}) {
  const drill = DRILLS[id]
  const sessionClock = useCountdown(minutes * 60)
  const [phase, setPhase] = useState<Phase>('intro')
  const [prompt, setPrompt] = useState<DrillPrompt>(() => makePrompt(id, undefined, framework))
  const [left, setLeft] = useState(0)
  const [paused, setPaused] = useState(false)
  const [rounds, setRounds] = useState(0)
  const [analysis, setAnalysis] = useState<Analysis>({ state: 'idle' })
  const progress = usePracticeProgress((s) => s.progress?.drills[id])
  const setProgress = usePracticeProgress((s) => s.set)
  const refreshProgress = usePracticeProgress((s) => s.refresh)
  useEffect(() => {
    void refreshProgress()
  }, [refreshProgress])
  // Tell It Again retells the user's last story, once progress says which one it was.
  const lastStory = usePracticeProgress((s) => s.progress?.story?.lastSeed)
  useEffect(() => {
    if (id === 'story-retell' && lastStory && phase === 'intro') setPrompt({ kind: 'story', seed: lastStory, retell: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, lastStory])
  // The same story again next round, for a retelling; a fresh prompt otherwise.
  const nextPrompt = () => (id === 'story-retell' ? prompt : makePrompt(id, prompt, framework))
  // Recording hand-off: only a round that ended by finishing (or the timer) is analysed.
  const submitNext = useRef(false)
  const prepStarted = useRef(0)
  const prepUsed = useRef(0)
  // Words said (Random Word Story) or framework steps covered, by index.
  const [ticked, setTicked] = useState<number[]>([])
  const [spoken, setSpoken] = useState(0)
  // Measured on the device: time taken, and eye contact (Speak to the Lens).
  const [elapsed, setElapsed] = useState(0)
  const [lensEye, setLensEye] = useState<number | null>(null)
  const lensRef = useRef<number | null>(null)
  lensRef.current = lensEye
  const promptRef = useRef(prompt)
  promptRef.current = prompt

  const analyse = (recording: Blob) => {
    if (!submitNext.current) return
    submitNext.current = false
    if (recording.size < 2000) {
      setAnalysis({ state: 'failed', message: 'Nothing was recorded. Check your microphone and try again.' })
      return
    }
    setAnalysis({ state: 'working' })
    // The lens result arrives as the camera closes, just after the recording.
    window.setTimeout(() => {
      submitPracticeRound({
        drillId: id,
        recording,
        prompt: promptRef.current,
        prepUsedMs: prepUsed.current,
        speakSeconds: drill.speakSeconds,
        eyeContactPct: lensRef.current,
      })
        .then((result) => {
          setProgress(result.progress)
          setAnalysis({ state: 'done', result })
        })
        .catch((error: unknown) => {
          const message =
            error instanceof ApiError && error.status === 429
              ? 'You’ve reached today’s limit for analysed rounds. You can keep practising without feedback.'
              : error instanceof ApiError && error.status === 403
                ? 'Accept AI processing in your account to get feedback on your rounds.'
                : 'We couldn’t analyse this round. Try the next one.'
          setAnalysis({ state: 'failed', message })
        })
    }, id === 'speak-to-the-lens' ? 400 : 0)
  }

  const voice = useVoiceActivity(phase === 'speak', { onRecording: analyse, paused })
  const speaking = useRef(false)
  speaking.current = voice.speaking && !paused

  // Think on Your Feet: the challenge level sets the preparation time.
  const prepSeconds = id === 'think-on-your-feet' ? THINK_PREP_SECONDS[progress?.level ?? 1] ?? drill.prepSeconds : drill.prepSeconds
  const duration = (p: Timed) => (p === 'read' ? drill.readSeconds ?? 0 : p === 'prep' ? prepSeconds : drill.speakSeconds)
  const after = (p: Timed): Phase => (p === 'read' ? 'prep' : p === 'prep' ? 'speak' : 'review')

  const go = (p: Phase) => {
    if (phase === 'speak' && p === 'review') {
      setElapsed(drill.speakSeconds - Math.max(0, left))
      submitNext.current = true
      setAnalysis(voice.denied ? { state: 'failed', message: 'Feedback needs the microphone. Allow it and try again.' } : { state: 'working' })
    }
    if (p === 'prep') prepStarted.current = performance.now()
    if (phase === 'prep' && p === 'speak') prepUsed.current = performance.now() - prepStarted.current
    if (isTimed(p)) {
      const d = duration(p)
      if (d === 0) return go(after(p))
      setLeft(d)
    }
    setPaused(false)
    setPhase(p)
  }
  const firstStep = (): Phase => (drill.readSeconds ? 'read' : 'prep')

  // The phase clock; speaking time only counts while the microphone hears speech.
  useEffect(() => {
    if (!isTimed(phase) || paused) return
    const tick = window.setInterval(() => {
      setLeft((s) => s - 1)
      if (phase === 'speak' && speaking.current) setSpoken((n) => n + 1)
    }, 1000)
    return () => window.clearInterval(tick)
  }, [phase, paused])

  useEffect(() => {
    if (isTimed(phase) && left <= 0) go(after(phase))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, phase])

  const startRound = (next?: DrillPrompt) => {
    // The session clock starts with the first round.
    if (!sessionClock.running && !sessionClock.done && sessionClock.left === minutes * 60) sessionClock.toggle()
    if (phase === 'review') setRounds((n) => n + 1)
    // A round abandoned mid-speech is not analysed.
    submitNext.current = false
    setAnalysis({ state: 'idle' })
    if (next) setPrompt(next)
    setTicked([])
    setElapsed(0)
    setLensEye(null)
    prepUsed.current = 0
    go(firstStep())
  }
  const toggleTick = (i: number) => setTicked((t) => (t.includes(i) ? t.filter((x) => x !== i) : [...t, i]))

  const total = isTimed(phase) ? duration(phase) : 0
  // Take Both Sides: the first half argues for, the second against.
  const side = id === 'take-both-sides' && phase === 'speak' ? (left > drill.speakSeconds / 2 ? 'for' : 'against') : null
  // Framework Challenge: the step the clock suggests, if the user hasn't ticked ahead.
  const frameworkStep =
    prompt.kind === 'framework' && phase === 'speak'
      ? Math.min(prompt.framework.steps.length - 1, Math.floor(((drill.speakSeconds - left) / drill.speakSeconds) * prompt.framework.steps.length))
      : -1

  const phaseLabel =
    phase === 'intro'
      ? 'How it works'
      : phase === 'read'
        ? 'Read carefully'
        : phase === 'prep'
          ? 'Get ready'
          : phase === 'speak'
            ? side === 'for'
              ? 'Argue for'
              : side === 'against'
                ? 'Now argue against'
                : id === 'recall-and-retell'
                  ? 'Retell it'
                  : 'Speak'
            : 'Your feedback'

  return (
    <div className="anim-fade absolute inset-0 z-[45] flex flex-col overflow-hidden bg-[#070b14] hud-inset" role="region" aria-label={`${drill.title} drill`}>
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{ background: 'radial-gradient(90% 60% at 50% 0%, rgba(44,196,207,0.14), transparent 70%)' }}
        aria-hidden
      />

      {/* Header */}
      <div className="relative flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold tracking-[0.14em] text-[#5fd6de]">{place} · ROUND {rounds + (phase === 'intro' ? 0 : 1) || 1}</div>
          <div className="truncate text-[15px] font-semibold text-chalk">{drill.title}</div>
        </div>
        <div
          className={cn('flex items-center gap-1.5 rounded-full bg-white/6 px-2.5 py-1 text-[12px] tabular-nums', sessionClock.done ? 'text-[#fca5a5]' : 'text-mist')}
          aria-label="Session time left"
        >
          <IconTimer width={13} height={13} />
          {sessionClock.done ? 'Time’s up' : clock(sessionClock.left)}
        </div>
        <button
          type="button"
          onClick={onLeave}
          aria-label="Leave the drill"
          className="grid size-9 place-items-center rounded-full bg-white/6 text-mist transition-colors hover:text-chalk"
        >
          <IconClose width={15} height={15} />
        </button>
      </div>

      {/* Prompt and controls: stacked upright, side by side on a wide screen. */}
      <div className="relative mt-3 flex min-h-0 flex-1 flex-col gap-3 landscape:flex-row">
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          {phase === 'intro' ? (
            <Intro drill={drill} progress={progress} prepSeconds={prepSeconds} />
          ) : phase === 'review' && analysis.state !== 'idle' ? (
            <Review analysis={analysis} drill={drill} prompt={prompt} elapsed={elapsed} />
          ) : (
            <PromptView
              drill={drill}
              prompt={prompt}
              phase={phase}
              side={side}
              ticked={ticked}
              onTick={toggleTick}
              frameworkStep={frameworkStep}
              // A picture that fails to load is swapped for another rather than left blank.
              onBrokenImage={() => setPrompt((p) => makePrompt(id, p))}
              elapsed={elapsed}
              level={voice.level}
              lensEye={lensEye}
              onLensResult={setLensEye}
            />
          )}
        </div>

        <div className="flex shrink-0 flex-col items-center justify-center gap-3 landscape:w-[15rem]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint" aria-live="polite">
            {phaseLabel}
          </div>
          {isTimed(phase) && <Ring left={left} total={total} tone={phase === 'speak' ? (side === 'against' ? '#f0a35e' : '#34d399') : '#5fd6de'} />}

          {phase === 'speak' && (
            <div className="flex items-center gap-2 text-[11.5px] text-mist">
              {voice.denied ? (
                <>
                  <IconMicOff width={14} height={14} className="text-[#fca5a5]" />
                  Microphone unavailable — speak anyway
                </>
              ) : (
                <>
                  <IconMic width={14} height={14} className={voice.speaking ? 'text-jade-400' : 'text-faint'} />
                  <span className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10" aria-hidden>
                    <span className="block h-full rounded-full bg-jade-400 transition-[width] duration-100" style={{ width: `${Math.min(100, voice.level * 500)}%` }} />
                  </span>
                  {voice.speaking ? 'Hearing you' : 'Listening…'}
                </>
              )}
            </div>
          )}

          <div className="flex w-full max-w-sm flex-col gap-2">
            {phase === 'intro' && <Primary onClick={() => startRound()}>Start the first round</Primary>}
            {phase === 'read' && <Primary onClick={() => go('prep')}>I’ve read it</Primary>}
            {phase === 'prep' && <Primary onClick={() => go('speak')}>Start speaking</Primary>}
            {phase === 'speak' && (
              <div className="grid grid-cols-2 gap-2">
                <Secondary onClick={() => setPaused((p) => !p)}>{paused ? 'Resume' : 'Pause'}</Secondary>
                <Primary onClick={() => go('review')}>Finish</Primary>
              </div>
            )}
            {phase === 'review' && (
              <>
                {onNextStep && (progress?.challenges[0]?.done || (analysis.state === 'done' && analysis.result.awards.challenge?.completed)) && (
                  <Primary onClick={onNextStep}>Next step</Primary>
                )}
                <Primary onClick={() => startRound(nextPrompt())}>{isStoryDrill(id) ? 'Another round' : 'Next round'}</Primary>
                <Secondary onClick={() => startRound()}>Same prompt again</Secondary>
              </>
            )}
            {phase !== 'intro' && phase !== 'review' && id !== 'story-retell' && (
              <button type="button" onClick={() => startRound(makePrompt(id, prompt, framework))} className="text-[11.5px] font-medium text-faint transition-colors hover:text-chalk">
                New prompt
              </button>
            )}
          </div>

          <div className="flex gap-4 text-[11px] text-faint">
            <span>
              Rounds <span className="tabular-nums text-mist">{rounds}</span>
            </span>
            <span>
              Speaking <span className="tabular-nums text-mist">{clock(spoken)}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Intro({ drill, progress, prepSeconds }: { drill: Drill; progress?: DrillProgress; prepSeconds: number }) {
  const bests = progress?.bests.filter((b) => b.value !== null) ?? []
  return (
    <div>
      <p className="text-[16px] font-medium leading-snug text-chalk">{drill.goal}</p>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-mist">
        {drill.readSeconds ? <Chip>Read {drill.readSeconds}s</Chip> : null}
        <Chip>Prepare {prepSeconds}s</Chip>
        <Chip>Speak {drill.speakSeconds}s</Chip>
        {progress?.skills.map((skill) => (
          <span key={skill.id} className="rounded-full border border-jade-400/25 px-2.5 py-1 text-jade-300">
            {skill.label}
          </span>
        ))}
      </div>
      {progress && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2.5">
            <div className="eyebrow">Challenge · optional</div>
            <ol className="mt-1.5 flex flex-col gap-1">
              {progress.challenges.map((c) => (
                <li
                  key={c.level}
                  className={cn(
                    'flex gap-2 text-[12px] leading-snug',
                    c.done ? 'text-jade-300' : c.level === progress.level ? 'text-chalk' : 'text-faint',
                  )}
                >
                  <span className="w-5 shrink-0 tabular-nums">{c.done ? <IconCheck width={13} height={13} /> : `L${c.level}`}</span>
                  <span>
                    {c.label}
                    {!c.done && c.level === progress.level && c.repeat > 1 && (
                      <span className="ml-1 text-jade-300">
                        ({progress.challenge.passes} of {c.repeat} done)
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2.5">
            <div className="eyebrow">Personal bests</div>
            {bests.length ? (
              <ul className="mt-1.5 flex flex-col gap-1">
                {bests.map((b) => (
                  <li key={b.key} className="flex justify-between gap-2 text-[12px]">
                    <span className="text-mist">
                      {b.label}
                      {b.source === 'ai' ? <span className="ml-1 text-[9.5px] text-faint">AI</span> : null}
                    </span>
                    <span className="font-semibold tabular-nums text-chalk">{formatMetric(b.value, b.unit)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-[12px] text-faint">Your first analysed round sets them.</p>
            )}
          </div>
        </div>
      )}
      <div className="eyebrow mt-4">A strong answer</div>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {drill.tips.map((t) => (
          <li key={t} className="flex gap-2 text-[13px] leading-snug text-mist">
            <IconCheck width={14} height={14} className="mt-0.5 shrink-0 text-jade-400" />
            {t}
          </li>
        ))}
      </ul>
      {drill.example && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2.5">
            <div className="eyebrow">Weak</div>
            <p className="mt-1 text-[12.5px] italic leading-snug text-mist">{drill.example.weak}</p>
          </div>
          <div className="rounded-xl border border-jade-400/30 bg-jade-500/[0.07] px-3 py-2.5">
            <div className="eyebrow text-jade-300">Strong</div>
            <p className="mt-1 text-[12.5px] italic leading-snug text-chalk">{drill.example.strong}</p>
          </div>
        </div>
      )}
      {drill.why && (
        <>
          <div className="eyebrow mt-4">Why it works</div>
          <p className="mt-1.5 text-[13px] leading-snug text-mist">{drill.why}</p>
        </>
      )}
      {drill.camera && (
        <p className="mt-3 text-[11.5px] leading-snug text-faint">
          Uses your camera. Your face is analysed on this device only — nothing is recorded or uploaded.
        </p>
      )}
    </div>
  )
}

/** After speaking: the analysis of the round, with the prompt kept close for reference. */
function Review({ analysis, drill, prompt, elapsed }: { analysis: Analysis; drill: Drill; prompt: DrillPrompt; elapsed: number }) {
  return (
    <div className="flex flex-col gap-3">
      {analysis.state === 'working' && (
        <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-3" role="status">
          <span className="size-2 animate-pulse rounded-full bg-jade-400" />
          <span className="text-[13px] text-mist">Listening back to your round…</span>
        </div>
      )}
      {analysis.state === 'failed' && <Result tone="work">{analysis.message}</Result>}
      {analysis.state === 'done' && <RoundFeedback result={analysis.result} />}
      {prompt.kind === 'paced' && analysis.state !== 'done' && <PacedVerdict text={prompt.text} elapsed={elapsed} />}
      {analysis.state !== 'done' && (
        <div>
          <Eyebrow>Check your answer</Eyebrow>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {drill.tips.map((t) => (
              <li key={t} className="flex gap-2 text-[13px] leading-snug text-mist">
                <IconCheck width={14} height={14} className="mt-0.5 shrink-0 text-jade-400" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Pace Control, straight after reading: the timing is known on the device. */
function PacedVerdict({ text, elapsed }: { text: string; elapsed: number }) {
  const target = paceWindow(text)
  const verdict = elapsed < target.min ? 'fast' : elapsed > target.max ? 'slow' : 'right'
  const wpm = Math.round((target.words / Math.max(elapsed, 1)) * 60)
  return (
    <Result tone={verdict === 'right' ? 'good' : 'work'}>
      {verdict === 'right'
        ? `Right on pace: ${clock(elapsed)} — about ${wpm} words a minute.`
        : verdict === 'fast'
          ? `Too fast: ${clock(elapsed)} (about ${wpm} words a minute). Pause at every full stop.`
          : `A little slow: ${clock(elapsed)}. Keep pauses short between sentences.`}
    </Result>
  )
}

/** Text with [[key words]] highlighted for emphasis. */
function Emphasised({ text }: { text: string }) {
  return (
    <>
      {text.split(/\[\[(.+?)\]\]/).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-md bg-[#5fd6de]/20 px-1 font-semibold text-[#8ee8ee]">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

/** Live camera coaching: how much of the time the user looks into the lens, measured on the device. */
function LensCoach({ active, onResult }: { active: boolean; onResult: (eyePercent: number | null) => void }) {
  const camera = useCamera(active)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [live, setLive] = useState<{ present: boolean; eye: number; smile: number } | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const report = useRef(onResult)
  report.current = onResult

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = camera.stream
  }, [camera.stream])

  useEffect(() => {
    const stream = camera.stream
    if (!stream) return
    const started = performance.now()
    const tracker = new FaceTracker(stream, () => performance.now() - started)
    let timer: number | undefined
    void tracker.start().then((ok) => {
      if (!ok) setUnavailable(true)
      else timer = window.setInterval(() => setLive(tracker.live()), 300)
    })
    return () => {
      window.clearInterval(timer)
      const seen = tracker.stop().filter((s) => s.present >= 0.5)
      report.current(seen.length ? Math.round((100 * seen.reduce((sum, s) => sum + s.eye, 0)) / seen.length) : null)
      setLive(null)
    }
  }, [camera.stream])

  if (!active) return null
  const eye = Math.round((live?.eye ?? 0) * 100)
  return (
    <div className="mt-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black/40">
        <video ref={videoRef} autoPlay muted playsInline className="size-full -scale-x-100 object-cover" />
        <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-1 text-[11px] text-chalk">
          Look up at the lens ↑
        </div>
        {live && (
          <div className="absolute inset-x-3 bottom-3 rounded-xl bg-black/60 p-2.5 backdrop-blur">
            {live.present ? (
              <>
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="text-chalk">Looking at the lens</span>
                  <span className={cn('font-semibold tabular-nums', eye >= 60 ? 'text-jade-300' : 'text-[#fde68a]')}>{eye}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={cn('h-full rounded-full transition-[width] duration-300', eye >= 60 ? 'bg-jade-400' : 'bg-[#fcd34d]')}
                    style={{ width: `${eye}%` }}
                  />
                </div>
                <div className="mt-1.5 text-[11px] text-mist">{live.smile > 0.35 ? '🙂 Warm expression' : 'A natural smile helps you connect'}</div>
              </>
            ) : (
              <div className="text-[11.5px] text-[#fde68a]">Move so your face is in the frame</div>
            )}
          </div>
        )}
      </div>
      {(camera.error || unavailable) && (
        <p className="mt-2 text-[11.5px] text-faint">
          {camera.error ?? 'Live eye-contact feedback isn’t available on this device.'} You can still do the drill.
        </p>
      )}
    </div>
  )
}

function PromptView({
  drill,
  prompt,
  phase,
  side,
  ticked,
  onTick,
  frameworkStep,
  onBrokenImage,
  elapsed,
  level,
  lensEye,
  onLensResult,
}: {
  drill: Drill
  prompt: DrillPrompt
  phase: Phase
  side: 'for' | 'against' | null
  ticked: number[]
  onTick: (i: number) => void
  frameworkStep: number
  onBrokenImage: () => void
  /** Seconds spoken before finishing the round. */
  elapsed: number
  /** Live microphone level, 0..~0.3. */
  level: number
  lensEye: number | null
  onLensResult: (eyePercent: number | null) => void
}) {
  const review = phase === 'review'
  return (
    <div className="flex h-full flex-col">
      {prompt.kind === 'words' && (
        <>
          <Eyebrow>Use all three words</Eyebrow>
          <div className="mt-2 flex flex-wrap gap-2">
            {prompt.words.map((w, i) => (
              <button
                key={w}
                type="button"
                aria-pressed={ticked.includes(i)}
                onClick={() => onTick(i)}
                className={cn(
                  'flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[20px] font-semibold capitalize transition-all',
                  ticked.includes(i) ? 'border-jade-400/60 bg-jade-500/15 text-jade-300' : 'border-white/12 bg-white/5 text-chalk',
                )}
              >
                {ticked.includes(i) && <IconCheck width={16} height={16} />}
                {w}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-faint">Tap a word once you’ve used it.</p>
        </>
      )}

      {prompt.kind === 'story' && (
        <>
          <Eyebrow>{prompt.retell ? 'Tell it again — your last story' : 'Tell a story about'}</Eyebrow>
          <p className="mt-2 text-[20px] font-semibold leading-snug text-chalk">{prompt.seed}</p>
          <p className="mt-3 text-[12.5px] leading-snug text-mist">{drill.goal}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {drill.tips.map((t) => (
              <li key={t} className="flex gap-2 text-[12px] leading-snug text-faint">
                <IconCheck width={13} height={13} className="mt-0.5 shrink-0 text-jade-400" />
                {t}
              </li>
            ))}
          </ul>
        </>
      )}

      {prompt.kind === 'question' && (
        <>
          <Eyebrow>Your question</Eyebrow>
          <p className="mt-2 text-[20px] font-semibold leading-snug text-chalk">{prompt.question}</p>
        </>
      )}

      {prompt.kind === 'framework' && (
        <>
          <Eyebrow>Framework · {prompt.framework.name}</Eyebrow>
          <p className="mt-2 text-[18px] font-semibold leading-snug text-chalk">{prompt.question}</p>
          <ol className="mt-3 flex flex-col gap-1.5">
            {prompt.framework.steps.map((s, i) => {
              const done = ticked.includes(i)
              const now = i === frameworkStep && !done
              return (
                <li key={s}>
                  <button
                    type="button"
                    aria-pressed={done}
                    onClick={() => onTick(i)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-[13.5px] font-medium transition-all',
                      done ? 'border-jade-400/40 bg-jade-500/10 text-jade-300' : now ? 'border-[#5fd6de]/60 bg-[#5fd6de]/10 text-chalk' : 'border-white/8 bg-white/4 text-mist',
                    )}
                  >
                    <span className={cn('grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold', done ? 'bg-jade-400 text-ink-900' : 'bg-white/10 text-chalk')}>
                      {done ? <IconCheck width={12} height={12} /> : i + 1}
                    </span>
                    {s}
                    {now && <IconChevronRight width={14} height={14} className="ml-auto text-[#5fd6de]" />}
                  </button>
                </li>
              )
            })}
          </ol>
        </>
      )}

      {prompt.kind === 'concept' && (
        <>
          <Eyebrow>Explain</Eyebrow>
          <p className="mt-2 text-[20px] font-semibold leading-snug text-chalk">{prompt.concept}</p>
          <p className="mt-2 text-[13.5px] text-mist">
            to <span className="font-semibold text-chalk">{prompt.audience}</span>
          </p>
        </>
      )}

      {prompt.kind === 'motion' && (
        <>
          <Eyebrow>The statement</Eyebrow>
          <p className="mt-2 text-[20px] font-semibold leading-snug text-chalk">“{prompt.motion}”</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(['for', 'against'] as const).map((s) => (
              <div
                key={s}
                className={cn(
                  'rounded-xl border px-3 py-2 text-center text-[12.5px] font-semibold uppercase tracking-wide transition-all',
                  side === s
                    ? s === 'for'
                      ? 'border-jade-400/60 bg-jade-500/15 text-jade-300'
                      : 'border-[#f0a35e]/60 bg-[#f0a35e]/15 text-[#f5c08e]'
                    : 'border-white/8 bg-white/4 text-faint',
                )}
              >
                {s === 'for' ? 'For' : 'Against'}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-faint">Half the time for each side — the timer tells you when to switch.</p>
        </>
      )}

      {prompt.kind === 'image' && (
        <>
          <Eyebrow>Describe what you see</Eyebrow>
          <img
            key={prompt.src}
            src={prompt.src}
            alt={prompt.alt}
            onError={onBrokenImage}
            className="mt-2 min-h-0 w-full flex-1 rounded-xl bg-black/30 object-contain"
            style={{ maxHeight: '58vh' }}
            draggable={false}
          />
        </>
      )}

      {prompt.kind === 'passage' && (
        <>
          <Eyebrow>{phase === 'read' || review ? prompt.title : 'The passage is hidden'}</Eyebrow>
          {phase === 'read' || review ? (
            <p className="mt-2 text-[15px] leading-relaxed text-chalk">{prompt.text}</p>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-white/12 px-4 py-6 text-center text-[13.5px] text-mist">
              Retell <span className="font-semibold text-chalk">“{prompt.title}”</span> in your own words.
            </div>
          )}
        </>
      )}

      {prompt.kind === 'fillers' && (
        <>
          <Eyebrow>Your question</Eyebrow>
          <p className="mt-2 text-[20px] font-semibold leading-snug text-chalk">{prompt.question}</p>
          {phase === 'speak' && (
            <p className="mt-4 rounded-xl border border-[#f0a35e]/30 bg-[#f0a35e]/8 px-4 py-3 text-[13px] leading-snug text-[#f5c08e]">
              When you need a moment, close your mouth and pause. Fillers are counted for you.
            </p>
          )}
        </>
      )}

      {prompt.kind === 'emphasis' && (
        <>
          <Eyebrow>Read it aloud · stress the highlighted words</Eyebrow>
          <p className="mt-2 text-[18px] leading-relaxed text-chalk">
            <Emphasised text={prompt.text} />
          </p>
          <p className="mt-2 text-[11.5px] text-faint">Then say the same answer again in your own words, keeping the emphasis.</p>
        </>
      )}

      {prompt.kind === 'diction' && (
        <>
          <Eyebrow>Warm up · three times, crisply</Eyebrow>
          <p className="mt-2 rounded-xl bg-white/5 px-3 py-2 text-[17px] font-semibold text-[#8ee8ee]">“{prompt.twister}”</p>
          <Eyebrow>Then read twice · over-articulated, then natural</Eyebrow>
          <p className="mt-2 text-[16px] leading-relaxed text-chalk">{prompt.text}</p>
        </>
      )}

      {prompt.kind === 'paced' &&
        (() => {
          const target = paceWindow(prompt.text)
          const verdict = elapsed < target.min ? 'fast' : elapsed > target.max ? 'slow' : 'right'
          return (
            <>
              <Eyebrow>
                Read aloud · finish between {clock(target.min)} and {clock(target.max)}
              </Eyebrow>
              <p className="mt-2 text-[15.5px] leading-relaxed text-chalk">{prompt.text}</p>
              {review && (
                <Result tone={verdict === 'right' ? 'good' : 'work'}>
                  {verdict === 'right'
                    ? `Right on pace: ${clock(elapsed)} — about ${Math.round((target.words / Math.max(elapsed, 1)) * 60)} words a minute.`
                    : verdict === 'fast'
                      ? `Too fast: ${clock(elapsed)} (about ${Math.round((target.words / Math.max(elapsed, 1)) * 60)} words a minute). Pause at every full stop.`
                      : `A little slow: ${clock(elapsed)}. Keep pauses short between sentences.`}
                </Result>
              )}
            </>
          )
        })()}

      {prompt.kind === 'lens' && (
        <>
          <Eyebrow>Your question · answer to the camera</Eyebrow>
          <p className="mt-2 text-[18px] font-semibold leading-snug text-chalk">{prompt.question}</p>
          <LensCoach active={phase === 'prep' || phase === 'speak'} onResult={onLensResult} />
          {review && lensEye !== null && (
            <Result tone={lensEye >= 60 ? 'good' : 'work'}>
              You looked into the lens {lensEye}% of the time{lensEye >= 60 ? ' — great eye contact.' : '. Aim for 60% or more.'}
            </Result>
          )}
        </>
      )}

      {prompt.kind === 'projection' && (
        <>
          <Eyebrow>Your question · keep your voice strong to the end</Eyebrow>
          <p className="mt-2 text-[18px] font-semibold leading-snug text-chalk">{prompt.question}</p>
          {phase === 'speak' && (
            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-faint">
                <span>Quiet</span>
                <span>Strong</span>
              </div>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-white/8">
                <div
                  className={cn('h-full rounded-full transition-[width] duration-100', level * 500 > 35 ? 'bg-jade-400' : 'bg-[#fcd34d]')}
                  style={{ width: `${Math.min(100, level * 500)}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11.5px] text-mist">Keep the bar green through the last word of each sentence.</p>
            </div>
          )}
        </>
      )}

      {review && (
        <div className="mt-4">
          <Eyebrow>Check your answer</Eyebrow>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {drill.tips.map((t) => (
              <li key={t} className="flex gap-2 text-[13px] leading-snug text-mist">
                <IconCheck width={14} height={14} className="mt-0.5 shrink-0 text-jade-400" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Ring({ left, total, tone }: { left: number; total: number; tone: string }) {
  const r = 34
  const c = 2 * Math.PI * r
  const f = total > 0 ? Math.max(0, left) / total : 0
  return (
    <div className="relative grid size-24 place-items-center" role="timer" aria-label={`${Math.max(0, left)} seconds left`}>
      <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - f)}
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 300ms' }}
        />
      </svg>
      <span className="text-[22px] font-semibold tabular-nums text-chalk">{clock(Math.max(0, left))}</span>
    </div>
  )
}

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">{children}</div>
)

const Result = ({ tone, children }: { tone: 'good' | 'ok' | 'work'; children: React.ReactNode }) => (
  <div
    className={cn(
      'mt-4 rounded-xl border px-3 py-2.5 text-[13px] leading-snug',
      tone === 'good' ? 'border-jade-400/40 bg-jade-500/10 text-jade-300' : tone === 'ok' ? 'border-[#fcd34d]/40 bg-[#fcd34d]/10 text-[#fde68a]' : 'border-[#f0a35e]/40 bg-[#f0a35e]/10 text-[#f5c08e]',
    )}
    role="status"
  >
    {children}
  </div>
)

const Chip = ({ children }: { children: React.ReactNode }) => <span className="rounded-full bg-white/6 px-2.5 py-1">{children}</span>

const Primary = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className="h-11 w-full shrink-0 rounded-xl bg-jade-500 text-[13.5px] font-semibold text-ink-900 transition-colors hover:bg-jade-400 active:scale-[0.99]"
  >
    {children}
  </button>
)

const Secondary = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className="h-11 w-full shrink-0 rounded-xl border border-white/10 bg-white/5 text-[13px] font-medium text-chalk transition-colors hover:bg-white/10"
  >
    {children}
  </button>
)
