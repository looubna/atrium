import { isTrialUsed } from '@/platform/api/client'
import { type MutableRefObject, useEffect, useRef, useState } from 'react'
import { PRACTICE_FORMATS } from '@/data/practice'
import { clock, useCountdown } from '@/lib/useCountdown'
import { cn } from '@/lib/utils'
import { useVoiceActivity } from '@/lib/useVoiceActivity'
import {
  BRAIN_FOCUSES,
  TECHNIQUE_NAMES,
  createBrainSession,
  getLatestPlan,
  getSessionPlan,
  type BrainFocus,
  type BrainPlan,
} from '@/modules/brainlab/api'
import { useInterviewRoom } from '@/modules/interview/live/useInterviewRoom'
import type { LiveFailure } from '@/modules/interview/live/useLiveInterview'
import { useAppStore } from '@/state/useAppStore'
import { Button } from '../ui/Button'
import { IconArrowLeft, IconBrain, IconCheck, IconChevronRight, IconMic, IconMicOff, IconTarget } from '../ui/Icon'
import { AvatarTile } from './AvatarTile'
import { useConversationLoading } from '@/platform/live/conversationLoading'
import { VIDEO_BASE } from '@/platform/media/videoBase'

/** Her face's picture and voice held this long before playing (see ParkTalk: long network path). */
const FACE_PLAYOUT_BUFFER_MS = 400
/** How long the face streams before she says hello (a new stream renders slowly at first). */
const FACE_SETTLE_MS = 2500
/** How often the page asks whether the Brain Plan is written, and for how long. */
const PLAN_POLL_MS = 4000
const PLAN_WAIT_MS = 4 * 60_000

const FAILURE: Partial<Record<LiveFailure, string>> = {
  mic_denied: 'Allow the microphone to talk.',
  forbidden: 'Accept recording and AI processing in your account first.',
  email_unverified: 'Verify your email address first.',
  quota: "You've used this month's live minutes.",
  conflict: 'Another live session is open.',
}

/**
 * The Brain Lab: a live consultation with Dr. Maya Rahimi, a neuroscientist coach. Before it, the
 * user says what they came for; during it, only her (her face once filmed, a calm voice screen until
 * then) and a slim bar; after it, the Brain Plan she built with them, each practice step a room.
 */
export function BrainLab() {
  const view = useAppStore((s) => s.view)
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  const leave = useAppStore((s) => s.leaveDrill)
  const mine = session && session.locationId === selectedId && session.format.kind === 'brainlab' ? session : null
  if (view !== 'talk' || !mine) return null
  return <Consultation minutes={mine.minutes} onLeave={leave} />
}

