import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXAMINERS, examinerFor } from '../examiners'

const backend = readFileSync('backend/app/modules/exam/examiners.py', 'utf8')

describe('examiners', () => {
  it('has one examiner per exam style', () => {
    expect(Object.keys(EXAMINERS).sort()).toEqual(['board_work', 'oral_questions', 'unknown'])
  })

  it('gives every examiner a recording, a name and a voice', () => {
    for (const [style, person] of Object.entries(EXAMINERS)) {
      expect(person.avatarId, style).toMatch(/^[a-z][a-z0-9_]{2,}$/)
      expect(person.name, style).toMatch(/^Prof\./)
      expect(person.voice.length, style).toBeGreaterThan(2)
    }
  })

  it('matches the faces and voices the server actually uses', () => {
    // The server picks both; a mismatch would put another person's voice on the face.
    for (const person of Object.values(EXAMINERS)) {
      expect(backend).toContain(`Examiner("${person.avatarId}", "${person.name}", "${person.role}", "${person.voice}")`)
    }
  })

  it('falls back rather than leaving an exam faceless', () => {
    expect(examinerFor(null)).toBe(EXAMINERS.unknown)
    expect(examinerFor('board_work')).toBe(EXAMINERS.board_work)
  })
})
