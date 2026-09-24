import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSetup } from '@/data/practice'
import { effectiveStyle, shouldAskStyle, type Analysis, type Course } from '../api'

vi.stubGlobal('window', {
  innerWidth: 1400,
  innerHeight: 800,
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout,
  clearTimeout,
})

const liveState = vi.hoisted(() => ({
  phase: 'idle',
  interviewerSpeaking: false,
  panelSpeaker: null as string | null,
  micLevel: 0,
  captions: [],
  timeLeftMs: null as number | null,
  coding: false,
  boardProblem: null as string | null,
  headphones: false,
  muted: false,
}))
vi.mock('@/modules/interview/live/useLiveInterview', () => ({
  useLiveInterview: () => ({
    state: liveState,
    start: vi.fn(),
    end: vi.fn(),
    interrupt: vi.fn(),
    setHeadphones: vi.fn(),
    setMuted: vi.fn(),
    mediaMs: () => 0,
    sendCodeSnapshot: vi.fn(),
    sendBoardImage: vi.fn(),
  }),
}))
vi.mock('@/platform/avatar/useAvatar', () => ({ useAvatar: () => ({ avatar: null, unavailable: false }) }))
vi.mock('@/lib/useCamera', () => ({ useCamera: () => ({ stream: null, error: null }) }))

// The setup screen talks to the API and to Firestore listeners; neither exists in a test.
const materials = vi.hoisted(() => ({ items: [] as unknown[] }))
vi.mock('@/platform/firestore/live', () => ({
  useLiveCollection: () => materials.items,
  useLiveDocument: () => null,
}))
vi.mock('@/platform/firebase', () => ({
  firebase: () => ({ auth: { currentUser: { uid: 'u1' } } }),
  firebaseConfigured: () => true,
  NotSignedIn: class NotSignedIn extends Error {},
}))
vi.mock('@/modules/exam/api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  listCourses: () => Promise.resolve([]),
  listMaterials: () => Promise.resolve([]),
}))

const { useAppStore } = await import('@/state/useAppStore')
const { ExamRoom, examHere } = await import('@/components/navigation/OralExam')
const { analysisFailure } = await import('../setup/ExamSetup')
const { ExamSetupForm } = await import('../setup/ExamSetup')

const session = (style: 'oral_questions' | 'board_work', camera = false): SessionSetup => ({
  locationId: 'university',
  area: 'Oral Exam',
  format: { id: 'oral-exam', label: 'Oral exam', note: '', kind: 'exam', destination: 'exam' },
  minutes: 20,
  exam: { subject: 'Fluid Mechanics', style, sessionId: 'exam-1', camera, courseId: 'c1', analysisId: 'a1' },
})

const room = () => {
  const here = examHere(useAppStore.getState())
  return here ? renderToStaticMarkup(createElement(ExamRoom, here)) : ''
}

const setup = () =>
  renderToStaticMarkup(
    createElement(ExamSetupForm, {
      location: { id: 'university' } as never,
      area: 'Oral Exam',
      format: { id: 'oral-exam', label: 'Oral exam', note: '', kind: 'exam' as const, destination: 'exam' as const },
      onBack: () => {},
      onDone: () => {},
    }),
  )

/** Only what the student actually reads: class names contain words like "duration". */
const visibleText = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase()

const analysis = (over: Partial<Analysis> = {}): Analysis => ({
  id: 'a1',
  status: 'ready',
  examStyle: 'oral_questions',
  examStyleConfidence: 'high',
  ...over,
})

const course = (over: Partial<Course> = {}): Course => ({
  id: 'c1',
  subject: 'Fluid Mechanics',
  status: 'ready',
  activeAnalysisId: 'a1',
  materialCount: 3,
  chosenStyle: null,
  ...over,
})

describe('the first screen asks for as little as possible', () => {
  it('asks what you are preparing for, and for materials — and nothing else', () => {
    const out = setup()
    expect(out).toContain('Prepare for your oral exam')
    expect(out).toContain('What are you preparing for?')
    expect(out).toContain('Add your study materials')
    expect(out).toContain('+ Add materials')
    expect(out).toContain('Fluid Mechanics') // the example in the input's placeholder
  })

  it('never asks for the date, the difficulty, the number of questions or a schedule', () => {
    const out = visibleText(setup())
    for (const asked of [
      'exam date',
      'when is',
      'difficulty',
      'number of questions',
      'question type',
      "bloom's",
      'weighting',
      'follow-up depth',
      'study schedule',
      'duration',
    ]) {
      expect(out, asked).not.toContain(asked)
    }
  })

  it('keeps the way forward out of the scrolling area, and never disables it', () => {
    const out = setup()
    // The panel is short on a laptop in landscape: an action inside the scroll box can sit
    // below the fold, which reads as "I can't add anything".
    const scrollBox = out.indexOf('overflow-y-auto')
    const action = out.indexOf('+ Add materials')
    expect(scrollBox).toBeGreaterThan(-1)
    expect(action).toBeGreaterThan(scrollBox)
    expect(out.slice(scrollBox, action)).toContain('</div>')
    // With no subject yet it still invites the tap, and answers with where to type.
    expect(out).not.toContain('disabled=""')
  })

  it('never asks the student to say what a file is', () => {
    const out = setup()
    // The labels exist for showing what was detected, never as a choice to make.
    expect(out).not.toContain('What kind of file')
    expect(out).not.toContain('Select type')
  })
})