function Consultation({ minutes, onLeave }: { minutes: number; onLeave: () => void }) {
  const setSceneCovered = useAppStore((s) => s.setSceneCovered)
  useEffect(() => {
    setSceneCovered(true)
    return () => setSceneCovered(false)
  }, [setSceneCovered])

  const timer = useCountdown(minutes * 60)
  const voice = useVoiceActivity(true)
  const [started, setStarted] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [ending, setEnding] = useState(false)
  const [ended, setEnded] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const unmounted = useRef(false)
  useEffect(() => {
    unmounted.current = false
    return () => {
      unmounted.current = true
      useConversationLoading.getState().set(false)
    }
  }, [])

  const start = (focus: BrainFocus, own: string) => {
    setStarted(true)
    timer.toggle()
    // The loading screen from now until the first words: never the room with someone silently waiting.
    useConversationLoading.getState().set(true)
    createBrainSession(focus, own, minutes, window.innerWidth > window.innerHeight)
      .then(({ id }) => !unmounted.current && setSessionId(id))
      .catch((error: unknown) => {
        useConversationLoading.getState().set(false)
        if (unmounted.current) return
        // Nothing began: the clock must not run down on an empty room.
        timer.stop()
        // The paywall is open over everything: back to the building, not a room with nobody talking.
        if (isTrialUsed(error)) return onLeave()
        setNote('The consultation could not start. Check your connection.')
      })
  }

  const live = Boolean(sessionId) && !note && !ended
  return (
    <div className="anim-fade absolute inset-0 z-[45] overflow-hidden" role="region" aria-label="Brain Lab consultation">
      <LabBackdrop speaking={speaking} />
      {sessionId && !note && !ended && (
        <LiveExpert
          sessionId={sessionId}
          ending={ending}
          onSpeaking={setSpeaking}
          onEnded={() => setEnded(true)}
          onFailed={(why) => setNote(why)}
        />
      )}

      {!started && <StartCard onStart={start} onLeave={onLeave} />}
      {ended && sessionId && <PlanWait sessionId={sessionId} onLeave={onLeave} />}

      {started && !ended && (
        <div
          className="pointer-events-auto absolute inset-x-0 z-10 mx-auto flex w-fit max-w-[94vw] items-center gap-2 rounded-full py-1 pl-3 pr-1 glass hud-inset"
          style={{ bottom: '1.25rem' }}
        >
          {voice.denied ? (
            <IconMicOff width={14} height={14} className="shrink-0 text-[#fca5a5]" aria-label="Microphone unavailable" />
          ) : (
            <IconMic width={14} height={14} className={cn('shrink-0', voice.speaking ? 'text-jade-400' : 'text-faint')} aria-label={voice.speaking ? 'You are speaking' : 'Listening'} />
          )}
          <span className={cn('text-[12px] tabular-nums', timer.done ? 'text-[#fca5a5]' : 'text-mist')} aria-label="Time left">
            {clock(timer.left)}
          </span>
          <span className="min-w-0 truncate text-[13px] font-medium text-chalk">{note ?? 'Dr. Maya Rahimi · Neuroscientist'}</span>
          <button
            type="button"
            onClick={() => (live ? setEnding(true) : onLeave())}
            disabled={ending}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-white/8 px-2.5 text-[12px] font-medium text-mist hover:text-chalk disabled:opacity-60"
          >
            <IconArrowLeft width={13} height={13} />
            {live ? (ending ? 'Ending…' : 'End') : 'Leave'}
          </button>
        </div>
      )}
    </div>
  )
}

/** Her filmed listening loop: the very frames her lip-synced face is painted on (infra/.../brainlab). */
const DOCTOR_FACE = `${VIDEO_BASE}/brainlab/doctor_face`

/**
 * Her in her lab: the filmed loop (mouth shut) under the live face, which lands exactly on it. Without
 * the footage, a calm screen with a brain that glows while she speaks.
 */
function LabBackdrop({ speaking }: { speaking: boolean }) {
  const [footage, setFootage] = useState(true)
  if (footage) {
    return (
      <video
        src={`${DOCTOR_FACE}.mp4`}
        poster={`${DOCTOR_FACE}.jpg`}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        onError={() => setFootage(false)}
        className="absolute inset-0 size-full bg-black object-cover"
        aria-hidden
      />
    )
  }
  return (
    <div className="absolute inset-0 bg-[#07121a]" aria-hidden>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(70% 60% at 50% 40%, rgba(44,184,196,0.22), transparent 70%)' }} />
      <div className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 text-center">
        <div className="relative mx-auto grid size-40 place-items-center">
          <span className={cn('absolute inset-0 rounded-full border border-[#5fd6de]/30 transition-transform duration-500', speaking ? 'scale-110 opacity-100' : 'scale-95 opacity-50')} />
          <span className={cn('absolute inset-4 rounded-full border border-[#5fd6de]/40 transition-transform duration-300', speaking ? 'scale-105' : 'scale-95')} />
          <IconBrain width={72} height={72} className={cn('transition-colors', speaking ? 'text-[#8ee8ee]' : 'text-[#5fd6de]/70')} />
        </div>
        <div className="mt-5 text-[17px] font-semibold text-chalk">Dr. Maya Rahimi</div>
        <div className="text-[12.5px] text-mist">Cognitive neuroscientist · Brain Lab</div>
      </div>
    </div>
  )
}

