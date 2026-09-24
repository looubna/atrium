/**
 * Who shows up for each round.
 *
 * A real interview loop puts different people in front of you as it goes: a
 * recruiter first, engineers in the middle, the hiring manager and executives
 * at the end. The face should match — seniority is part of the pressure the
 * candidate is practising for.
 *
 * The avatar id names the person's recording on our LiveTalking face server
 * (`data/avatars/<id>`): them seated at their desk, and writing notes while the
 * candidate answers.
 */

/** Round types come from the backend catalog (`modules/interview/catalogs.py`). */
export type InterviewRoundType =
  | 'screening'
  | 'behavioral'
  | 'technical'
  | 'coding'
  | 'system_design'
  | 'case'
  | 'hiring_manager'
  | 'presentation'
  | 'take_home_review'
  | 'other'

/** How senior the interviewer reads, which is what the candidate feels. */
export type Seniority = 'peer' | 'senior' | 'leader' | 'executive'

export interface Interviewer {
  /** The recording on the face server (`infra/livetalking`). */
  avatarId: string
  /** Shown on the call tile. */
  name: string
  /** The job they are playing, shown under the name. */
  role: string
  seniority: Seniority
  /** How the face reads, used only to keep the voice from contradicting it. */
  gender: 'female' | 'male'
  /**
   * Gemini Live voice for this interviewer, passed through `LiveAgentSpec.voice_name`.
   *
   * Google documents these voices by character (firm, clear, mature) and says nothing
   * about gender, so each pairing below is a listening judgement and should be checked
   * by ear before release — a voice that contradicts the face breaks the illusion faster
   * than anything else in the call.
   */
  voice: string
  /** Why this face for this round — kept so the choice can be argued with. */
  note: string
}

export const INTERVIEWERS: Record<InterviewRoundType, Interviewer> = {
  screening: {
    avatarId: 'mia',
    name: 'Mia Fernández',
    role: 'Talent Partner',
    seniority: 'peer',
    gender: 'female',
    voice: 'Leda', // youthful
    note: 'Polished and neutral: the first call is friendly, not adversarial.',
  },
  behavioral: {
    avatarId: 'evelyn',
    name: 'Evelyn Ross',
    role: 'People Business Partner',
    seniority: 'senior',
    gender: 'female',
    voice: 'Gacrux', // mature
    note: 'Experienced and composed — the person who probes how you work with others.',
  },
  technical: {
    avatarId: 'pablo',
    name: 'Pablo Duarte',
    role: 'Senior Engineer',
    seniority: 'senior',
    gender: 'male',
    voice: 'Iapetus', // clear
    note: 'A working engineer at a desk: a peer who will check your depth.',
  },
  coding: {
    avatarId: 'leo',
    name: 'Leo Mensah',
    role: 'Staff Engineer',
    seniority: 'senior',
    gender: 'male',
    voice: 'Puck', // upbeat
    note: 'Approachable while you think aloud, which is what a pairing round needs.',
  },
  system_design: {
    avatarId: 'gabriel',
    name: 'Gabriel Sartori',
    role: 'Principal Engineer',
    seniority: 'leader',
    gender: 'male',
    voice: 'Charon', // informative
    note: 'Visibly the most experienced technologist in the loop — matches a design review.',
  },
  case: {
    avatarId: 'cara',
    name: 'Cara Lindqvist',
    role: 'Engagement Manager',
    seniority: 'senior',
    gender: 'female',
    voice: 'Erinome', // clear
    note: 'Consulting-sharp and quick, the register a case interview is run in.',
  },
  hiring_manager: {
    avatarId: 'richard',
    name: 'Richard Hale',
    role: 'Hiring Manager',
    seniority: 'leader',
    gender: 'male',
    voice: 'Alnilam', // firm
    note: 'Suit, office, older: the person who actually decides.',
  },
  presentation: {
    avatarId: 'william',
    name: 'William Okonjo',
    role: 'Department Head',
    seniority: 'executive',
    gender: 'male',
    voice: 'Sadaltager', // knowledgeable
    note: 'The most senior face available — presenting to an executive should feel different.',
  },
  take_home_review: {
    avatarId: 'kevin',
    name: 'Kevin Park',
    role: 'Team Manager',
    seniority: 'senior',
    gender: 'male',
    voice: 'Schedar', // even
    note: 'Measured and neutral: this round is about walking through your work.',
  },
  other: {
    avatarId: 'mia',
    name: 'Mia Fernández',
    role: 'Interviewer',
    seniority: 'peer',
    gender: 'female',
    voice: 'Leda',
    note: 'Default when a round has no type yet.',
  },
}