describe('asking how the exam runs', () => {
  it('is skipped when the material settled it', () => {
    expect(shouldAskStyle(analysis(), course())).toBe(false)
    expect(effectiveStyle(analysis(), course())).toBe('oral_questions')
  })

  it('is asked when the material never said', () => {
    expect(shouldAskStyle(analysis({ examStyle: 'unknown', examStyleConfidence: 'low' }), course())).toBe(true)
  })

  it('is asked when the guess is weak, however it was reached', () => {
    expect(shouldAskStyle(analysis({ examStyle: 'board_work', examStyleConfidence: 'low' }), course())).toBe(true)
  })

  it('is never asked twice: the student\'s own answer settles it for good', () => {
    const answered = course({ chosenStyle: 'board_work' })
    expect(shouldAskStyle(analysis({ examStyle: 'unknown', examStyleConfidence: 'low' }), answered)).toBe(false)
    // And their answer wins over what the material suggested.
    expect(effectiveStyle(analysis(), answered)).toBe('board_work')
  })

  it('is not asked while the material is still being read', () => {
    expect(shouldAskStyle(analysis({ status: 'analyzing' }), course())).toBe(false)
    expect(shouldAskStyle(null, course())).toBe(false)
  })
})

describe('when the analysis stops', () => {
  it('blames the material only when the material is at fault', () => {
    expect(analysisFailure('no_readable_material')).toContain("couldn't read any of that")
  })

  it("says so plainly when it was the model that didn't answer", () => {
    // The server stores the exception's name; every one of these means the student's files were fine.
    for (const reason of ['ClientError', 'AiUnavailable', 'ModelBusy', 'StructuredOutputError', undefined]) {
      const text = analysisFailure(reason)
      expect(text, reason).toContain("AI service didn't answer")
      expect(text, reason).toContain('saved')
      expect(text, reason).not.toContain('read any of that')
    }
  })
})

describe('the exam room', () => {
  beforeEach(() => {
    liveState.phase = 'idle'
    materials.items = []
    useAppStore.setState({ view: 'exam', selectedId: 'university', session: session('oral_questions') })
  })

  it('seats you across the desk from the professor, with one way in and one way out', () => {
    const out = room()
    expect(out).toContain('aria-label="Oral exam"')
    // The professor is already at the desk: never an empty chair while the face connects.
    expect(out).toContain('/faces/william.jpg')
    expect(out).not.toContain('/video/inperson/room/one/landscape.jpg')
    expect(out).toContain('Begin with Okonjo')
    expect(out).toContain('aria-label="Leave"')
    // Every exam has the board beside the desk, for questions that need working.
    expect(out).toContain('aria-label="Your board"')
    expect(out).toContain('it goes up on the board')
  })

  it('splits the screen with a board when the exam is worked at one', () => {
    useAppStore.setState({ session: session('board_work') })
    const out = room()
    expect(out).toContain('BOARD')
    expect(out).toContain('aria-label="Your board"')
    expect(out).toContain('Begin with Sartori')
    // A board exam is written, so the pen is there and it is the tool in hand.
    expect(out).toContain('aria-label="Write on the board"')
    expect(out).toContain('aria-label="Write with the pen"')
    expect(out).toContain('aria-label="Erase"')
    expect(out).toContain('aria-label="Undo the last stroke"')
    expect(out).toContain('aria-label="Type"')
    // Once the exam is running, the board says the examiner is reading it.
    liveState.phase = 'live'
    expect(room()).toContain('The examiner can see your board')
  })

  it('pins the problem the examiner wrote above the working area', () => {
    useAppStore.setState({ session: session('board_work') })
    liveState.phase = 'live'
    liveState.boardProblem = 'A pipe narrows from 10 cm to 4 cm.\nWater flows at 2 m/s. Find the exit velocity.'
    const out = room()
    // Numbers said once are numbers lost: they have to be readable on the board.
    expect(out).toContain('THE PROBLEM')
    expect(out).toContain('narrows from 10 cm to 4 cm')
    expect(out).toContain('Find the exit velocity')
    liveState.boardProblem = null
    expect(room()).not.toContain('THE PROBLEM')
  })

  it('keeps the camera off unless it was asked for', () => {
    expect(room()).not.toContain('Turn the camera off')
    useAppStore.setState({ session: session('oral_questions', true) })
    expect(room()).toContain('Turn the camera off')
  })

  it('shows nothing until a session exists, or away from the exam view', () => {
    useAppStore.setState({ session: { ...session('oral_questions'), exam: { subject: 'x', style: 'unknown' } } })
    expect(room()).toBe('')
    useAppStore.setState({ view: 'city', session: session('oral_questions') })
    expect(room()).toBe('')
  })
})
