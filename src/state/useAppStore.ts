import { create } from 'zustand'
import { AUDIENCE_ATTENDEE_IDS, MEETING_ATTENDEE_IDS } from '@/data/meeting'
import { LOCATIONS_BY_ID } from '@/data/locations'
import type { PracticeFormat, SessionSetup } from '@/data/practice'
import { releaseDeck, type Deck } from '@/lib/loadDeck'

/**
 * `entering` / `exiting` are transient: the camera is mid-move and user input
 * is locked. Everything else is a resting state.
 *
 *   city ⇄ location → entering → interior → exiting → location
 */
export type View =
  | 'city'
  | 'location'
  | 'entering'
  | 'interior'
  | 'exiting'
  | 'call'
  | 'drill'
  | 'talk'
  | 'exam'
  | 'debate'
  | 'admission'
  | 'language'
  | 'feedback'

/**
 * Named camera stations inside an interior. `door` is the arrival station
 * outside the front doors; the building opens once the pass is scanned.
 */
export type InteriorZone = 'door' | 'entrance' | 'reception' | 'meeting' | 'office' | 'theater'

/** Transition choreography, in ms. Tuned to feel cinematic but never slow. */
export const T = {
  cityToLocation: 1250,
  locationToCity: 1150,
  approach: 1150,
  veilIn: 420,
  /** When during the approach the screen starts to dim. */
  veilStart: 760,
  /** When the interior is swapped in behind the veil. */
  swap: 1200,
  exitVeil: 380,
  /** From a scanned pass to walking in — long enough to watch the doors part. */
  doorOpen: 1500,
} as const

interface AppState {
  view: View
  selectedId: string | null
  hoveredId: string | null
  /** 0 = clear, 1 = fully covered. Masks the city→interior scene swap. */
  veil: number
  interiorZone: InteriorZone
  visited: string[]
  /** Bumped to force the camera rig to replay its move to the current pose. */
  poseNonce: number
  /** True once the pass has been scanned at the front doors. */
  passScanned: boolean
  /** The practice session set up in the location panel, if any. */
  session: SessionSetup | null
  /** Audience members (by seat id) with a hand up, oldest first. */
  raisedHands: number[]
  /** Seat ids of everyone in the audience who can raise a hand. */
  /** The lectern microphone: closed, listening, or hearing the presenter. */
  micState: 'off' | 'on' | 'speaking'
  /** A full-screen view (the meeting-room footage) hides the 3D scene, so it stops rendering. */
  sceneCovered: boolean
  /** The presenter's shared screen, shown on the lectern laptop in the room footage. */
  screenStream: MediaStream | null
  /** Slides the presenter uploaded, and the one on screen. */
  deck: Deck | null
  slideIndex: number
  /** The current slide opened large, for reading. */
  slideZoom: boolean
  /** The account sheet (sign-in, privacy choices, usage) is open. */
  accountOpen: boolean
  /** The practice session whose feedback is on screen. */
  feedbackSessionId: string | null
  /** Reopen this interview journey's rounds in the location panel, without researching again. */
  journeyRequest: JourneyRequest | null

  hover: (id: string | null) => void
  select: (id: string) => void
  deselect: () => void
  enter: () => void
  leaveInterior: () => void
  goToCity: () => void
  setInteriorZone: (zone: InteriorZone) => void
  interiorReady: () => void
  scanPass: () => void
  setSession: (session: SessionSetup | null) => void
  leaveCall: () => void
  /** In-person interview: from reception to the meeting room, where the interviewers are waiting. */
  takeSeat: () => void
  /** Back from a screen that opens without an interior (a drill, the park bench, an exam). */
  leaveDrill: () => void
  /** A question from the room: one more visible audience member raises a hand. */
  raiseRandomHand: () => void
  /** The longest-waiting question has been answered. */
  lowerOldestHand: () => void
  lowerHands: () => void
  setMicState: (state: 'off' | 'on' | 'speaking') => void
  setSceneCovered: (covered: boolean) => void
  setScreenStream: (stream: MediaStream | null) => void
  setDeck: (deck: Deck | null) => void
  goSlide: (delta: number) => void
  setSlideZoom: (open: boolean) => void
  setAccountOpen: (open: boolean) => void
  openFeedback: (sessionId: string) => void
  closeFeedback: () => void
  /** Back from a call to the journey's list of rounds. */
  openJourney: (request: JourneyRequest) => void
  clearJourneyRequest: () => void
}

