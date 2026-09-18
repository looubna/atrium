import type { ExamStyle } from '@/modules/exam/api'

/**
 * Who examines the student, and in which voice.
 *
 * An oral exam is one person throughout, so there is one examiner per style: the
 * one who questions you across a desk, and the one who watches you work at the
 * board. Their faces are recordings on our LiveTalking face server
 * (`infra/livetalking`). Mirrors `backend/app/modules/exam/examiners.py`; the two
 * are kept in step by tests on both sides.
 */
export interface Examiner {
  /** The recording on the face server (`data/avatars/<id>`). */
  avatarId: string
  /** Shown on the name plate. */
  name: string
  role: string
  /** How the face reads, used only to keep the voice from contradicting it. */
  gender: 'female' | 'male'
  /** Gemini Live voice, chosen on the server; kept here so the two cannot drift. */
  voice: string
  /** Why this person for this kind of exam. */
  note: string
}

export const EXAMINERS: Record<ExamStyle, Examiner> = {
  oral_questions: {
    avatarId: 'william',
    name: 'Prof. William Okonjo',
    role: 'Examiner',
    gender: 'male',
    voice: 'Sadaltager', // knowledgeable
    note: 'The senior academic across the desk who has heard every answer before.',
  },
  board_work: {
    avatarId: 'gabriel',
    name: 'Prof. Gabriel Sartori',
    role: 'Examiner',
    gender: 'male',
    voice: 'Charon', // informative
    note: 'Follows a derivation line by line, which is what a board exam feels like.',
  },
  unknown: {
    avatarId: 'william',
    name: 'Prof. William Okonjo',
    role: 'Examiner',
    gender: 'male',
    voice: 'Sadaltager',
    note: 'Default until the style is settled; a session never starts in this state.',
  },
}

export const examinerFor = (style?: ExamStyle | null): Examiner => EXAMINERS[style ?? 'unknown'] ?? EXAMINERS.unknown