/**
 * Voices that read female and male to listeners. Google publishes no gender for
 * these voices, so this is a listening judgement kept in one place: it is what
 * stops a woman's face speaking with a man's voice.
 */
export const FEMALE_VOICES = ['Leda', 'Gacrux', 'Erinome', 'Kore', 'Aoede', 'Achernar', 'Zephyr', 'Vindemiatrix']
export const MALE_VOICES = ['Charon', 'Iapetus', 'Puck', 'Alnilam', 'Sadaltager', 'Schedar', 'Orus', 'Rasalgethi']

/** Unknown or missing round types fall back to a professional default rather than no face. */
export const interviewerFor = (roundType?: string | null): Interviewer =>
  INTERVIEWERS[(roundType ?? 'other') as InterviewRoundType] ?? INTERVIEWERS.other

/**
 * Who sits in the centre chair of the meeting-room footage, mirroring `IN_PERSON_LEAD`.
 *
 * A call can put a different interviewer in front of the candidate every round, because a tile is
 * whoever we say it is. The room cannot: it is one photograph of three people, and the name under
 * the frame has to belong to the woman actually sitting there.
 */
export const IN_PERSON_LEAD = INTERVIEWERS.behavioral

/** Who leads this round: the room's own interviewer, or the one the round type calls for. */
export const leadFor = (roundType: string | null | undefined, inPerson: boolean): Interviewer =>
  inPerson ? IN_PERSON_LEAD : interviewerFor(roundType)

export const SENIORITY_LABEL: Record<Seniority, string> = {
  peer: 'Peer',
  senior: 'Senior',
  leader: 'Leader',
  executive: 'Executive',
}

/** Someone else on a panel, beside the lead interviewer. */
export interface PanelColleague {
  name: string
  role: string
  /** Speaks in this Gemini voice, which no lead interviewer uses. Null: never speaks at all. */
  voice: string | null
  /**
   * How many questions they ask in the whole interview, when that has been decided for them.
   *
   * Left out, nobody has decided: the lead shares the questioning out itself, which is how a
   * panel on a call has always run. Zero is the person who sits in — they say hello at the start
   * and then listen and take notes. The server holds the lead to this (`PanelMember.questions`);
   * it is here so a room knows who is only ever going to be a name.
   */
  questions?: number
  /** Camera on: their face shows, framed from the meeting footage. */
  onCamera: boolean
  /** Their own recording on the face server (`PANEL_AVATARS`). Absent for someone with no face. */
  avatarId?: string
}

/**
 * The rest of a panel on a video call. Mirrors `PANEL_ONLINE` in
 * `backend/app/modules/interview/interviewers.py`, which the live interviewer is told about —
 * the names it says are the names on these tiles.
 *
 * Two colleagues on camera share the questioning with the lead, and nobody else is on the call.
 */
export const PANEL: PanelColleague[] = [
  { name: 'Daniel Brooks', role: 'Team Lead', voice: 'Orus', onCamera: true, avatarId: 'william' },
  { name: 'Grace Lin', role: 'Senior Team Member', voice: 'Kore', onCamera: true },
]

/**
 * The rest of a panel in the meeting room, mirroring `PANEL_IN_PERSON`.
 *
 * A call is a grid of tiles and can seat anyone; the room is one photograph, so the only people
 * who may speak are the three sitting in it. They are not equals either: the lead runs the
 * interview, Daniel comes in once or twice, and Grace introduces herself and then takes notes.
 * The room is one shot of the three of them; whoever speaks has their mouth lip-synced in it.
 */
export const PANEL_IN_PERSON: PanelColleague[] = [
  { name: 'Daniel Brooks', role: 'Team Lead', voice: 'Orus', questions: 2, onCamera: false },
  { name: 'Grace Lin', role: 'Senior Team Member', voice: 'Kore', questions: 0, onCamera: false },
]
