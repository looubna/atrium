import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { RoundGuide } from '../../api'

const client = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(readonly status: number) {
      super(`status ${status}`)
    }
  }
  return { ApiError, api: vi.fn() }
})
vi.mock('@/platform/api/client', () => client)

const { getRoundGuide, writeRoundGuide } = await import('../../api')
const { GuideView, QuestionItem } = await import('../RoundGuide')

const guide: RoundGuide = {
  roundId: 'r01aaaaaaaa',
  approach: 'Lead with impact.',
  questions: [
    {
      question: 'Why do you want to join us?', reported: true, sources: ['glassdoor.com'], assesses: 'Motivation',
      outline: ['Their mission', 'Your fit'], sampleAnswer: 'At [company] I…', resumeHook: 'Payments platform',
      pitfalls: ['Talking about salary'],
    },
    {
      question: 'Tell me about a conflict.', reported: false, sources: [], assesses: 'Collaboration',
      outline: ['Situation'], sampleAnswer: '', resumeHook: '', pitfalls: [],
    },
  ],
  standOut: [{ title: 'Bring a plan', idea: 'A 30-60-90 plan', how: 'One page', why: 'Shows intent', effort: 'prep' }],
  questionsToAsk: [{ question: 'What does success look like?', why: 'Impact' }],
  hasResume: false,
}

describe('round guide', () => {
  it('asks the right place, and treats a missing guide as not written yet', async () => {
    client.api.mockRejectedValueOnce(new client.ApiError(404))
    expect(await getRoundGuide('app1', 'bp1', 'r01aaaaaaaa')).toBeNull()
    client.api.mockRejectedValueOnce(new client.ApiError(503))
    await expect(getRoundGuide('app1', 'bp1', 'r01aaaaaaaa')).rejects.toThrow()
    client.api.mockResolvedValueOnce(guide)
    await writeRoundGuide('app1', 'bp1', 'r01aaaaaaaa')
    expect(client.api).toHaveBeenLastCalledWith(
      '/interview/applications/app1/blueprints/bp1/rounds/r01aaaaaaaa/guide',
      { method: 'POST' },
    )
  })

  it('shows the approach, the questions with their evidence, and the tabs', () => {
    const html = renderToStaticMarkup(createElement(GuideView, { guide }))
    expect(html).toContain('Lead with impact.')
    expect(html).toContain('Questions <span class="text-faint">2</span>')
    expect(html).toContain('Stand out <span class="text-faint">1</span>')
    expect(html).toContain('Reported by candidates · glassdoor.com')
    expect(html).toContain('Likely')
    expect(html).toContain('Add your resume')
  })

  it('opens the first question with how to answer it', () => {
    const first = renderToStaticMarkup(createElement(QuestionItem, { item: guide.questions[0], index: 0 }))
    expect(first).toContain('How to answer')
    expect(first).toContain('Payments platform')
    expect(first).toContain('Show a sample answer')
    const second = renderToStaticMarkup(createElement(QuestionItem, { item: guide.questions[1], index: 1 }))
    expect(second).not.toContain('How to answer')
  })
})