/** Before the consultation: what the user came for, and their last plan to build on. */
function StartCard({ onStart, onLeave }: { onStart: (focus: BrainFocus, own: string) => void; onLeave: () => void }) {
  const [focus, setFocus] = useState<BrainFocus>('speaking-confidence')
  const [own, setOwn] = useState('')
  const [last, setLast] = useState<BrainPlan | null>(null)
  const [showLast, setShowLast] = useState(false)
  useEffect(() => {
    let dropped = false
    getLatestPlan()
      .then(({ plan }) => !dropped && setLast(plan))
      .catch(() => {})
    return () => {
      dropped = true
    }
  }, [])
  const ready = focus !== 'own' || own.trim().length >= 10
  if (last && showLast)
    return (
      <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/55 p-4 sm:items-center">
        <div className="glass hud-inset anim-rise pointer-events-auto max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl p-4">
          <PlanCard plan={last} />
          <Button variant="primary" className="mt-4 w-full" onClick={() => setShowLast(false)}>
            Back
          </Button>
        </div>
      </div>
    )
  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="glass hud-inset anim-rise pointer-events-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl p-4">
        <p className="text-[15px] font-semibold text-chalk">A consultation with Dr. Maya Rahimi</p>
        <p className="mt-1 text-[12.5px] leading-snug text-mist">
          A cognitive neuroscientist. She will ask what you want to change, explain what happens in your brain, teach you
          one or two techniques with real evidence behind them — and build your Brain Plan with you.
        </p>
        <div role="radiogroup" aria-label="What brings you in" className="mt-3 flex flex-col gap-1.5">
          {BRAIN_FOCUSES.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={focus === f.id}
              onClick={() => setFocus(f.id)}
              className={cn(
                'rounded-xl border px-3 py-2 text-left transition-colors',
                focus === f.id ? 'border-[#5fd6de]/50 bg-[#5fd6de]/10' : 'border-white/8 bg-white/4 hover:border-white/15',
              )}
            >
              <span className="block text-[12.5px] font-medium text-chalk">{f.label}</span>
              <span className="mt-0.5 block text-[10.5px] text-faint">{f.note}</span>
            </button>
          ))}
        </div>
        {(focus === 'own' || own) && (
          <textarea
            value={own}
            onChange={(e) => setOwn(e.target.value)}
            placeholder={focus === 'own' ? 'What do you want to change?' : 'Anything she should know (optional)'}
            rows={2}
            maxLength={1500}
            className="mt-2 block w-full resize-none rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-[12.5px] leading-relaxed text-chalk outline-none placeholder:text-faint focus:border-[#5fd6de]/40"
          />
        )}
        {last && (
          <div className="mt-3 rounded-xl border border-white/8 bg-white/4 px-3 py-2">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Your last plan</div>
            <p className="mt-1 text-[12px] leading-snug text-mist">{last.goal}</p>
            <button
              type="button"
              onClick={() => setShowLast(true)}
              className="mt-1.5 text-[12px] font-medium text-[#5fd6de] hover:underline"
            >
              See your last report
            </button>
          </div>
        )}

        <p className="mt-3 text-[10.5px] leading-snug text-faint">
          She is a coach, not a doctor. For anxiety or low mood that affects your daily life, please see a professional.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={onLeave} className="rounded-full px-3 py-2 text-[12px] font-medium text-mist hover:text-chalk">
            Leave
          </button>
          <Button variant="primary" className="flex-1" disabled={!ready} onClick={() => onStart(focus, own.trim())}>
            <IconMic width={15} height={15} />
            Start the consultation
          </Button>
        </div>
      </div>
    </div>
  )
}

/** The neuroscientist, live: her voice, and her face once she has been filmed. */
function LiveExpert({ sessionId, ending, onSpeaking, onEnded, onFailed }: {
  sessionId: string
  ending: boolean
  onSpeaking: (speaking: boolean) => void
  onEnded: () => void
  onFailed: (why: string) => void
}) {
  const [mayOpen, setMayOpen] = useState(false)
  const room = useInterviewRoom({ sessionId, camera: null, module: 'brainlab', openWhen: mayOpen })
  const { live, avatar, avatarFailed, leadFaceLive, faceSettled } = room
  const { start, end } = live
  const { phase, failure, interviewerSpeaking } = live.state
  useEffect(() => {
    if (mayOpen) return
    if (leadFaceLive) {
      const id = window.setTimeout(() => setMayOpen(true), FACE_SETTLE_MS)
      return () => window.clearTimeout(id)
    }
    if (faceSettled) setMayOpen(true)
  }, [mayOpen, leadFaceLive, faceSettled])
  useEffect(() => {
    const id = window.setTimeout(() => void start(), 0)
    return () => window.clearTimeout(id)
  }, [start])
  useEffect(() => {
    avatar?.renderer.setPlayoutBuffer?.(FACE_PLAYOUT_BUFFER_MS)
  }, [avatar])
  const told = useRef({ onEnded, onFailed, onSpeaking })
  told.current = { onEnded, onFailed, onSpeaking }
  useEffect(() => told.current.onSpeaking(interviewerSpeaking), [interviewerSpeaking])
  useEffect(() => {
    if (phase === 'ended') told.current.onEnded()
    if (phase === 'failed') told.current.onFailed(FAILURE[failure ?? 'unavailable'] ?? "She can't talk right now.")
  }, [phase, failure])
  useEffect(() => {
    if (ending) end()
  }, [ending, end])

  if (!avatar || avatarFailed) return null
  return (
    <AvatarTile
      variant="closeup"
      renderer={avatar.renderer}
      name={avatar.name}
      role={avatar.role}
      speaking={interviewerSpeaking}
      shown
      onLive={room.setFaceOnScreen}
      onFailed={room.onAvatarFailed}
      onEnded={room.onFaceEnded}
    />
  )
}

