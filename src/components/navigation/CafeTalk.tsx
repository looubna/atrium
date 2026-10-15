import { useEffect, useRef, useState } from 'react'
import { clock, useCountdown } from '@/lib/useCountdown'
import { cn } from '@/lib/utils'
import { useVoiceActivity } from '@/lib/useVoiceActivity'
import {
  CAFE_AREA_OF,
  createCafeSession,
  getCafeScenarios,
  type CafeArea,
  type CafeScenario,
} from '@/modules/cafe/api'
import { useInterviewRoom } from '@/modules/interview/live/useInterviewRoom'
import type { LiveFailure } from '@/modules/interview/live/useLiveInterview'
import { holdFaces } from '@/platform/avatar/faceWarmup'
import { useAppStore } from '@/state/useAppStore'
import { Button } from '../ui/Button'
import { IconArrowLeft, IconCoffee, IconMic, IconMicOff } from '../ui/Icon'
import { AvatarTile } from './AvatarTile'
import { useConversationLoading } from '@/platform/live/conversationLoading'
import { VIDEO_BASE } from '@/platform/media/videoBase'

/** After "End", how long to wait for the server to close the conversation before showing feedback anyway. */
const END_WAIT_MS = 4000
/** The face's picture and voice held this long before playing (see ParkTalk: long network path). */
const FACE_PLAYOUT_BUFFER_MS = 400
/** How long the face streams before the person speaks (a new stream renders slowly at first). */
const FACE_SETTLE_MS = 2500

/**
 * Each situation's person, filmed in its place: `<scenario>.mp4` is their listening loop (mouth shut,
 * holding a coffee, facing the user) and `.jpg` its first frame (infra/livetalking/recordings/cafe).
 */
const CAFE_MEDIA = `${VIDEO_BASE}/cafe`

const FAILURE: Partial<Record<LiveFailure, string>> = {
  mic_denied: 'Allow the microphone to talk.',
  forbidden: 'Accept recording and AI processing in your account first.',
  email_unverified: 'Verify your email address first.',
  quota: "You've used this month's live minutes.",
  conflict: 'Another live session is open.',
}

/**
 * The Café & Restaurant: a live conversation at a table. Before it, the user picks the situation (or
 * brings their own) and reads its brief: the goal and three techniques with their studies; during it,
 * the other person (voice only until the café is filmed) and a slim bar; after it, the coach's feedback.
 */
export function CafeTalk() {
  const view = useAppStore((s) => s.view)
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  const leave = useAppStore((s) => s.leaveDrill)
  const openFeedback = useAppStore((s) => s.openFeedback)
  const mine = session && session.locationId === selectedId && session.format.kind === 'cafe' ? session : null
  const area = mine ? CAFE_AREA_OF[mine.area] : undefined
  if (view !== 'talk' || !mine || !area) return null
  return <Conversation area={area} minutes={mine.minutes} onLeave={leave} onFeedback={openFeedback} />
}

