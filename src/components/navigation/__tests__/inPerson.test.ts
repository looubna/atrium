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
  leadVoicing: false,
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
// Whether the face server is there today. The room is the same filmed scene either way.
const faces = vi.hoisted(() => ({ unavailable: true }))
vi.mock('@/platform/avatar/useAvatar', () => ({ useAvatar: () => ({ avatar: null, unavailable: faces.unavailable }) }))
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
    faces.unavailable = true
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

  it('waits at reception for the interviewer', () => {
    useAppStore.setState({ interiorZone: 'reception' })
    liveState.phase = 'connecting'
    const out = html()
    expect(out).toContain('Evelyn is on the way down')
    expect(out).toContain('aria-label="Leave"')
  })

  it('seats a panel in the meeting room with only a way out', () => {
    useAppStore.setState({ interiorZone: 'meeting' })
    liveState.phase = 'live'
    liveState.timeLeftMs = 90_000
    const out = html()
    expect(out).toContain('aria-label="Meeting room"')
    expect(out).toContain('/video/inperson/room/panel_face/base.jpg')
    expect(out).toContain('aria-label="Leave the interview"')
    for (const control of ['Speaker', 'End interview', 'Presence coach', 'Time left', 'Interrupt', 'Share screen', 'Mute']) {
      expect(out).not.toContain(control)
    }
  })

  it('shows the room the live face is made from, with or without a face today', () => {
    useAppStore.setState({ interiorZone: 'meeting' })
    liveState.phase = 'live'
    // No face server today: the same scene, never a different backup picture.
    expect(html()).toContain('/video/inperson/room/panel_face/base.mp4')
    expect(html()).not.toContain('/video/inperson/room/panel/')
    useAppStore.setState({ session: session('one-to-one') })
    expect(html()).toContain('/video/inperson/room/one_face/base.mp4')
    expect(html()).not.toContain('/video/inperson/room/one/')
    // With a face server, one to one, the interviewer is at her own desk: the clip her live face is
    // painted on; and the panel sits at its table, the clip their shared face is painted on.
    faces.unavailable = false
    expect(html()).toContain('/video/inperson/room/one_face/base.mp4')
    useAppStore.setState({ session: session('panel') })
    expect(html()).toContain('/video/inperson/room/panel_face/base.mp4')
  })

  it('keeps the same room whoever has the floor', () => {
    useAppStore.setState({ interiorZone: 'meeting' })
    liveState.phase = 'live'
    const videos = (out: string) => [...out.matchAll(/<video[^>]*src="([^"]+)"/g)].map(([, src]) => src)
    for (const [lead, colleague] of [[false, null], [true, null], [false, 'Daniel Brooks']] as const) {
      liveState.leadVoicing = lead
      liveState.panelSpeaker = colleague
      expect(videos(html())).toEqual(['/video/inperson/room/panel_face/base.mp4'])
    }
    liveState.leadVoicing = false
    liveState.panelSpeaker = null
  })

  it('draws nothing over the footage: no face is composited into a chair', () => {
    useAppStore.setState({ interiorZone: 'meeting' })
    liveState.phase = 'live'
    liveState.leadVoicing = true
    const out = html()
    // A masked video pinned to a head box is what a pasted-on person looks like in the markup.
    expect(out).not.toContain('mask-image')
    expect(out).not.toContain('maskImage')
    expect(out).not.toMatch(/<video[^>]*style="[^"]*clip-path/)
    liveState.leadVoicing = false
  })

  it('names whoever takes a turn, without leaving the table', () => {
    useAppStore.setState({ interiorZone: 'meeting' })
    liveState.phase = 'live'
    liveState.panelSpeaker = 'Grace Lin'
    // She asks nothing all interview, but the candidate still hears her say hello, so the room
    // still names her: a voice from the table with nobody's name on it is nobody.
    expect(html()).toContain('Senior Team Member')
    liveState.panelSpeaker = 'Daniel Brooks'
    const out = html()
    expect(out).toContain('Daniel Brooks')
    expect(out).toContain('Team Lead')
    // The room shot stays: nobody is cut to full screen, and nobody leaves the table.
    expect(out).toContain('/video/inperson/room/panel_face/base.mp4')
    liveState.panelSpeaker = null
    liveState.leadVoicing = true
    expect(html()).toContain('Evelyn Ross')
    liveState.leadVoicing = false
  })

  it('is led by the woman actually sitting in the room, whatever the round is', () => {
    useAppStore.setState({ interiorZone: 'meeting' })
    liveState.phase = 'live'
    liveState.leadVoicing = true
    // The session is a case round, which on a call would be Cara Lindqvist. The room is one
    // photograph, so the name under the frame has to belong to the woman in the chair.
    expect(html()).toContain('Evelyn Ross')
    expect(html()).not.toContain('Cara Lindqvist')
    liveState.leadVoicing = false
  })

  it('offers to begin the next round when already seated', () => {
    useAppStore.setState({ interiorZone: 'meeting', session: session('one-to-one') })
    expect(html()).toContain('Begin with Evelyn')
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
