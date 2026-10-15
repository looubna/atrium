import { describe, expect, it } from 'vitest'
import { storySteps } from '@/components/practice/StoryCourseList'
import { DRILLS, STORY_COURSE, makePrompt } from '@/data/drills'
import { LOCATIONS } from '@/data/locations'
import { PRACTICE_FORMATS } from '@/data/practice'
import type { DrillProgress, PracticeProgress } from '@/modules/practice/api'

const step = (levelsDone: number, rounds = levelsDone ? 3 : 0): DrillProgress => ({
  title: '',
  skills: [],
  rounds,
  level: Math.min(3, levelsDone + 1),
  mastered: levelsDone === 3,
  challenge: { level: 1, label: '', repeat: 1, passes: 0 },
  challenges: [1, 2, 3].map((level) => ({ level, label: `L${level}`, repeat: level, done: level <= levelsDone })),
  bests: [],
})

const progress = (done: Record<string, number>, lastSeed: string | null = null): PracticeProgress =>
  ({
    drills: Object.fromEntries(STORY_COURSE.map((id) => [id, step(done[id] ?? 0)])),
    story: { lastSeed, lastScore: lastSeed ? 3 : null },
  }) as unknown as PracticeProgress

describe('the Story Course', () => {
  it('fills the Park’s Storytelling area with its steps, in order', () => {
    expect(LOCATIONS.find((l) => l.id === 'park')?.practiceAreas).toContain('Storytelling')
    expect(PRACTICE_FORMATS.Storytelling?.map((f) => f.id)).toEqual(STORY_COURSE)
    expect(PRACTICE_FORMATS.Storytelling?.every((f) => f.destination === 'drill')).toBe(true)
    for (const id of STORY_COURSE) {
      const drill = DRILLS[id]
      expect(drill.tips.length, id).toBe(3)
      expect(drill.why, id).toBeTruthy()
    }
  })

  it('opens every step (the order is a recommendation)', () => {
    const open = (p: PracticeProgress | null) => storySteps(p).filter((s) => s.open).map((s) => s.id)
    expect(open(progress({}))).toEqual(STORY_COURSE.filter((id) => id !== 'story-retell'))
    expect(open(null)).toEqual(STORY_COURSE)
    expect(storySteps(progress({ 'story-spine': 2 }))[0].stars).toBe(2)
  })

  it('opens Tell It Again only when there is a story to retell', () => {
    const upToDelivery = Object.fromEntries(STORY_COURSE.slice(0, 7).map((id) => [id, 1]))
    const retell = (p: PracticeProgress) => storySteps(p).find((s) => s.id === 'story-retell')?.open
    expect(retell(progress(upToDelivery))).toBe(false)
    expect(retell(progress(upToDelivery, 'The day everything changed'))).toBe(true)
  })

  it('asks for a new story each round, and a retelling of the same one', () => {
    const first = makePrompt('story-curiosity')
    expect(first.kind).toBe('story')
    const second = makePrompt('story-curiosity', first)
    expect(second.kind === 'story' && first.kind === 'story' && second.seed !== first.seed).toBe(true)
    const retell = makePrompt('story-retell')
    expect(retell.kind === 'story' && retell.retell).toBe(true)
  })
})