function Conversation({ area, minutes, onLeave, onFeedback }: {
  area: CafeArea
  minutes: number
  onLeave: () => void
  onFeedback: (sessionId: string) => void
}) {
  // The lip-sync server stays up while the user is at the table, reading the brief included.
  useEffect(() => holdFaces(), [])

  const setSceneCovered = useAppStore((s) => s.setSceneCovered)
  useEffect(() => {
    setSceneCovered(true)
    return () => setSceneCovered(false)
  }, [setSceneCovered])

  const timer = useCountdown(minutes * 60)
  const voice = useVoiceActivity(true)
  const [chosen, setChosen] = useState<CafeScenario | null>(null)
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

  const start = (scenario: CafeScenario, own: string) => {
    setChosen(scenario)
    timer.toggle()
    // The loading screen from now until the first words: never the room with someone silently waiting.
    useConversationLoading.getState().set(true)
    createCafeSession(scenario.id, own, minutes, window.innerWidth > window.innerHeight)
      .then(({ id }) => !unmounted.current && setSessionId(id))
      .catch(() => {
        useConversationLoading.getState().set(false)
        if (!unmounted.current) setNote('The conversation could not start. Check your connection.')
      })
  }

  // "End": the server closes the conversation (so it is recorded and scored), then the feedback opens.
  useEffect(() => {
    if (!ending || !sessionId) return
    if (ended) {
      onFeedback(sessionId)
      return
    }
    const id = window.setTimeout(() => onFeedback(sessionId), END_WAIT_MS)
    return () => window.clearTimeout(id)
  }, [ending, ended, sessionId, onFeedback])

  const live = Boolean(sessionId) && !note
  return (
    <div className="anim-fade absolute inset-0 z-[45] overflow-hidden" role="region" aria-label="Café conversation">
      <Backdrop scenario={chosen} speaking={speaking} />
      {sessionId && !note && (
        <LivePerson
          sessionId={sessionId}
          ending={ending}
          onSpeaking={setSpeaking}
          onEnded={() => setEnded(true)}
          onFailed={(why) => setNote(why)}
        />
      )}

      {!chosen && <StartCard area={area} onStart={start} onLeave={onLeave} />}

      {chosen && (
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
          <span className="min-w-0 truncate text-[13px] font-medium text-chalk">{note ?? `${chosen.name} · ${chosen.label}`}</span>
          {ended && sessionId && !ending && (
            <button
              type="button"
              onClick={() => onFeedback(sessionId)}
              className="flex h-8 shrink-0 items-center rounded-full bg-white/12 px-2.5 text-[12px] font-medium text-chalk hover:bg-white/16"
            >
              Feedback
            </button>
          )}
          <button
            type="button"
            onClick={() => (live && !ended ? setEnding(true) : onLeave())}
            disabled={ending}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-white/8 px-2.5 text-[12px] font-medium text-mist hover:text-chalk disabled:opacity-60"
          >
            <IconArrowLeft width={13} height={13} />
            {live && !ended ? (ending ? 'Ending…' : 'End') : 'Leave'}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The person in their place: their filmed loop (listening, holding a coffee) under the live face. Without
 * the footage (not loaded yet, or before a situation is picked), a warm screen that glows while they speak.
 */
function Backdrop({ scenario, speaking }: { scenario: CafeScenario | null; speaking: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (scenario && failed !== scenario.id) {
    return (
      <video
        key={scenario.id}
        src={`${CAFE_MEDIA}/${scenario.id}.mp4`}
        poster={`${CAFE_MEDIA}/${scenario.id}.jpg`}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        onError={() => setFailed(scenario.id)}
        className="absolute inset-0 size-full bg-black object-cover"
        aria-hidden
      />
    )
  }
  return (
    <div className="absolute inset-0 bg-[#140d09]" aria-hidden>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(70% 60% at 50% 40%, rgba(236,90,69,0.2), transparent 70%)' }} />
      {scenario && (
        <div className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 text-center">
          <div className="relative mx-auto grid size-40 place-items-center">
            <span className={cn('absolute inset-0 rounded-full border border-[#f08a6c]/30 transition-transform duration-500', speaking ? 'scale-110 opacity-100' : 'scale-95 opacity-50')} />
            <span className={cn('absolute inset-4 rounded-full border border-[#f08a6c]/40 transition-transform duration-300', speaking ? 'scale-105' : 'scale-95')} />
            <IconCoffee width={64} height={64} className={cn('transition-colors', speaking ? 'text-[#ffb59e]' : 'text-[#f08a6c]/70')} />
          </div>
          <div className="mt-5 text-[17px] font-semibold text-chalk">{scenario.name}</div>
          <div className="text-[12.5px] text-mist">{scenario.label}</div>
        </div>
      )}
    </div>
  )
}

/** Before the conversation: the situation, who with, its brief, or the user's own situation. */
function StartCard({ area, onStart, onLeave }: {
  area: CafeArea
  onStart: (scenario: CafeScenario, own: string) => void
  onLeave: () => void
}) {
  const [scenarios, setScenarios] = useState<CafeScenario[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [ownOn, setOwnOn] = useState(false)
  const [own, setOwn] = useState('')
  useEffect(() => {
    let dropped = false
    getCafeScenarios(area)
      .then((list) => {
        if (dropped) return
        setScenarios(list)
        setPicked(list[0]?.id ?? null)
      })
      .catch(() => !dropped && setFailed(true))
    return () => {
      dropped = true
    }
  }, [area])
  const scenario = scenarios?.find((s) => s.id === picked) ?? null
  const ready = Boolean(scenario) && (!ownOn || own.trim().length >= 10)

  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="glass hud-inset anim-rise pointer-events-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl p-4">
        <p className="text-[15px] font-semibold text-chalk">
          {area === 'starting' ? 'Start a conversation' : 'Conversations that matter'}
        </p>
        <p className="mt-1 text-[12.5px] leading-snug text-mist">
          {area === 'starting'
            ? 'Talk live with someone at the café. They react like a real person: open it, keep it going, and end it well.'
            : 'The conversations people put off: advice from someone you admire, a no to a friend, a disagreement, a client dinner. Say what you mean and keep the relationship.'}
        </p>

        {failed && <p className="mt-3 text-[12.5px] text-[#fca5a5]">The situations could not load. Check your connection.</p>}
        {!scenarios && !failed && <p className="mt-3 text-[12.5px] text-faint">Loading…</p>}

        {scenarios && (
          <div role="radiogroup" aria-label="Situation" className="mt-3 flex flex-col gap-1.5">
            {scenarios.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={picked === s.id}
                onClick={() => setPicked(s.id)}
                className={cn(
                  'rounded-xl border px-3 py-2 text-left transition-colors',
                  picked === s.id ? 'border-[#f08a6c]/50 bg-[#f08a6c]/10' : 'border-white/8 bg-white/4 hover:border-white/15',
                )}
              >
                <span className="block text-[12.5px] font-medium text-chalk">{s.label}</span>
                <span className="mt-0.5 block text-[10.5px] text-faint">With {s.name}</span>
              </button>
            ))}
          </div>
        )}

        {scenario && (
          <section className="mt-3 rounded-xl border border-white/8 bg-white/4 px-3 py-2.5">
            {!ownOn && <p className="text-[12.5px] leading-snug text-mist">{scenario.example}</p>}
            <p className="mt-1 text-[12.5px] leading-snug text-chalk">
              <span className="text-faint">Your goal:</span> {scenario.goal}
            </p>
            <div className="mt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">What works</div>
            <ul className="mt-1 flex flex-col gap-1.5">
              {scenario.tips.map((t) => (
                <li key={t.name} className="text-[12px] leading-snug text-mist">
                  <span className="font-medium text-chalk">{t.name}.</span> {t.how}
                  <span className="mt-0.5 block text-[11px] text-faint">
                    {t.evidence}{' '}
                    {t.studies.map((st, i) => (
                      <a key={st.url} href={st.url} target="_blank" rel="noreferrer" title={st.title} className="underline decoration-white/20 underline-offset-2 hover:text-mist">
                        {i ? ' · ' : ''}
                        paper {i + 1}
                      </a>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {scenario && (
          <>
            <button
              type="button"
              onClick={() => setOwnOn((v) => !v)}
              className="mt-2 text-[12px] font-medium text-[#f08a6c] hover:underline"
            >
              {ownOn ? 'Use the example instead' : 'Practise my own situation instead'}
            </button>
            {ownOn && (
              <textarea
                value={own}
                onChange={(e) => setOwn(e.target.value)}
                placeholder="Describe your situation: who, where, what you want to happen"
                rows={3}
                maxLength={1500}
                className="mt-1.5 block w-full resize-none rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-[12.5px] leading-relaxed text-chalk outline-none placeholder:text-faint focus:border-[#f08a6c]/40"
              />
            )}
          </>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={onLeave} className="rounded-full px-3 py-2 text-[12px] font-medium text-mist hover:text-chalk">
            Leave
          </button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={!ready}
            onClick={() => scenario && onStart(scenario, ownOn ? own.trim() : '')}
          >
            <IconMic width={15} height={15} />
            Start talking
          </Button>
        </div>
      </div>
    </div>
  )
}

/** The other person, live: their voice, and their face once the café has been filmed. */
function LivePerson({ sessionId, ending, onSpeaking, onEnded, onFailed }: {
  sessionId: string
  ending: boolean
  onSpeaking: (speaking: boolean) => void
  onEnded: () => void
  onFailed: (why: string) => void
}) {
  const [mayOpen, setMayOpen] = useState(false)
  const room = useInterviewRoom({ sessionId, camera: null, module: 'cafe', openWhen: mayOpen })
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
    if (phase === 'failed') told.current.onFailed(FAILURE[failure ?? 'unavailable'] ?? "They can't talk right now.")
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