/** After the consultation: the Brain Plan, once written from the conversation (after the report). */
function PlanWait({ sessionId, onLeave }: { sessionId: string; onLeave: () => void }) {
  const [plan, setPlan] = useState<BrainPlan | null>(null)
  const [gaveUp, setGaveUp] = useState(false)
  const since = useRef(Date.now()) as MutableRefObject<number>
  useEffect(() => {
    if (plan || gaveUp) return
    const id = window.setInterval(() => {
      getSessionPlan(sessionId)
        .then((r) => {
          if (r.plan) setPlan(r.plan)
          else if (r.processingStatus === 'failed' || Date.now() - since.current > PLAN_WAIT_MS) setGaveUp(true)
        })
        .catch(() => {})
    }, PLAN_POLL_MS)
    return () => window.clearInterval(id)
  }, [sessionId, plan, gaveUp])

  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/55 p-4 sm:items-center">
      <div className="glass hud-inset anim-rise pointer-events-auto max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl p-4">
        {plan ? (
          <PlanCard plan={plan} />
        ) : (
          <div className="flex items-center gap-3 py-2" role="status">
            <span className="size-2 animate-pulse rounded-full bg-[#5fd6de]" />
            <span className="text-[13px] text-mist">
              {gaveUp
                ? 'Your report is taking longer than usual. It will be here next time you open the Lab.'
                : 'Dr. Rahimi is writing your report: solutions to what you talked about…'}
            </span>
          </div>
        )}
        <Button variant="primary" className="mt-4 w-full" onClick={onLeave}>
          Leave the Lab
        </Button>
      </div>
    </div>
  )
}

/** "If my heart races," → "my heart races": the card says "If" and "then" itself. */
const bare = (text: string, word: string) =>
  text.replace(new RegExp(`^\\s*${word}\\b[\\s,]*`, 'i'), '').replace(/[\s,]+$/, '')

/**
 * The consultation's report: the user's issue, what is happening in their brain, the solutions that
 * fit them (why, how, when, and the studies), then their plan, each practice step one tap from its room.
 * About the issue they brought — never a score of how they talked.
 */
