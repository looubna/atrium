import { describe, expect, it } from 'vitest'
import { DRILLS, FRAMEWORKS } from '@/data/drills'
import { LOCATIONS } from '@/data/locations'
import { PRACTICE_FORMATS } from '@/data/practice'
import { practiceFor } from '../practiceLinks'

/** What each skill needs, and the drill that trains exactly that. */
const EXPECTED: [string, string, string?][] = [
  ['comm.structure', 'framework-challenge', 'STAR'],
  ['comm.filler_words', 'pause-dont-fill'],
  ['comm.fluency', 'pause-dont-fill'],
  ['comm.pace', 'pace-control'],
  ['comm.intonation', 'emphasis-and-melody'],
  ['comm.articulation', 'clear-diction'],
  ['comm.projection', 'project-to-the-end'],
  ['comm.eye_contact', 'speak-to-the-lens'],
  ['comm.facial_expression', 'speak-to-the-lens'],
  ['comm.composure', 'speak-to-the-lens'],
  ['comm.handling_questions', 'framework-challenge', 'Acknowledge · Bridge · Communicate'],
  ['comm.clarity', 'explain-it-simply'],
  ['comm.listening', 'recall-and-retell'],
  ['interview.behavioral.answer_structure', 'framework-challenge', 'STAR'],
  ['interview.screening.self_presentation', 'framework-challenge', 'Present · Past · Future'],
  ['interview.behavioral.difficult_questions', 'framework-challenge', 'Acknowledge · Bridge · Communicate'],
  ['interview.system_design.tradeoffs', 'take-both-sides'],
  ['interview.case.structuring', 'framework-challenge', 'Problem · Solution · Benefit'],
]

describe('practiceFor', () => {
  it.each(EXPECTED)('%s → %s %s', (competencyId, drillId, frameworkName) => {
    const link = practiceFor(competencyId)
    expect(link?.drillId).toBe(drillId)
    expect(link?.framework).toBe(frameworkName)
  })

  it('only links to drills, formats and frameworks that exist in the Practice Center', () => {
    const center = LOCATIONS.find((l) => l.id === 'practice-center')
    for (const [competencyId] of EXPECTED) {
      const link = practiceFor(competencyId)
      if (!link) continue
      expect(DRILLS[link.drillId], competencyId).toBeDefined()
      expect(PRACTICE_FORMATS[link.area]?.[0]?.id, competencyId).toBe(link.drillId)
      expect(center?.practiceAreas, competencyId).toContain(link.area)
      if (link.framework) expect(FRAMEWORKS.map((f) => f.name), competencyId).toContain(link.framework)
    }
  })

  it('suggests nothing rather than a drill that does not train the skill', () => {
    expect(practiceFor('interview.coding.correctness')).toBeNull()
    expect(practiceFor('interview.screening.asking_questions')).toBeNull()
  })
})
