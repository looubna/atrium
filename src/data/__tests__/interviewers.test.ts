import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FEMALE_VOICES,
  INTERVIEWERS,
  MALE_VOICES,
  PANEL,
  interviewerFor,
  type InterviewRoundType,
} from '../interviewers'

const ROUND_TYPES: InterviewRoundType[] = [
  'screening',
  'behavioral',
  'technical',
  'coding',
  'system_design',
  'case',
  'hiring_manager',
  'presentation',
  'take_home_review',
  'other',
]

describe('interviewers', () => {
  it('covers every round type the backend catalog defines', () => {
    expect(Object.keys(INTERVIEWERS).sort()).toEqual([...ROUND_TYPES].sort())
  })

  it('gives every interviewer a recording, name and role', () => {
    for (const [round, person] of Object.entries(INTERVIEWERS)) {
      expect(person.avatarId, round).toMatch(/^[a-z][a-z0-9_]{2,}$/)
      expect(person.name.length, round).toBeGreaterThan(2)
      expect(person.role.length, round).toBeGreaterThan(2)
    }
  })

  it('escalates seniority through a loop: recruiter, engineers, then the decision makers', () => {
    expect(INTERVIEWERS.screening.seniority).toBe('peer')
    expect(INTERVIEWERS.technical.seniority).toBe('senior')
    expect(INTERVIEWERS.system_design.seniority).toBe('leader')
    expect(INTERVIEWERS.hiring_manager.seniority).toBe('leader')
    expect(INTERVIEWERS.presentation.seniority).toBe('executive')
  })

  it('puts a different face in each stage of a typical loop', () => {
    const loop: InterviewRoundType[] = ['screening', 'technical', 'system_design', 'hiring_manager']
    const faces = new Set(loop.map((round) => INTERVIEWERS[round].avatarId))
    expect(faces.size).toBe(loop.length)
  })

  it('never gives a face a voice of the other gender', () => {
    for (const [round, person] of Object.entries(INTERVIEWERS)) {
      const expected = person.gender === 'female' ? FEMALE_VOICES : MALE_VOICES
      expect(expected, `${round}: ${person.name} (${person.gender}) speaks with ${person.voice}`).toContain(person.voice)
    }
  })

  it('keeps the voice lists disjoint, so a pairing can only be right or wrong', () => {
    expect(FEMALE_VOICES.filter((v) => MALE_VOICES.includes(v))).toEqual([])
  })

  it('falls back to a professional default for unknown or missing types', () => {
    expect(interviewerFor('nonsense').avatarId).toBe(INTERVIEWERS.other.avatarId)
    expect(interviewerFor(null).avatarId).toBe(INTERVIEWERS.other.avatarId)
    expect(interviewerFor('hiring_manager').name).toBe('Richard Hale')
  })

  // The live interviewer introduces itself from the backend copy; the tile shows this one.
  it('matches the names and roles the backend interviewer introduces itself with', () => {
    const python = readFileSync(new URL('../../../backend/app/modules/interview/interviewers.py', import.meta.url), 'utf8')
    for (const [round, person] of Object.entries(INTERVIEWERS)) {
      const entry = new RegExp(`RoundType\\.${round.toUpperCase()}: Interviewer\\(\\s*"${person.avatarId}", "([^"]+)", "([^"]+)"`)
      const match = entry.exec(python)
      expect(match, round).not.toBeNull()
      expect(match![1], round).toBe(person.name)
      expect(match![2], round).toBe(person.role)
    }
  })

  it('lists the same panel as the backend, with voices no lead interviewer uses', () => {
    const python = readFileSync(new URL('../../../backend/app/modules/interview/interviewers.py', import.meta.url), 'utf8')
    const speakers = [...python.matchAll(/PanelMember\(\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"/g)].map(([, name, role, voice]) => ({
      name,
      role,
      voice,
      onCamera: true,
    }))
    const observer = /PANEL_OBSERVER = \("([^"]+)", "([^"]+)"\)/.exec(python)!
    expect(PANEL).toEqual([...speakers, { name: observer[1], role: observer[2], voice: null, onCamera: false }])
    const leads = new Set(Object.values(INTERVIEWERS).map((p) => p.voice))
    for (const colleague of PANEL) if (colleague.voice) expect(leads.has(colleague.voice), colleague.name).toBe(false)
    expect(MALE_VOICES).toContain(PANEL[0].voice)
    expect(FEMALE_VOICES).toContain(PANEL[1].voice)
  })
})
