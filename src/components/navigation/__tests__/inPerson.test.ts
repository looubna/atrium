import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSetup } from '@/data/practice'

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
  }),
}))
vi.mock('@/lib/useCamera', () => ({ useCamera: () => ({ stream: null, error: null }) }))

const { useAppStore } = await import('@/state/useAppStore')
const { InPersonRoom, inPersonHere } = await import('../InPersonInterview')

const session = (panel: 'panel' | 'one-to-one'): SessionSetup => ({
  locationId: 'company',
  area: 'Interview',
  format: { id: 'job-interview', label: 'Job interview', note: '', kind: 'interview', destination: 'meeting' },
  minutes: 30,
  interview: {
    general: false,
    type: 'behavioral',
    mode: 'in-person',
    panel,
    sessionId: 'session-1',
    roundType: 'case',
    roundTitle: 'Consulting Case',
    company: 'Northbridge',
  },
})

const html = () => {
  const here = inPersonHere(useAppStore.getState())
  return here ? renderToStaticMarkup(createElement(InPersonRoom, here)) : ''
}

describe('in-person interview', () => {
  beforeEach(() => {
    liveState.phase = 'idle'
    useAppStore.setState({ view: 'interior', selectedId: 'company', interiorZone: 'door', session: session('panel') })
  })

  it('starts at the firm\'s front door, with a pass to tap and nothing that looks like a call', () => {
    const out = html()
    expect(out).toContain('Tap your pass to go in')
    expect(out).toContain('/video/inperson/arrival/landscape/door.jpg')
    for (const control of ['Speaker', 'Headphones', 'Check in', 'Join interview', 'Share screen', 'Mute']) {
      expect(out).not.toContain(control)
    }
  })

  it('sends you through at reception: there is no face to wait for', () => {
    useAppStore.setState({ interiorZone: 'reception' })
    liveState.phase = 'connecting'
    const out = html()
    expect(out).toContain('Cara is here. Follow them to the meeting room.')
    expect(out).toContain('aria-label="Leave"')
  })

  it('seats a panel in the meeting room with only a way out', () => {
    useAppStore.setState({ interiorZone: 'meeting' })
    liveState.phase = 'live'
    liveState.timeLeftMs = 90_000
    const out = html()
    expect(out).toContain('aria-label="Meeting room"')
    expect(out).toContain('/video/inperson/room/panel/landscape.jpg')
    expect(out).toContain('aria-label="Leave the interview"')
    for (const control of ['Speaker', 'End interview', 'Presence coach', 'Time left', 'Interrupt', 'Share screen', 'Mute']) {
      expect(out).not.toContain(control)
    }
  })

  it('offers to begin the next round when already seated', () => {
    useAppStore.setState({ interiorZone: 'meeting', session: session('one-to-one') })
    expect(html()).toContain('Begin with Cara')
  })

  it('shows nothing for online interviews or elsewhere in the building', () => {
    useAppStore.setState({ session: { ...session('one-to-one'), interview: { ...session('one-to-one').interview!, mode: 'online' } } })
    expect(html()).toBe('')
    useAppStore.setState({ session: session('one-to-one'), interiorZone: 'entrance' })
    expect(html()).toBe('')
  })

  it('goes straight from the pass to reception for a live in-person interview', () => {
    useAppStore.setState({ interiorZone: 'door', passScanned: false, session: session('one-to-one') })
    useAppStore.getState().scanPass()
    expect(useAppStore.getState().interiorZone).toBe('reception')
    vi.useFakeTimers()
    useAppStore.getState().takeSeat()
    vi.runAllTimers()
    expect(useAppStore.getState().interiorZone).toBe('meeting')
    vi.useRealTimers()
  })
})
