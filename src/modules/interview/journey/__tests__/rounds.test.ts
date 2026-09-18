import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSetup } from '@/data/practice'

const api = vi.hoisted(() => ({
  createInterviewSession: vi.fn(async () => ({ id: 'new-session', maxDurationMs: 0 })),
  getBlueprint: vi.fn(),
}))
vi.mock('../../api', () => api)

const { nextRound, roundMinutes, startRound } = await import('../rounds')

const round = (id: string, order: number, durationMin: number | null = 30) =>
  ({ id, order, title: `Round ${id}`, type: 'technical', durationMin }) as never

const previous: SessionSetup = {
  locationId: 'meridian',
  area: 'Interview',
  format: { id: 'interview', label: 'Interview', kind: 'interview', destination: 'meeting' } as never,
  minutes: 45,
  interview: {
    general: false,
    type: 'behavioral',
    mode: 'in-person',
    panel: 'panel',
    sessionId: 'old-session',
    applicationId: 'app1',
    blueprintId: 'bp1',
    roundId: 'r1',
    roundTitle: 'Round r1',
    roundType: 'behavioral',
    company: 'Acme',
    roleTitle: 'Engineer',
  },
}

describe('journey rounds', () => {
  beforeEach(() => {
    api.createInterviewSession.mockClear()
  })

  it('finds the next round by order, and none after the last', async () => {
    api.getBlueprint.mockResolvedValue({ rounds: [round('r3', 3), round('r1', 1), round('r2', 2)] })
    expect((await nextRound('app1', 'bp1', 'r1'))?.id).toBe('r2')
    expect((await nextRound('app1', 'bp1', 'r3'))).toBeNull()
    expect((await nextRound('app1', 'bp1', 'gone'))).toBeNull()
  })

  it('starts the next round with the same format and a fresh session', async () => {
    const next = await startRound(previous, round('r2', 2), 30)
    expect(api.createInterviewSession).toHaveBeenCalledWith({
      applicationId: 'app1',
      blueprintId: 'bp1',
      roundId: 'r2',
      mode: 'in_person',
      panel: 'panel',
      durationMinutes: 30,
    })
    expect(next.minutes).toBe(30)
    // In person stays in person: the next round is in the same meeting room.
    expect(next.format.destination).toBe('meeting')
    expect(next.interview).toMatchObject({ sessionId: 'new-session', roundId: 'r2', roundTitle: 'Round r2', company: 'Acme' })
  })

  it('repeats general practice without a journey', async () => {
    const general = { ...previous, interview: { ...previous.interview!, applicationId: undefined, roundId: undefined } }
    await startRound(general, null, 20)
    expect(api.createInterviewSession).toHaveBeenCalledWith(
      expect.objectContaining({ practice: 'general_behavioral', durationMinutes: 20 }),
    )
  })

  it('keeps round lengths inside what a session allows', () => {
    expect(roundMinutes({ durationMin: 240 })).toBe(60)
    expect(roundMinutes({ durationMin: 1 })).toBe(5)
    expect(roundMinutes({ durationMin: null })).toBe(15)
  })
})
