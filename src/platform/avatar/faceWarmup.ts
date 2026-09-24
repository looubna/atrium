import { create } from 'zustand'
import { api } from '@/platform/api/client'

/**
 * The lip-sync server's GPU is stopped whenever nobody is practising (it costs the same idle as
 * busy), and a cold start takes the better part of a minute and a half. So it is started the moment
 * someone opens the setup of a session with a face, not when the session begins: the setup, the
 * walk in and the first seconds of the call cover the boot, and the candidate is told how far along
 * it is rather than left looking at an empty chair.
 *
 * Whoever needs the face holds it (`holdFaces`). While anything holds it this polls the server,
 * which both reports progress and keeps a running server from idling off. Letting go only stops
 * the polling; the server stops itself once idle.
 */

export type FaceWarmState = 'idle' | 'starting' | 'loading' | 'ready' | 'unavailable'

interface WarmReply {
  state: Exclude<FaceWarmState, 'idle'>
  elapsedS: number
  expectedS: number
}

interface FaceWarmup {
  state: FaceWarmState
  /** When this page started waiting, and how far along the server said it was at the last poll. */
  since: number
  elapsedS: number
  expectedS: number
  /** When the server last answered (0: never). */
  checkedAt: number
  /** Something on screen is waiting for the face (a setup form, a room), and since when. */
  holding: boolean
  heldAt: number
}

export const useFaceWarmup = create<FaceWarmup>(() => ({
  state: 'idle',
  since: 0,
  elapsedS: 0,
  expectedS: 80,
  checkedAt: 0,
  holding: false,
  heldAt: 0,
}))

/** A "ready" older than this is asked again before anyone relies on it: the server may have idled off. */
const READY_FRESH_MS = 90_000

/** Fast while it is starting, so the moment it is up is not missed; slow once it is only holding. */
const POLL_STARTING_MS = 2_500
const POLL_READY_MS = 60_000
const POLL_UNAVAILABLE_MS = 20_000

let holders = 0
let timer: ReturnType<typeof setTimeout> | undefined
let inFlight = false

async function poll() {
  timer = undefined
  if (holders === 0 || inFlight) return
  inFlight = true
  let next = POLL_STARTING_MS
  try {
    const reply = await api<WarmReply>('/faces/warm', { method: 'POST', timeoutMs: 15_000 })
    const now = Date.now()
    useFaceWarmup.setState((prev) => ({
      state: reply.state,
      // Whichever began first: this page's wait, or a start the server was already making for someone else.
      since: Math.min(
        prev.state === 'starting' || prev.state === 'loading' ? prev.since : now,
        now - reply.elapsedS * 1000,
      ),
      elapsedS: reply.elapsedS,
      expectedS: reply.expectedS,
      checkedAt: now,
    }))
    if (reply.state === 'ready') next = POLL_READY_MS
    if (reply.state === 'unavailable') next = POLL_UNAVAILABLE_MS
  } catch {
    // Signed out, offline, or no face server at all: the session runs on its voice.
    useFaceWarmup.setState({ state: 'unavailable', checkedAt: Date.now() })
    next = POLL_UNAVAILABLE_MS
  } finally {
    inFlight = false
  }
  if (holders > 0 && timer === undefined) timer = setTimeout(poll, next)
}

/** Start the face server if it is not up, and keep it up until the returned release is called. */
export function holdFaces(): () => void {
  holders += 1
  if (holders === 1) {
    const { state, checkedAt } = useFaceWarmup.getState()
    // Nothing known yet, or only an old answer: show the start from now until the server says otherwise.
    if (state === 'idle' || (state !== 'starting' && state !== 'loading' && Date.now() - checkedAt > READY_FRESH_MS)) {
      useFaceWarmup.setState({ state: 'starting', since: Date.now() })
    }
    useFaceWarmup.setState({ holding: true, heldAt: Date.now() })
    if (timer !== undefined) clearTimeout(timer)
    void poll()
  }
  let released = false
  return () => {
    if (released) return
    released = true
    holders -= 1
    if (holders > 0) return
    useFaceWarmup.setState({ holding: false })
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }
}

/**
 * Resolves true once the face server is up, false if it will not be (none can start, or this took
 * longer than `timeoutMs`, or `signal` aborted). Holds the server for as long as it waits.
 */
export function faceServerReady(timeoutMs = 150_000, signal?: AbortSignal): Promise<boolean> {
  const asked = Date.now()
  const release = holdFaces()
  return new Promise<boolean>((resolve) => {
    let stop = () => {}
    let settled = false
    const settle = (value: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      stop()
      release()
      resolve(value)
    }
    const deadline = setTimeout(() => settle(false), timeoutMs)
    // Whoever was waiting has gone: stop holding the server up for them.
    signal?.addEventListener('abort', () => settle(false), { once: true })
    // Only a fresh answer counts: a server that could not start earlier may be able to now.
    const check = ({ state, checkedAt }: FaceWarmup) => {
      if (state === 'ready' && asked - checkedAt < READY_FRESH_MS) settle(true)
      else if (state === 'unavailable' && checkedAt >= asked) settle(false)
    }
    stop = useFaceWarmup.subscribe(check)
    check(useFaceWarmup.getState())
  })
}

/** 0..1 through a start, never quite 1 until it is actually up. */
export function warmProgress({ state, since, expectedS }: FaceWarmup, now: number): number {
  if (state === 'ready') return 1
  if (state !== 'starting' && state !== 'loading') return 0
  const elapsed = (now - since) / 1000
  // Linear to 90% over the expected time, then creeping, so an unusually slow start still moves.
  const linear = elapsed / Math.max(1, expectedS)
  return linear < 0.9 ? linear : Math.min(0.98, 0.9 + (1 - Math.exp(-(linear - 0.9) * 2)) * 0.08)
}

/** Whole seconds left, by the usual start time; 0 once it is late (then say "almost ready"). */
export function warmSecondsLeft({ since, expectedS }: FaceWarmup, now: number): number {
  return Math.max(0, Math.ceil(expectedS - (now - since) / 1000))
}
