import { describe, expect, it } from 'vitest'
import { CLAIM_TYPE_LABEL, FLAG_LABEL, FOCUS_LABELS, GOOD_FLAGS } from '@/modules/debate/api'
import type { ArgumentFlag, ClaimType, DebateFocus } from '@/modules/debate/api'
import {
  DEBATE_DIFFICULTY_LABEL,
  DEBATE_FORMAT_LABEL,
  describeSession,
  PRACTICE_FORMATS,
  type SessionSetup,
} from '@/data/practice'
import { opensOwnScreen } from '@/state/useAppStore'
import { debateHere } from '@/components/navigation/DebateRoom'
import { DEBATE_HALL, DEBATE_TAKES } from '@/data/debateMedia'

const DEBATE_FORMAT = PRACTICE_FORMATS.Debate[0]

function session(overrides: Partial<SessionSetup> = {}): SessionSetup {
  return {
    locationId: 'university',
    area: 'Debate',
    format: DEBATE_FORMAT,
    minutes: 15,
    debate: {
      motion: 'Governments should regulate generative AI',
      position: 'for',
      aiPosition: 'against',
      format: 'free',
      difficulty: 'intermediate',
      sessionId: 'sess-1',
    },
    ...overrides,
  }
}

describe('where a debate lives in the app', () => {
  it('is offered at the university and opens its own screen', () => {
    expect(DEBATE_FORMAT.destination).toBe('debate')
    expect(DEBATE_FORMAT.kind).toBe('debate')
    expect(opensOwnScreen(session())).toBe(true)
  })

  it('shows the room only for a debate session at the selected location', () => {
    const state = { view: 'debate', session: session(), selectedId: 'university' }
    expect(debateHere(state)).not.toBeNull()
    // Another building selected, another view, or a session that is not a debate: nothing.
    expect(debateHere({ ...state, selectedId: 'company' })).toBeNull()
    expect(debateHere({ ...state, view: 'exam' })).toBeNull()
    expect(debateHere({ ...state, session: { ...session(), debate: undefined } })).toBeNull()
    expect(debateHere({ ...state, session: null })).toBeNull()
  })

  it('describes the debate by the side you are arguing, not by the format alone', () => {
    expect(describeSession(session())).toBe('Arguing FOR · Free debate · Intermediate · 15 min')
    const against = session()
    against.debate!.position = 'against'
    against.debate!.difficulty = 'advanced'
    expect(describeSession(against)).toBe('Arguing AGAINST · Free debate · Advanced · 15 min')
  })
})

describe('labels stay in step with the server', () => {
  it('names every format, difficulty and focus', () => {
    // Mirrors FORMAT_LABELS, the difficulties and FOCUS_LABELS in
    // backend/app/modules/debate/catalogs.py; a missing one would render blank.
    const formats = ['free', 'structured', 'socratic', 'oxford', 'devils_advocate'] as const
    for (const format of formats) expect(DEBATE_FORMAT_LABEL[format]).toBeTruthy()
    for (const level of ['beginner', 'intermediate', 'advanced'] as const) {
      expect(DEBATE_DIFFICULTY_LABEL[level]).toBeTruthy()
    }
    const focuses: DebateFocus[] = [
      'none',
      'evidence',
      'rebuttals',
      'conciseness',
      'critical_thinking',
      'interruptions',
    ]
    for (const focus of focuses) expect(FOCUS_LABELS[focus]).toBeTruthy()
  })

  it('names every claim type, so nothing renders as an unlabelled fact', () => {
    const types: ClaimType[] = ['fact', 'source_based', 'argument', 'interpretation', 'opinion']
    for (const type of types) expect(CLAIM_TYPE_LABEL[type]).toBeTruthy()
    // The distinction the labels exist to preserve.
    expect(CLAIM_TYPE_LABEL.fact).not.toBe(CLAIM_TYPE_LABEL.opinion)
    expect(CLAIM_TYPE_LABEL.source_based).not.toBe(CLAIM_TYPE_LABEL.fact)
  })

  it('names every argument-map mark, and only counts the right one as a strength', () => {
    const flags: ArgumentFlag[] = [
      'unsupported',
      'assumption',
      'evidence_ok',
      'evidence_vague',
      'unanswered',
      'evaded',
      'contradicted',
      'conceded',
    ]
    for (const flag of flags) expect(FLAG_LABEL[flag]).toBeTruthy()
    expect(GOOD_FLAGS).toEqual(['evidence_ok'])
    for (const flag of flags.filter((f) => f !== 'evidence_ok')) {
      expect(GOOD_FLAGS).not.toContain(flag)
    }
  })
})

describe('the hall the debate is argued in', () => {
  it('is the debate hall, not the interview room', () => {
    // The room used to borrow the one-to-one interview photograph, so an opponent called Bennett
    // was argued at across an empty meeting table with an interviewer sitting in it.
    for (const photo of Object.values(DEBATE_HALL)) expect(photo).toContain('/video/debate/hall/')
  })

  it('films one calm take, on the frame the photograph is', () => {
    for (const [orientation, takes] of Object.entries(DEBATE_TAKES)) {
      expect(DEBATE_HALL[orientation as keyof typeof DEBATE_HALL]).toBe(`/video/debate/hall/${orientation}_calm.jpg`)
      expect(takes.listen).toBe(`/video/debate/hall/${orientation}_calm.mp4`)
      // No filmed arguing take: its hands and mouth moved on their own, through silences and
      // under the lip-sync. Only the face server moves his mouth, and only on his voice.
      expect(takes.lead).toBe(takes.listen)
      // One opponent holds the floor; the two beside them never take it.
      expect(takes.colleagues).toEqual([])
    }
  })
})

describe('the opponent is lip-synced where he sits', () => {
  it('offers no close-up to cut to', async () => {
    // The face server paints his mouth onto the wide hall clip itself, so the lip-synced
    // stream *is* this shot. A close-up would take the candidate out of the room they are
    // arguing in to watch one man's face, which is what was asked not to happen.
    const media = await import('@/data/debateMedia')

    expect('DEBATE_CLOSEUP' in media).toBe(false)
  })

  it('keeps the filmed takes, which are what plays when no face is streaming', () => {
    for (const takes of Object.values(DEBATE_TAKES)) {
      expect(takes.listen).toContain('/video/debate/hall/')
      expect(takes.lead).toContain('/video/debate/hall/')
    }
  })
})
