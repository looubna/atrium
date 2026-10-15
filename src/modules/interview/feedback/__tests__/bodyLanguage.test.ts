import { describe, expect, it } from 'vitest'
import type { BodyFinding } from '../../api'
import { compareMetrics, orderFindings } from '../bodyLanguage'

const finding = (id: string, startMs: number, confidence: BodyFinding['confidence'], confirmed = false): BodyFinding => ({
  id, check: 'sway', kind: 'heuristic', startMs, endMs: startMs + 12_000, observation: '', measurements: {}, confidence,
  exerciseId: 'anchor-your-stance', scenario: 'interview',
  ...(confirmed ? { review: { verdict: 'confirmed' as const, whatISee: 'x', howToFix: 'y' } } : {}),
})

describe('body-language feedback', () => {
  it('compares only what both sessions measured, and only what ever showed up', () => {
    const rows = compareMetrics(
      { swayPct: 20, tiltPct: 0, lookAwaySpeakingPct: 10, gestureSpeakingPct: 50 },
      { swayPct: 5, tiltPct: 0, lookAwaySpeakingPct: 14, gestureSpeakingPct: 10 },
    )
    expect(rows.map((r) => [r.key, r.improved])).toEqual([
      ['lookAwaySpeakingPct', false],
      ['swayPct', true],
    ])
  })

  it('leaves out a check the other session could not measure', () => {
    expect(compareMetrics({ swayPct: 20 }, { tiltPct: 4 })).toEqual([])
  })

  it('shows what the AI confirmed first, then the surest measurements', () => {
    const order = orderFindings([finding('a', 0, 'low'), finding('b', 5, 'high'), finding('c', 9, 'medium', true)])
    expect(order.map((f) => f.id)).toEqual(['c', 'b', 'a'])
  })
})
