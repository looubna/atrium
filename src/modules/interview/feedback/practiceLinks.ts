import type { DrillId } from '@/data/drills'

/** A Practice Center drill that trains a competency, optionally preset to one framework. */
export interface PracticeLink {
  drillId: DrillId
  /** The practice area the drill is listed under (a key of PRACTICE_FORMATS). */
  area: string
  framework?: string
  label: string
  /** Why this drill helps, in a few words. */
  why: string
}

const framework = (name: string, why: string): PracticeLink => ({
  drillId: 'framework-challenge',
  area: 'Framework Challenge',
  framework: name,
  label: `Framework Challenge · ${name}`,
  why,
})

const drill = (drillId: DrillId, area: string, why: string): PracticeLink => ({ drillId, area, label: area, why })

// Framework names match FRAMEWORKS in src/data/drills.ts; areas match PRACTICE_FORMATS.
const STAR = framework('STAR', 'Tell examples as Situation, Task, Action, Result')
const PREP = framework('PREP', 'Make one point, give the reason and an example, then stop')
const PRESENT_PAST_FUTURE = framework('Present · Past · Future', 'The standard structure for “Tell me about yourself”')
const ACKNOWLEDGE_BRIDGE = framework('Acknowledge · Bridge · Communicate', 'The media-training method for tough questions')
const PROBLEM_SOLUTION = framework('Problem · Solution · Benefit', 'Structure a recommendation so it lands')
const REFLECT = framework('What · So what · Now what', 'Reflect on what happened and what you learned')
const THINK = drill('think-on-your-feet', 'Think on Your Feet', 'Answer the unexpected directly, with little preparation')
const EXPLAIN = drill('explain-it-simply', 'Explain it Simply', 'Make ideas clear with plain words and one example')
const BOTH_SIDES = drill('take-both-sides', 'Take Both Sides', 'Defend a position with reasons and handle pushback')
const RETELL = drill('recall-and-retell', 'Recall & Retell', 'Take in what you hear, then respond in order')
const PAUSE = drill('pause-dont-fill', 'Pause, Don’t Fill', 'Replace fillers with silent pauses, the Toastmasters “Ah-Counter” way')
const EMPHASIS = drill('emphasis-and-melody', 'Emphasis & Melody', 'Stress key words with pitch, pace and pauses')
const DICTION = drill('clear-diction', 'Clear Diction', 'Over-articulate, then relax: classic diction training')
const PACE = drill('pace-control', 'Pace Control', 'Read to a target time to feel a comfortable 130–160 words a minute')
const LENS = drill('speak-to-the-lens', 'Speak to the Lens', 'Look into the camera with a warm expression, with live feedback')
const PROJECT = drill('project-to-the-end', 'Project to the End', 'Breathe low and keep your voice strong to the last word')

const BY_ID: Record<string, PracticeLink> = {
  'comm.structure': STAR,
  'comm.storytelling': STAR,
  'comm.conciseness': PREP,
  'comm.relevance': PREP,
  'comm.reasoning': PREP,
  'comm.repetition': PREP,
  'comm.clarity': EXPLAIN,
  'comm.vocabulary': EXPLAIN,
  'comm.fluency': PAUSE,
  'comm.filler_words': PAUSE,
  'comm.handling_questions': ACKNOWLEDGE_BRIDGE,
  'comm.pace': PACE,
  'comm.listening': RETELL,
  'comm.delivery': EMPHASIS,
  'comm.intonation': EMPHASIS,
  'comm.articulation': DICTION,
  'comm.projection': PROJECT,
  'comm.eye_contact': LENS,
  'comm.facial_expression': LENS,
  'comm.composure': LENS,
}

/** Round competencies, by the last part of their id (e.g. `interview.behavioral.answer_structure`). */
const BY_SLUG: Record<string, PracticeLink> = {
  answer_structure: STAR,
  storytelling: STAR,
  achievements: STAR,
  ownership: STAR,
  leadership: STAR,
  collaboration: STAR,
  self_presentation: PRESENT_PAST_FUTURE,
  career_goals: PRESENT_PAST_FUTURE,
  experience_relevance: PRESENT_PAST_FUTURE,
  motivation: PREP,
  company_interest: PREP,
  role_understanding: PREP,
  conciseness: PREP,
  relevance: PREP,
  clarity: EXPLAIN,
  communication: THINK,
  difficult_questions: ACKNOWLEDGE_BRIDGE,
  handling_questions: ACKNOWLEDGE_BRIDGE,
  handling_hints: THINK,
  adaptability: THINK,
  think_aloud: EXPLAIN,
  explaining_concepts: EXPLAIN,
  message_clarity: EXPLAIN,
  solution_walkthrough: EXPLAIN,
  audience_awareness: EXPLAIN,
  defending_decisions: BOTH_SIDES,
  tradeoffs: BOTH_SIDES,
  decision_making: BOTH_SIDES,
  conflict_management: BOTH_SIDES,
  design_rationale: BOTH_SIDES,
  critical_thinking: BOTH_SIDES,
  structuring: PROBLEM_SOLUTION,
  recommendation: PROBLEM_SOLUTION,
  improvement_ideas: PROBLEM_SOLUTION,
  stakeholder_management: PROBLEM_SOLUTION,
  narrative: REFLECT,
  self_awareness: REFLECT,
  accountability: REFLECT,
  receiving_critique: REFLECT,
}

/** The drill that trains this skill, or null when no Practice Center drill genuinely does. */
export function practiceFor(competencyId: string): PracticeLink | null {
  return BY_ID[competencyId] ?? BY_SLUG[competencyId.split('.').pop() ?? ''] ?? null
}
