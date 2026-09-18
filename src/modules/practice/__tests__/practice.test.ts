import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PracticeProgress, RoundResult } from '../api'

const calls = vi.hoisted(() => [] as { path: string; body: unknown }[])
vi.mock('@/platform/api/client', () => ({
  ApiError: class ApiError extends Error {},
  api: vi.fn(async (path: string, options?: { body?: unknown }) => {
    calls.push({ path, body: options?.body })
    return {}
  }),
}))

const { formatMetric, localDay, submitPracticeRound } = await import('../api')
const { RoundFeedback } = await import('@/components/practice/RoundFeedback')

const progress: PracticeProgress = {
  xp: 130, level: 2, levelXp: 30, levelSpan: 200,
  streak: { current: 3, best: 3, practicedToday: true },
  today: { drillId: 'pace-control', title: 'Pace Control', level: 1, label: 'Read at 130-160 wpm', done: false },
  achievements: [], skills: [],
  drills: {
    'think-on-your-feet': {
      title: 'Think on Your Feet', skills: [], rounds: 2, level: 2, mastered: false,
      challenge: { level: 2, label: 'Start within 10 s', repeat: 2, passes: 1 },
      challenges: [
        { level: 1, label: 'Start within 15 s', repeat: 1, done: true },
        { level: 2, label: 'Start within 10 s', repeat: 2, done: false },
        { level: 3, label: 'Start within 7 s', repeat: 3, done: false },
      ],
      bests: [],
    },
  },
}

function result(overrides: Partial<RoundResult> = {}): RoundResult {
  return {
    attemptId: 'a1',
    drillId: 'think-on-your-feet',
    minSpeechSeconds: 10,
    transcript: 'I think a good leader listens first',
    timeline: [
      { w: 'Um', s: 500, e: 700, f: true },
      { w: 'I', s: 900, e: 1000, f: false },
      { w: 'think', s: 3200, e: 3500, f: false },
    ],
    speechMs: 3000,
    metrics: [
      { key: 'responseSeconds', label: 'Time to first word', unit: 's', better: 'lower', source: 'measured', scale: [0, 10], goal: 2, band: null, value: 4.6, best: 6, isBestMetric: true, newBest: true },
      { key: 'fillers', label: 'Filler words', unit: '', better: 'lower', source: 'measured', scale: [0, 10], goal: 2, band: null, value: 1, best: 0, isBestMetric: true, newBest: false },
      { key: 'structure', label: 'Structure', unit: '/5', better: 'higher', source: 'ai', scale: [0, 10], goal: 2, band: null, value: 4, best: null, isBestMetric: true, newBest: false },
      { key: 'wpm', label: 'Speaking rate', unit: 'wpm', better: 'higher', source: 'measured', scale: [0, 10], goal: 2, band: null, value: null, best: null, isBestMetric: false, newBest: false },
    ],
    feedback: {
      headline: 'A direct start.',
      strengths: [{ point: 'You led with your answer.', quote: 'a good leader listens first' }],
      improvements: [{ point: 'Add one example.', quote: '' }],
      nextTry: 'Give one example.',
    },
    awards: {
      counted: true, xp: 40, xpParts: [{ reason: 'Round completed', xp: 10 }, { reason: 'Level 1 challenge', xp: 20 }, { reason: 'New personal best', xp: 10 }],
      newBests: [{ key: 'responseSeconds', label: 'Time to first word', value: 4.6, previous: 6 }], firstResults: [],
      challenge: { level: 1, label: 'Start within 15 s', passed: true, repeat: 1, passes: 1, completed: true, unlocked: 2 }, todayDone: false, streakExtended: true,
      achievements: [{ id: 'quick-thinker', title: 'Quick Thinker', description: 'Pass three challenges' }],
    },
    progress,
    ...overrides,
  }
}

describe('practice helpers', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('formats values with their units and leaves missing ones blank', () => {
    expect(formatMetric(4.6, 's')).toBe('4.6 s')
    expect(formatMetric(92, '%')).toBe('92%')
    expect(formatMetric(4, '/5')).toBe('4/5')
    expect(formatMetric(148, 'wpm')).toBe('148 wpm')
    expect(formatMetric(null, 's')).toBe('—')
  })

  it('uses the local calendar day', () => {
    expect(localDay(new Date(2026, 8, 7, 23, 30))).toBe('2026-09-07')
  })

  it('sends the recording and round details as a form', async () => {
    const recording = new Blob([new Uint8Array(3000)], { type: 'audio/mp4' })
    await submitPracticeRound({ drillId: 'pause-dont-fill', recording, prompt: { kind: 'fillers' }, prepUsedMs: 1234.4, speakSeconds: 60, eyeContactPct: null })
    const form = calls[0].body as FormData
    expect(calls[0].path).toBe('/practice/rounds')
    expect(form.get('drillId')).toBe('pause-dont-fill')
    expect((form.get('audio') as File).name).toBe('round.m4a')
    expect(form.get('prepUsedMs')).toBe('1234')
    expect(form.get('eyeContactPct')).toBeNull()
    expect(JSON.parse(String(form.get('prompt')))).toEqual({ kind: 'fillers' })
  })
})

describe('RoundFeedback', () => {
  const html = (r: RoundResult) => renderToStaticMarkup(createElement(RoundFeedback, { result: r }))

  it('shows measured results, personal bests, AI labels, quotes and the challenge', () => {
    const out = html(result())
    expect(out).toContain('NEW PERSONAL BEST')
    expect(out).toContain('was 6 s')
    expect(out).toContain('Best 0') // fillers: not beaten this time
    expect(out).toContain('>AI<')
    expect(out).toContain('an assessment, not a measurement')
    expect(out).toContain('“a good leader listens first”')
    expect(out).toContain('Level 1 complete')
    expect(out).toContain('Level 2 is next')
    expect(out).toContain('1 of 2 rounds in a row')
    expect(out).toContain('3-day streak')
    expect(out).toContain('1 new personal best')
    expect(out).toContain('Quick Thinker')
    expect(out).toContain('+40 XP')
    expect(out).toContain('Level 2') // the XP bar
    // The timeline marks the filler, and the challenge ladder shows every level.
    expect(out).toContain('fillers · 1')
    expect(out).toContain('Filler: “Um”')
    expect(out).toContain('Start within 7 s')
    expect(out).toContain('Your next try')
    expect(out).not.toContain('Speaking rate') // no value, not shown
  })

  it('explains a round too short to count, and works without coaching', () => {
    const out = html(result({
      feedback: null,
      awards: { ...result().awards, counted: false, xp: 0, challenge: null, achievements: [] },
    }))
    expect(out).toContain('too short to count')
    expect(out).toContain('at least 10 seconds')
    expect(out).toContain('Coaching notes aren’t available')
    expect(out).not.toContain('XP')
  })
})
