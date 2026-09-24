import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FEMALE_VOICES,
  INTERVIEWERS,
  MALE_VOICES,
  PANEL,
  PANEL_IN_PERSON,
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

  it('lists the same two panels as the backend: the call\'s, and the meeting room\'s', () => {
    const python = readFileSync(new URL('../../../backend/app/modules/interview/interviewers.py', import.meta.url), 'utf8')
    const faces = Object.fromEntries(
      [...python.matchAll(/"([^"]+)": "([a-z0-9_]+)",\n\}/g)].map(([, name, avatarId]) => [name, avatarId]),
    )
    const rosterIn = (source: string) =>
      [...source.matchAll(/PanelMember\(\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"([\s\S]*?)\),?\n/g)].map(
        ([, name, role, voice, rest]) => ({
          name,
          role,
          voice,
          questions: Number(/questions=(\d+)/.exec(rest)?.[1] ?? NaN),
          // Only someone with a recording of their own can be cut to; the room cuts to nobody.
          onCamera: Boolean(faces[name]),
          ...(faces[name] ? { avatarId: faces[name] } : {}),
        }),
      )
    const between = (from: string, to: string) => python.slice(python.indexOf(from), python.indexOf(to))
    const online = rosterIn(between('PANEL_ONLINE = Panel(', 'PANEL_IN_PERSON = Panel('))
    const room = rosterIn(between('PANEL_IN_PERSON = Panel(', 'def panel_for('))

    // Both colleagues are on camera, and nobody else is on the call. Nobody's share is decided
    // for them either, so `questions` is absent on both.
    expect(python).not.toContain('observer=')
    expect(PANEL).toEqual(online.map(({ questions: _, ...m }) => ({ ...m, onCamera: true })))
    expect(online.every((m) => Number.isNaN(m.questions))).toBe(true)
    // The room seats the people in its own footage, and nobody else. Nobody there has a tile of
    // their own: the room is one shot, lip-synced for whoever speaks (`panel_room` on the face server).
    expect(PANEL_IN_PERSON).toEqual(room.map(({ avatarId: _a, onCamera: _o, ...m }) => ({ ...m, onCamera: false })))

    // A panel is not a queue of equals: somebody asks less than the lead, somebody not at all.
    expect(PANEL_IN_PERSON.filter((c) => c.questions === 0).length).toBeGreaterThan(0)
    for (const colleague of PANEL_IN_PERSON) expect(colleague.questions, colleague.name).toBeLessThan(3)

    const leads = new Set(Object.values(INTERVIEWERS).map((p) => p.voice))
    for (const panel of [PANEL, PANEL_IN_PERSON]) {
      const voiced = panel.filter((c) => c.voice !== null)
      expect(voiced.length).toBeGreaterThan(0)
      for (const colleague of voiced) {
        // Never a lead's voice, and never each other's.
        expect(leads.has(colleague.voice!), colleague.name).toBe(false)
        // A voice that contradicts the face breaks the illusion, so each is checked by gender.
        expect([...MALE_VOICES, ...FEMALE_VOICES], colleague.name).toContain(colleague.voice)
      }
      expect(new Set(voiced.map((c) => c.voice)).size).toBe(voiced.length)
    }
  })
})