export interface JourneyRequest {
  locationId: string
  area: string
  format: PracticeFormat
  applicationId: string
  blueprintId: string
  company: string
  roleTitle: string
}

/** A live interview the candidate attends in person, at the company. */
export function isLiveInPerson(session: SessionSetup | null | undefined): boolean {
  return Boolean(session?.interview?.sessionId && session.interview.mode === 'in-person')
}

/** More hands than this reads as a vote, not questions. */
const MAX_HANDS = 3

/** Views that are a screen of their own, entered from the location panel without going indoors. */
const OWN_SCREEN_VIEWS: View[] = ['drill', 'talk', 'exam', 'debate', 'admission', 'language']

/** True when this session opens its own screen rather than a building. */
export const opensOwnScreen = (session: SessionSetup | null | undefined): boolean =>
  session?.format.destination === 'drill' ||
  session?.format.destination === 'talk' ||
  session?.format.destination === 'exam' ||
  session?.format.destination === 'debate' ||
  // The scholarship call, once the preparation has a session to join.
  (session?.format.destination === 'admission' && Boolean(session.admission?.sessionId))

/** Single timer slot: a second transition always cancels the first. */
let timers: ReturnType<typeof setTimeout>[] = []
const clearTimers = () => {
  timers.forEach(clearTimeout)
  timers = []
}
const after = (ms: number, fn: () => void) => {
  timers.push(setTimeout(fn, ms))
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'city',
  selectedId: null,
  hoveredId: null,
  veil: 0,
  interiorZone: 'entrance',
  visited: [],
  poseNonce: 0,
  passScanned: false,
  session: null,
  raisedHands: [],
  micState: 'off',
  sceneCovered: false,
  screenStream: null,
  deck: null,
  slideIndex: 0,
  slideZoom: false,
  accountOpen: false,
  feedbackSessionId: null,
  journeyRequest: null,

  hover: (id) => {
    // Hover is meaningless while the camera is flying or we are indoors.
    const { view, hoveredId } = get()
    if (view !== 'city' && view !== 'location') return
    if (hoveredId === id) return
    set({ hoveredId: id })
  },

  select: (id) => {
    const { view, selectedId } = get()
    if (view === 'entering' || view === 'exiting' || view === 'interior') return
    if (selectedId === id && view === 'location') return
    if (!LOCATIONS_BY_ID.has(id)) return

    clearTimers()
    set((s) => ({
      selectedId: id,
      view: 'location',
      hoveredId: null,
      poseNonce: s.poseNonce + 1,
    }))
  },

  deselect: () => {
    const { view } = get()
    if (view !== 'location' && view !== 'city') return
    clearTimers()
    set((s) => ({ selectedId: null, view: 'city', hoveredId: null, poseNonce: s.poseNonce + 1 }))
  },

  goToCity: () => {
    clearTimers()
    const { view } = get()

    if (view === 'interior') {
      // Fade out of the interior, then rebuild the city with nothing selected.
      set({ view: 'exiting', veil: 1 })
      after(T.exitVeil, () =>
        set((s) => ({ view: 'city', selectedId: null, poseNonce: s.poseNonce + 1 })),
      )
      after(T.exitVeil + 120, () => set({ veil: 0 }))
      return
    }

    set((s) => ({ view: 'city', selectedId: null, hoveredId: null, poseNonce: s.poseNonce + 1 }))
  },

  enter: () => {
    const { view, selectedId, session } = get()
    if (view !== 'location' || !selectedId) return
    const loc = LOCATIONS_BY_ID.get(selectedId)
    if (!loc) return
    const mine = session?.locationId === loc.id ? session : null

    // The Language Center is a screen of its own, whatever was set up elsewhere.
    if (loc.opens === 'language') {
      clearTimers()
      set((s) => ({
        view: 'language',
        hoveredId: null,
        visited: s.visited.includes(loc.id) ? s.visited : [...s.visited, loc.id],
      }))
      return
    }

    // A drill needs no building: straight to the practice screen, even where there is no interior.
    if (mine?.format.destination === 'drill') {
      clearTimers()
      set({ view: 'drill', hoveredId: null })
      return
    }
    // Likewise the park conversation and the oral exam: each has its own screen.
    if (mine?.format.destination === 'talk') {
      clearTimers()
      set({ view: 'talk', hoveredId: null })
      return
    }
    if (mine?.format.destination === 'exam') {
      clearTimers()
      set({ view: 'exam', hoveredId: null })
      return
    }
    // And the debate: a room with the opponent across the table from you.
    if (mine?.format.destination === 'debate') {
      clearTimers()
      set({ view: 'debate', hoveredId: null })
      return
    }
    // And the scholarship interview: a video call with the committee's professor. Nothing to
    // join until the preparation has made a session.
    if (mine?.format.destination === 'admission') {
      if (!mine.admission?.sessionId) return
      clearTimers()
      set({ view: 'admission', hoveredId: null })
      return
    }
    if (!loc.hasInterior) return

    clearTimers()

    // A virtual session skips the building: straight into the call.
    if (mine?.format.destination === 'call') {
      set({ view: 'call', hoveredId: null })
      return
    }

    set((s) => ({ view: 'entering', hoveredId: null, poseNonce: s.poseNonce + 1 }))

    after(T.veilStart, () => set({ veil: 1 }))
    after(T.swap, () =>
      set((s) => ({
        view: 'interior',
        // Arrive outside the front doors, where the pass opens the building — or, in a
        // photo-only interior, straight in the room.
        interiorZone: loc.arrival ?? 'door',
        passScanned: Boolean(loc.arrival),
        raisedHands: [],
        visited: s.visited.includes(loc.id) ? s.visited : [...s.visited, loc.id],
      })),
    )
    // `veil` is cleared by `interiorReady`, not a timer — the interior chunk
    // may still be loading and we must not reveal a half-built room.
  },

  interiorReady: () => {
    if (get().view !== 'interior') return
    set({ veil: 0 })
  },

  leaveInterior: () => {
    const { view } = get()
    if (view !== 'interior') return

    clearTimers()
    set({ view: 'exiting', veil: 1 })
    after(T.exitVeil, () => set((s) => ({ view: 'location', poseNonce: s.poseNonce + 1 })))
    after(T.exitVeil + 120, () => set({ veil: 0 }))
  },

  setInteriorZone: (zone) => {
    const { interiorZone, passScanned } = get()
    // Nothing past the doors until the pass is scanned.
    if (interiorZone === 'door' && !passScanned) return
    set({ interiorZone: zone })
  },

  scanPass: () => {
    const { view, interiorZone, passScanned, session, selectedId } = get()
    if (view !== 'interior' || interiorZone !== 'door' || passScanned) return
    set({ passScanned: true })

    // Walk straight to the room the session is set in; the lobby otherwise. A live in-person
    // interview checks in at reception first.
    const mine = session?.locationId === selectedId ? session : null
    const destination = mine?.format.destination
    const zone: InteriorZone = isLiveInPerson(mine)
      ? 'reception'
      : destination === 'meeting'
        ? 'meeting'
        : destination === 'theater'
          ? 'theater'
          : 'entrance'

    if (zone === 'reception') {
      // The in-person screen plays the walk in itself, ending in the reception: no fade.
      set({ interiorZone: zone, raisedHands: [] })
      return
    }
    if (zone === 'theater' || zone === 'meeting') {
      // The walk to the auditorium or meeting room would pass through seating
      // and glass partitions: fade out at the doors and come up already in place.
      after(T.doorOpen, () => {
        if (get().view === 'interior') set({ veil: 1 })
      })
      after(T.doorOpen + T.veilIn, () => {
        if (get().view === 'interior') set({ interiorZone: zone, raisedHands: [] })
      })
      after(T.doorOpen + T.veilIn + 250, () => set({ veil: 0 }))
      return
    }
    after(T.doorOpen, () => {
      if (get().view === 'interior') set({ interiorZone: zone })
    })
  },

  takeSeat: () => {
    const { view, interiorZone } = get()
    if (view !== 'interior' || interiorZone === 'meeting') return
    // Like arriving in any room: fade out, come up already seated.
    set({ veil: 1 })
    after(T.veilIn, () => {
      if (get().view === 'interior') set({ interiorZone: 'meeting', raisedHands: [] })
    })
    after(T.veilIn + 250, () => set({ veil: 0 }))
  },

  setSession: (session) => set({ session }),

  raiseRandomHand: () =>
    set((s) => {
      if (s.raisedHands.length >= MAX_HANDS) return {}
      // In the meeting room the question comes from someone at the table; anywhere else it
      // comes from the audience.
      const pool: readonly number[] =
        s.interiorZone === 'meeting' ? MEETING_ATTENDEE_IDS : AUDIENCE_ATTENDEE_IDS
      const free = pool.filter((id) => !s.raisedHands.includes(id))
      if (free.length === 0) return {}
      return { raisedHands: [...s.raisedHands, free[Math.floor(Math.random() * free.length)]] }
    }),

  lowerOldestHand: () => set((s) => ({ raisedHands: s.raisedHands.slice(1) })),

  lowerHands: () => set({ raisedHands: [] }),

  setMicState: (micState) => {
    if (get().micState !== micState) set({ micState })
  },

  setDeck: (deck) => {
    const old = get().deck
    if (old && old !== deck) releaseDeck(old)
    set({ deck, slideIndex: 0, slideZoom: deck ? get().slideZoom : false })
  },

  setSlideZoom: (slideZoom) => {
    if (get().slideZoom !== slideZoom) set({ slideZoom })
  },

  goSlide: (delta) =>
    set((s) => (s.deck ? { slideIndex: Math.max(0, Math.min(s.deck.slides.length - 1, s.slideIndex + delta)) } : {})),

  setScreenStream: (screenStream) => {
    if (get().screenStream !== screenStream) set({ screenStream })
  },

  setAccountOpen: (accountOpen) => {
    if (get().accountOpen !== accountOpen) set({ accountOpen })
  },

  openFeedback: (feedbackSessionId) => {
    clearTimers()
    set({ view: 'feedback', feedbackSessionId, hoveredId: null })
  },

  closeFeedback: () => {
    if (get().view !== 'feedback') return
    set((s) => ({
      // Feedback opened from the Language Center goes back to it.
      view: !s.selectedId ? 'city' : LOCATIONS_BY_ID.get(s.selectedId)?.opens === 'language' ? 'language' : 'location',
      feedbackSessionId: null,
      poseNonce: s.poseNonce + 1,
    }))
  },

  setSceneCovered: (sceneCovered) => {
    if (get().sceneCovered !== sceneCovered) set({ sceneCovered })
  },

  leaveCall: () => {
    if (get().view !== 'call') return
    set((s) => ({ view: 'location', poseNonce: s.poseNonce + 1 }))
  },

  openJourney: (journeyRequest) => {
    clearTimers()
    set((s) => ({
      journeyRequest,
      view: 'location',
      selectedId: journeyRequest.locationId,
      feedbackSessionId: null,
      poseNonce: s.poseNonce + 1,
    }))
  },

  clearJourneyRequest: () => {
    if (get().journeyRequest) set({ journeyRequest: null })
  },

  leaveDrill: () => {
    // Also closes the park conversation, the oral exam and the debate: the other screens
    // with no interior of their own.
    if (!OWN_SCREEN_VIEWS.includes(get().view)) return
    set((s) => ({ view: 'location', poseNonce: s.poseNonce + 1 }))
  },
}))

// Development only: lets browser tests drive the same store instance the app
// uses (a dynamic import can resolve to a separately versioned module copy).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __atriumStore?: typeof useAppStore }).__atriumStore = useAppStore
}

/** True while the camera is under script control and pointers should be inert. */
export const isTransitioning = (view: View) => view === 'entering' || view === 'exiting'
