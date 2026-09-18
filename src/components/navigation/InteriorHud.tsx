import { useEffect, useRef } from 'react'
import { getLocation } from '@/data/locations'
import { DESTINATION_LABEL, describeSession } from '@/data/practice'
import { clock, useCountdown } from '@/lib/useCountdown'
import { cn } from '@/lib/utils'
import { useVoiceActivity } from '@/lib/useVoiceActivity'
import { isLiveInPerson, useAppStore } from '@/state/useAppStore'
import { INTERIOR_SPECS } from '@/three/interiors/poses'
import { Button } from '../ui/Button'
import { SlideControls, SlideReader } from './SlideControls'
import { IconArrowLeft, IconCheck, IconClose, IconHand, IconMic, IconScan } from '../ui/Icon'

/** The session set up in the panel, if it belongs to the current location. */
function useMySession() {
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  return session && session.locationId === selectedId ? session : null
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** At most this many hands wait at once. */
const HANDS_AT_ONCE = 3
/** Speaking this long, then pausing this long, counts as having answered. */
const ANSWER_SPEECH_MS = 2500
const ANSWER_PAUSE_MS = 1200
/** Without a microphone, a question is treated as answered after this long. */
const NO_MIC_ANSWER_MS = 20000

/**
 * Questions from the room, driven by the session rather than by taps.
 *
 * Hands go up as time passes: none in the first fifth, then a budget scaled to
 * the session length (a question every ~3 minutes, 2–10 in all) spread across
 * the rest, stopping in the final 20 seconds. The longest-waiting hand goes
 * down once the presenter has spoken for a moment and paused — they answered.
 */
function useQuestionFlow(opts: { enabled: boolean; running: boolean; left: number; total: number; speaking: boolean; micReady: boolean }) {
  const { enabled, running, left, total, speaking, micReady } = opts
  const raisedCount = useAppStore((s) => s.raisedHands.length)
  const raiseRandomHand = useAppStore((s) => s.raiseRandomHand)
  const lowerOldestHand = useAppStore((s) => s.lowerOldestHand)

  const asked = useRef(0)
  const speakingRef = useRef(speaking)
  speakingRef.current = speaking

  useEffect(() => {
    asked.current = 0
  }, [total])

  // New questions, paced by the clock.
  useEffect(() => {
    if (!enabled || !running || total <= 0) return
    const elapsed = 1 - left / total
    const budget = Math.max(2, Math.min(10, Math.round(total / 180)))
    const due = Math.floor(budget * smooth(0.2, 0.92, elapsed))
    if (left > 20 && asked.current < due && raisedCount < HANDS_AT_ONCE) {
      raiseRandomHand()
      asked.current++
    }
  }, [enabled, running, left, total, raisedCount, raiseRandomHand])

  // Answers, heard through the microphone.
  useEffect(() => {
    if (!enabled || !running) return
    let spoke = 0
    let quiet = 0
    let waited = 0
    const STEP = 200
    const id = window.setInterval(() => {
      if (useAppStore.getState().raisedHands.length === 0) {
        spoke = quiet = waited = 0
        return
      }
      waited += STEP
      if (speakingRef.current) {
        spoke += STEP
        quiet = 0
      } else if (spoke > 0) {
        quiet += STEP
      }
      const answered = micReady ? spoke >= ANSWER_SPEECH_MS && quiet >= ANSWER_PAUSE_MS : waited >= NO_MIC_ANSWER_MS
      if (answered) {
        lowerOldestHand()
        spoke = quiet = waited = 0
      }
    }, STEP)
    return () => window.clearInterval(id)
  }, [enabled, running, micReady, lowerOldestHand])
}

/** A few bars that follow the microphone level. */
function MicMeter({ level, speaking }: { level: number; speaking: boolean }) {
  const bars = [0.5, 1, 0.7]
  return (
    <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
      {bars.map((w, i) => (
        <span
          key={i}
          className={cn('w-[3px] rounded-full transition-[height] duration-100', speaking ? 'bg-jade-400' : 'bg-white/35')}
          style={{ height: `${Math.min(100, 25 + level * 900 * w)}%` }}
        />
      ))}
    </span>
  )
}

/**
 * While presenting: nothing but a small timer, the questions waiting, and a way
 * out — the room is the interface.
 */
function PresenterHud() {
  const mine = useMySession()!
  const zone = useAppStore((s) => s.interiorZone)
  const leave = useAppStore((s) => s.leaveInterior)
  const raised = useAppStore((s) => s.raisedHands)

  const total = mine.minutes * 60
  const timer = useCountdown(total)
  // Questions come from the auditorium audience, or from the three people at the meeting table.
  // Only presentations take questions from the room: interviewers, clients and a team talk
  // for themselves, nobody raises a hand.
  const questions =
    !mine.format.kind &&
    ((zone === 'theater' && mine.format.destination === 'theater') ||
      (zone === 'meeting' && mine.format.destination === 'meeting'))
  const voice = useVoiceActivity(questions && timer.running)
  // On stage the presenter's slides show on the lectern laptop; page controls sit in the bar.
  const showSlides = zone === 'theater' && mine.format.destination === 'theater'
  const setSlideZoom = useAppStore((s) => s.setSlideZoom)
  useEffect(() => () => setSlideZoom(false), [setSlideZoom])
  const setMicState = useAppStore((s) => s.setMicState)

  // Drives the tally ring on the lectern microphone.
  useEffect(() => {
    setMicState(!voice.available ? 'off' : voice.speaking ? 'speaking' : 'on')
  }, [voice.available, voice.speaking, setMicState])
  useEffect(() => () => setMicState('off'), [setMicState])
  useQuestionFlow({
    enabled: questions,
    running: timer.running,
    left: timer.left,
    total,
    speaking: voice.speaking,
    micReady: voice.available,
  })

  const status = !raised.length
    ? null
    : voice.speaking
      ? 'Answering…'
      : voice.available
        ? 'Listening'
        : voice.denied
          ? 'No mic'
          : null

  return (
    <>
    {showSlides && <SlideReader />}
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 hud-inset">
      <div className="anim-rise pointer-events-auto mx-auto flex w-full max-w-sm items-center justify-between gap-2">
        <button
          type="button"
          onClick={timer.toggle}
          aria-label={`${timer.label} timer, ${clock(timer.left)} left`}
          className="glass flex h-10 items-center gap-2 rounded-full pl-3 pr-3.5 transition-transform active:scale-[0.97]"
        >
          <span className={cn('size-2 rounded-full', timer.running ? 'animate-pulse bg-jade-400' : 'bg-white/30')} />
          <span className={cn('text-[15px] font-semibold tabular-nums', timer.done ? 'text-jade-400' : 'text-chalk')}>
            {timer.done ? 'Done' : clock(timer.left)}
          </span>
          <span className="text-[11px] text-faint">{timer.running ? 'Pause' : timer.label}</span>
        </button>

        {questions && (
          <div className="glass flex h-10 items-center gap-2 rounded-full px-3.5" aria-live="polite">
            <IconHand width={16} height={16} className={raised.length ? 'text-jade-400' : 'text-faint'} />
            <span className="text-[14px] font-semibold tabular-nums text-chalk">{raised.length}</span>
            {status && <span className="text-[11px] text-faint">{status}</span>}
            {voice.available && (
              <>
                <IconMic width={13} height={13} className="text-faint" />
                <MicMeter level={voice.level} speaking={voice.speaking} />
              </>
            )}
          </div>
        )}

        {showSlides && <SlideControls inline />}

        <button
          type="button"
          onClick={leave}
          aria-label="Leave"
          className="glass grid size-10 place-items-center rounded-full text-mist transition-colors hover:text-chalk"
        >
          <IconClose width={16} height={16} />
        </button>
      </div>
    </div>
    </>
  )
}

/** Arrival at the front doors: the visitor pass, and the scan that opens the building. */
function DoorHud({ name }: { name: string }) {
  const scanned = useAppStore((s) => s.passScanned)
  const scan = useAppStore((s) => s.scanPass)
  const leave = useAppStore((s) => s.leaveInterior)
  const mine = useMySession()
  const heading = mine && mine.format.destination !== 'call' ? DESTINATION_LABEL[mine.format.destination] : null

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 hud-inset">
      <div className="anim-rise pointer-events-auto mx-auto w-full max-w-sm">
        <div className="glass rounded-2xl p-4">
          <div className="eyebrow">Front entrance</div>
          <h2 className="mt-1.5 text-[18px] font-semibold leading-tight tracking-tight text-chalk">
            {scanned ? 'Access granted' : 'Scan your pass'}
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-mist">
            {scanned
              ? heading
                ? `Welcome to ${name}. Heading to ${heading}.`
                : `Welcome to ${name}. The doors are opening.`
              : 'Hold your visitor pass to the reader beside the doors.'}
          </p>

          {/* The pass itself — tapping it is also a scan. */}
          <button
            type="button"
            onClick={scan}
            disabled={scanned}
            aria-label="Hold pass to the reader"
            className={cn(
              'relative mt-4 block w-full overflow-hidden rounded-xl bg-gradient-to-br from-[#1c2b4b] to-[#0f1a3a] p-3.5 text-left ring-1',
              'transition-all duration-500 ease-[var(--ease-out-expo)]',
              scanned
                ? 'ring-jade-400/60 shadow-[0_0_30px_-6px_rgba(52,211,153,0.6)]'
                : 'ring-white/15 hover:ring-white/30 active:scale-[0.985]',
            )}
          >
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg bg-jade-500/15 ring-1 ring-jade-400/30">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3 21 8v8l-9 5-9-5V8z" stroke="var(--color-jade-400)" strokeWidth="1.6" strokeLinejoin="round" />
                  <circle cx="12" cy="12" r="2.6" fill="var(--color-jade-400)" />
                </svg>
              </span>
              <div className="leading-tight">
                <div className="text-[13px] font-semibold text-chalk">{name}</div>
                <div className="mt-0.5 text-[10px] font-semibold tracking-[0.14em] text-faint">VISITOR PASS</div>
              </div>
              {scanned ? (
                <IconCheck width={20} height={20} className="ml-auto text-jade-400" />
              ) : (
                <IconScan width={20} height={20} className="ml-auto text-mist" />
              )}
            </div>
            <div className="mt-3 flex items-end justify-between gap-2">
              <div className="min-w-0 truncate text-[11px] text-mist">
                {mine ? describeSession(mine) : 'Practice session'}
              </div>
              <span className="h-5 w-7 shrink-0 rounded-[5px] bg-gradient-to-br from-[#e6c483] to-[#b08a45]" />
            </div>
            {!scanned && (
              <span
                aria-hidden
                className="anim-scan pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-jade-400/15 to-transparent"
              />
            )}
          </button>

          <div className="mt-3 flex items-center gap-2">
            <Button variant="primary" onClick={scan} disabled={scanned} className="flex-1">
              {scanned ? <IconCheck width={15} height={15} /> : <IconScan width={15} height={15} />}
              {scanned ? 'Opening…' : 'Scan pass'}
            </Button>
            <Button variant="ghost" onClick={leave} aria-label="Leave">
              <IconArrowLeft width={15} height={15} />
              Leave
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Exploring the building without a session: the stations and the way out. */
function ExploreHud({ selectedId }: { selectedId: string }) {
  const zone = useAppStore((s) => s.interiorZone)
  const setZone = useAppStore((s) => s.setInteriorZone)
  const leave = useAppStore((s) => s.leaveInterior)
  const spec = INTERIOR_SPECS[selectedId]
  if (!spec) {
    // A photo-only room: nothing to walk between, just the way out.
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 hud-inset">
        <div className="anim-rise pointer-events-auto mx-auto flex w-fit">
          <Button variant="ghost" onClick={leave} className="glass h-10 px-4">
            <IconArrowLeft width={15} height={15} />
            Leave
          </Button>
        </div>
      </div>
    )
  }
  const current = spec.zones.find((z) => z.id === zone)

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 hud-inset">
      <div className="anim-rise pointer-events-auto mx-auto flex w-full max-w-[34rem] flex-col gap-3">
        {current && (
          <div className="glass mx-auto rounded-xl px-3.5 py-2 text-center">
            <div className="text-[12px] font-medium text-chalk">{current.label}</div>
            <div className="mt-0.5 text-[11px] text-faint">{current.note}</div>
          </div>
        )}

        <div className="glass flex flex-wrap items-center justify-center gap-1.5 rounded-2xl p-2">
          <Button variant="ghost" onClick={leave} className="h-9 px-3">
            <IconArrowLeft width={15} height={15} />
            Leave
          </Button>

          <span className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />

          <div className="flex min-w-0 flex-wrap items-center justify-center gap-1">
            {spec.zones.map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() => setZone(z.id)}
                className={cn(
                  'h-9 whitespace-nowrap rounded-xl px-3 text-[12px] font-medium transition-all duration-200 sm:px-3.5',
                  'outline-none focus-visible:ring-2 focus-visible:ring-jade-400/70',
                  z.id === zone
                    ? 'bg-jade-500/15 text-jade-400 ring-1 ring-jade-400/30'
                    : 'text-mist hover:bg-white/8 hover:text-chalk',
                )}
              >
                {z.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Contextual UI for an interior: arrival at the doors, then either the bare
 * presenter controls (with a session) or the stations to explore (without).
 */
export function InteriorHud() {
  const view = useAppStore((s) => s.view)
  const selectedId = useAppStore((s) => s.selectedId)
  const zone = useAppStore((s) => s.interiorZone)
  const mine = useMySession()

  if (view !== 'interior' || !selectedId) return null
  const loc = getLocation(selectedId)
  if (!loc) return null

  // A live in-person interview has its own screen from the front door on (InPersonInterview).
  if (isLiveInPerson(mine)) return null
  if (zone === 'door') return <DoorHud name={loc.name} />
  if (mine) return <PresenterHud />
  return <ExploreHud selectedId={selectedId} />
}