export function PlanCard({ plan }: { plan: BrainPlan }) {
  const setSession = useAppStore((s) => s.setSession)
  const select = useAppStore((s) => s.select)
  const leave = useAppStore((s) => s.leaveDrill)
  const go = (rung: BrainPlan['ladder'][number]) => {
    const entry = Object.entries(PRACTICE_FORMATS).find(([, formats]) => formats.some((f) => f.id === rung.formatId))
    const format = entry?.[1].find((f) => f.id === rung.formatId)
    leave()
    // A drill needs nothing else to start; a room with its own setup opens at its place, to set up there.
    if (entry && format?.destination === 'drill') setSession({ locationId: rung.locationId, area: entry[0], format, minutes: 10 })
    select(rung.locationId)
  }
  return (
    <div>
      <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#8ee8ee]">
        <IconBrain width={14} height={14} />
        Your consultation report
      </div>
      {plan.summary && <p className="mt-2 text-[13px] leading-snug text-mist">{plan.summary}</p>}

      {plan.insights && plan.insights.length > 0 && (
        <section className="mt-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">What's happening in your brain</div>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {plan.insights.map((i) => (
              <li key={i.point} className="text-[12.5px] leading-snug text-chalk">
                {i.point}
                {i.sources.length > 0 && <span className="ml-1 text-[11px] text-faint">({i.sources.map((s) => s.split(' (')[0]).join('; ')})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan.solutions && plan.solutions.length > 0 && (
        <section className="mt-4">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#8ee8ee]">Your solutions</div>
          <ol className="mt-1.5 flex flex-col gap-2">
            {plan.solutions.map((sol, n) => (
              <li key={sol.technique} className="rounded-xl border border-[#5fd6de]/25 bg-[#5fd6de]/[0.05] px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-semibold text-[#8ee8ee]">{n + 1}</span>
                  <span className="text-[13.5px] font-semibold text-chalk">{sol.name}</span>
                </div>
                <p className="mt-1 text-[12.5px] leading-snug text-mist">{sol.whyForYou}</p>
                <ol className="mt-1.5 flex list-decimal flex-col gap-0.5 pl-5 text-[12.5px] leading-snug text-chalk">
                  {sol.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {sol.when && (
                  <p className="mt-1.5 text-[12px] leading-snug text-mist">
                    <span className="text-faint">When:</span> {sol.when}
                  </p>
                )}
                <p className="mt-1.5 text-[11px] leading-snug text-faint">
                  Why it works: {sol.evidence}{' '}
                  {sol.sources.map((s, i) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noreferrer" title={s.title} className="underline decoration-white/20 underline-offset-2 hover:text-mist">
                      {i ? ' · ' : ''}
                      paper {i + 1}
                    </a>
                  ))}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Your plan</div>
      <p className="mt-1 text-[15px] font-semibold leading-snug text-chalk">{plan.goal}</p>
      {plan.obstacle && (
        <p className="mt-1 text-[12.5px] text-mist">
          <span className="text-faint">What gets in the way:</span> {plan.obstacle}
        </p>
      )}

      {plan.ifThen.length > 0 && (
        <section className="mt-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">If… then…</div>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {plan.ifThen.map((p) => (
              <li key={p.when} className="rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-[12.5px] leading-snug text-mist">
                <span className="text-faint">If</span> {bare(p.when, 'if')}, <span className="text-faint">then</span>{' '}
                <span className="text-chalk">{bare(p.then, 'then')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-3 rounded-xl border border-[#5fd6de]/25 bg-[#5fd6de]/[0.06] px-3 py-2.5">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#8ee8ee]">Before you speak · 1 minute</div>
        <ol className="mt-1.5 flex flex-col gap-1 text-[12.5px] leading-snug text-mist">
          <li>
            <span className="text-chalk">{plan.routine.sighs}× physiological sigh:</span> two inhales through the nose, one long
            exhale through the mouth.
          </li>
          {plan.routine.line && (
            <li>
              <span className="text-chalk">Say to yourself:</span> “{plan.routine.line}”
            </li>
          )}
        </ol>
      </section>

      {plan.ladder.length > 0 && (
        <section className="mt-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Your ladder · easiest first</div>
          <ol className="mt-1.5 flex flex-col gap-1.5">
            {plan.ladder.map((r, i) => (
              <li key={r.room}>
                <button
                  type="button"
                  onClick={() => go(r)}
                  className="group flex w-full items-center gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-left hover:border-[#5fd6de]/40 hover:bg-[#5fd6de]/10"
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold text-chalk">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-chalk">{r.step}</span>
                    <span className="block text-[10.5px] text-faint">{r.label}</span>
                  </span>
                  <IconChevronRight width={15} height={15} className="shrink-0 text-faint group-hover:text-[#8ee8ee]" />
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {plan.techniques.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
          <IconTarget width={12} height={12} />
          Techniques:
          {plan.techniques.map((t) => (
            <span key={t} className="rounded-full border border-white/10 px-2 py-0.5 text-mist">
              {TECHNIQUE_NAMES[t] ?? t}
            </span>
          ))}
        </p>
      )}
      {!plan.solutions?.length && plan.sources && plan.sources.length > 0 && (
        <section className="mt-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">The science behind your plan</div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {plan.sources.map((s) => (
              <li key={s.url + s.technique} className="text-[11.5px] leading-snug text-mist">
                <span className="text-chalk">{s.technique}:</span>{' '}
                <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-white/25 underline-offset-2 hover:text-chalk" title={s.title}>
                  {s.cite}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {plan.note && (
        <p className="mt-3 flex gap-2 text-[12.5px] italic leading-snug text-mist">
          <IconCheck width={14} height={14} className="mt-0.5 shrink-0 text-jade-400" />
          {plan.note}
        </p>
      )}
    </div>
  )
}
