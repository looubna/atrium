/**
 * What a practice area offers once it is picked. Only areas listed in
 * PRACTICE_FORMATS are selectable; the rest stay display-only until their
 * formats exist.
 */

import type { ExamStyle } from '@/modules/exam/api'

export type Posture = 'sitting' | 'standing'

/** Where a format takes the user when they go in. */
export type Destination = 'meeting' | 'theater' | 'call' | 'drill' | 'talk' | 'exam'

export interface PracticeFormat {
  id: string
  label: string
  note: string
  destination: Destination
  /** Formats that also ask whether the user sits or stands. */
  askPosture?: boolean
  /** Formats with their own setup form (interview, sales, leadership). */
  kind?: 'interview' | 'sales' | 'leadership' | 'negotiation' | 'meeting' | 'networking' | 'defence' | 'emotional' | 'exam'
}

export type InterviewType = 'recruiter' | 'behavioral' | 'coding' | 'technical' | 'hiring-manager' | 'case'

export const INTERVIEW_TYPES: { id: InterviewType; label: string; note: string }[] = [
  { id: 'recruiter', label: 'Recruiter / screening', note: 'Motivation, background, logistics' },
  { id: 'behavioral', label: 'Behavioral', note: 'Past situations, told as stories' },
  { id: 'coding', label: 'Coding', note: 'Solve a problem, thinking aloud' },
  { id: 'technical', label: 'Technical / system design', note: 'Architecture and trade-offs' },
  { id: 'hiring-manager', label: 'Hiring manager', note: 'Fit with the role and the team' },
  { id: 'case', label: 'Case', note: 'Structure an open business problem' },
]

export type InterviewMode = 'online' | 'in-person'
export type InterviewPanel = 'one-to-one' | 'panel'

/** A file the user attached. Kept on the device: only its name travels with the session. */
export interface AttachedFile {
  name: string
  size: number
  type: string
}

export interface InterviewSetup {
  /** A general behavioral interview: nothing role-specific needed. */
  general: boolean
  type: InterviewType
  mode: InterviewMode
  panel: InterviewPanel
  jobDescription?: AttachedFile
  resume?: AttachedFile
  /** Where the job is, if the user says. */
  location?: string
  /** The server-side practice session this setup created; present once the interview can go live. */
  sessionId?: string
  /** The application and interview-journey round being practised, when not general practice. */
  applicationId?: string
  blueprintId?: string
  roundId?: string
  roundTitle?: string
  /** Blueprint round type, which decides who shows up: see `src/data/interviewers.ts`. */
  roundType?: string
  company?: string
  roleTitle?: string
}

export type SalesType = 'call-outreach' | 'pitch-demo' | 'investor-pitch' | 'account-management'

export const SALES_TYPES: { id: SalesType; label: string; note: string }[] = [
  { id: 'call-outreach', label: 'Call outreach', note: 'A first call with a prospect' },
  { id: 'pitch-demo', label: 'Sales pitch / demo', note: 'Show the product, handle objections' },
  { id: 'investor-pitch', label: 'Investor pitch', note: 'The business case to a panel of investors' },
  { id: 'account-management', label: 'Account management', note: 'Renew, grow or rescue a client' },
]

export interface SalesSetup {
  type: SalesType
  mode: InterviewMode
}

export type LeadershipScenario = 'motivate' | 'conflict' | 'crisis' | 'delegate' | 'feedback'

export const LEADERSHIP_SCENARIOS: { id: LeadershipScenario; label: string; note: string }[] = [
  { id: 'motivate', label: 'Motivate people', note: 'Re-energise a team that has lost momentum' },
  { id: 'conflict', label: 'Manage conflict', note: 'Two colleagues who can no longer work together' },
  { id: 'crisis', label: 'Handle a crisis', note: 'Something has gone wrong; the team looks to you' },
  { id: 'delegate', label: 'Delegate, goals & expectations', note: 'Hand work over and make the bar clear' },
  { id: 'feedback', label: 'Give feedback', note: 'Say the hard thing so it lands' },
]

export interface LeadershipSetup {
  /** The full simulation runs through several situations; a scenario practises one. */
  mode: 'full' | 'scenario'
  scenario?: LeadershipScenario
}

/** Face to face with one person, around a table with several, or on a video call. */
export type GatheringFormat = 'one-to-one' | 'group' | 'virtual'

export const GATHERING_FORMATS: { id: GatheringFormat; label: string }[] = [
  { id: 'one-to-one', label: 'One-to-one' },
  { id: 'group', label: 'Group' },
  { id: 'virtual', label: 'Virtual' },
]

export type NegotiationScenario = 'salary' | 'price' | 'contract' | 'deadline' | 'scope' | 'partnership' | 'other'

export const NEGOTIATION_SCENARIOS: { id: NegotiationScenario; label: string; note: string }[] = [
  { id: 'salary', label: 'Salary', note: 'You received a job offer, but you want to negotiate a higher salary' },
  { id: 'price', label: 'Price negotiation', note: "A client wants to pay less than the proposed price. Reach a price you're comfortable with" },
  { id: 'contract', label: 'Contract negotiation', note: 'Negotiate specific terms in a contract before signing' },
  { id: 'deadline', label: 'Deadline negotiation', note: 'Your manager asks you to deliver a project earlier than you think is realistic' },
  { id: 'scope', label: 'Scope negotiation', note: 'A client asks you to add more work without increasing the budget' },
  { id: 'partnership', label: 'Business partnership', note: 'You and another company are dividing responsibilities and revenue' },
  { id: 'other', label: 'Other', note: 'Describe your situation and what you want to achieve' },
]

export interface NegotiationSetup {
  format: GatheringFormat
  scenario: NegotiationScenario
  /** The user's own situation and goal, for "Other". */
  description?: string
}

export type MeetingRole = 'participant' | 'leader' | 'stakeholder'

export const MEETING_ROLES: { id: MeetingRole; label: string; note: string }[] = [
  { id: 'participant', label: 'Participant', note: 'Contribute, ask, and make your point heard' },
  { id: 'leader', label: 'Meeting leader', note: 'Run the agenda, keep time, drive to decisions' },
  { id: 'stakeholder', label: 'Client / stakeholder', note: 'Represent your interests to the team' },
]

export interface MeetingSetup {
  format: GatheringFormat
  role: MeetingRole
  /** What the meeting is about. */
  topic: string
  material?: AttachedFile
}

export type NetworkingTag = 'junior' | 'peer' | 'senior' | 'executive' | 'client'

export const NETWORKING_TAGS: { id: NetworkingTag; label: string; note: string }[] = [
  { id: 'junior', label: 'Junior', note: 'Newer to the field than you' },
  { id: 'peer', label: 'Peer', note: 'Someone at your level' },
  { id: 'senior', label: 'Senior', note: 'More experienced than you' },
  { id: 'executive', label: 'Executive', note: 'Director, VP or C-level' },
  { id: 'client', label: 'Client / partner', note: 'Someone you could do business with' },
]

/** Who the user talks with in an emotional conversation; each has their own footage. */
export type EmotionalPartner = 'woman' | 'man'

export type EmotionalScenario = 'share-feelings' | 'comfort' | 'apologise' | 'appreciation' | 'boundary' | 'disappointment'

export const EMOTIONAL_SCENARIOS: { id: EmotionalScenario; label: string; note: string }[] = [
  { id: 'share-feelings', label: 'Share how you feel', note: 'Put a feeling into words, honestly' },
  { id: 'comfort', label: 'Comfort someone', note: 'They are upset: listen and support' },
  { id: 'apologise', label: 'Apologise', note: 'Own a mistake without excuses' },
  { id: 'appreciation', label: 'Express appreciation', note: 'Tell them what they mean to you' },
  { id: 'boundary', label: 'Set a boundary', note: 'Say what you need, kindly and clearly' },
  { id: 'disappointment', label: 'Talk about a disappointment', note: 'Raise something that hurt, calmly' },
]

export interface EmotionalSetup {
  partner: EmotionalPartner
  scenario: EmotionalScenario
}

/**
 * An oral exam the student set up. Everything here except the subject and the
 * camera is worked out from their material by the server: what the exam covers,
 * and whether the examiner asks questions or sets problems at the board.
 */
export interface ExamSetup {
  subject: string
  /** The course the material belongs to, when any was added. */
  courseId?: string
  analysisId?: string
  /** How the exam runs. Never `unknown` once a session exists: the server settles it. */
  style: ExamStyle
  /** The server-side session; present once the exam can go live. */
  sessionId?: string
  /** The student asked for feedback on how they come across, so the camera is on. */
  camera?: boolean
}

export interface NetworkingSetup {
  /** Whether the user knows who they are talking to (a badge, an introduction). */
  roleVisible: boolean
  /** Who they are, when the role is visible. */
  tags: NetworkingTag[]
}

export const PRACTICE_FORMATS: Record<string, PracticeFormat[]> = {
  Presentation: [
    {
      id: 'small-room',
      label: 'Small-room presentation',
      note: 'In the meeting room, a few people around a table',
      destination: 'meeting',
      askPosture: true,
    },
    {
      id: 'large-audience',
      label: 'Large audience presentation',
      note: 'In the auditorium: tiered seats, a stage, a big screen',
      destination: 'theater',
    },
    {
      id: 'virtual',
      label: 'Virtual presentation',
      note: 'Straight into a video call, screen shared',
      destination: 'call',
    },
  ],
  Interview: [
    {
      id: 'job-interview',
      label: 'Job interview',
      note: 'Interview type, online or in person, one interviewer or a panel',
      // In person is the meeting room; online becomes a video call when the session is confirmed.
      destination: 'meeting',
      kind: 'interview',
    },
  ],
  Sales: [
    {
      id: 'sales',
      label: 'Sales practice',
      note: 'Call outreach, a pitch or demo, investors, or an account',
      // Online is a video call, in person the meeting room — settled when the session is confirmed.
      destination: 'call',
      kind: 'sales',
    },
  ],
  'Thesis Defence': [
    {
      id: 'thesis-defence',
      label: 'Thesis defence',
      note: 'At the lectern of a lecture hall, facing your committee and an audience',
      destination: 'theater',
      // The committee asks the questions: nobody raises a hand.
      kind: 'defence',
    },
  ],
  // The other university sessions also take place in the lecture hall, its only room.
  'Scholarship / Admissions Interview': [
    {
      id: 'admissions-interview',
      label: 'Scholarship / admissions interview',
      note: 'Before the selection committee: your goals, your record, why you',
      destination: 'theater',
      // A committee asks the questions, as in a defence.
      kind: 'defence',
    },
  ],
  'Academic Presentation': [
    {
      id: 'academic-presentation',
      label: 'Academic presentation',
      note: 'Present your research from the lectern, then take questions from the hall',
      destination: 'theater',
    },
  ],
  Seminar: [
    {
      id: 'seminar',
      label: 'Seminar',
      note: 'Lead the session and handle questions and comments from the room',
      destination: 'theater',
    },
  ],
  'Oral Exam': [
    {
      id: 'oral-exam',
      label: 'Oral exam',
      note: 'Give us your course material; we work out what you will be asked',
      // Its own screen: the examiner's office, or the board, depending on how the exam runs.
      destination: 'exam',
      kind: 'exam',
    },
  ],
  Debate: [
    {
      id: 'debate',
      label: 'Debate',
      note: 'Argue your position and answer challenges from the floor',
      destination: 'theater',
    },
  ],
  Networking: [
    {
      id: 'networking',
      label: 'Networking practice',
      note: 'Meet people whose role you can see, or not',
      destination: 'meeting',
      kind: 'networking',
    },
  ],
  Negotiation: [
    {
      id: 'negotiation',
      label: 'Negotiation practice',
      note: 'Salary, price, contract, deadline, scope, partnership, or your own',
      // One-to-one and group happen in the meeting room; virtual is a video call.
      destination: 'meeting',
      kind: 'negotiation',
    },
  ],
  Meeting: [
    {
      id: 'team-meeting',
      label: 'Meeting practice',
      note: 'Your role, the topic, and any material to bring',
      destination: 'meeting',
      kind: 'meeting',
    },
  ],
  Leadership: [
    {
      id: 'leadership',
      label: 'Leadership practice',
      note: 'A full leadership simulation, or one specific scenario',
      destination: 'meeting',
      kind: 'leadership',
    },
  ],
  // The park: a face-to-face conversation on a bench (ParkTalk), with a woman or a man.
  'Emotional Communication': [
    {
      id: 'emotional-communication',
      label: 'Emotional communication',
      note: 'A heartfelt one-to-one talk on a park bench',
      destination: 'talk',
      kind: 'emotional',
    },
  ],
  // Practice Center drills: short timed rounds on their own screen (DrillStage). Each id is a DrillId.
  'Random Word Story': [
    { id: 'random-word-story', label: 'Random word story', note: 'Three random words: tell a story that uses them all', destination: 'drill' },
  ],
  'Think on Your Feet': [
    { id: 'think-on-your-feet', label: 'Think on your feet', note: 'An unexpected question, ten seconds to get ready', destination: 'drill' },
  ],
  'Framework Challenge': [
    { id: 'framework-challenge', label: 'Framework challenge', note: 'Answer with STAR, PREP and other frameworks, step by step', destination: 'drill' },
  ],
  'Explain it Simply': [
    { id: 'explain-it-simply', label: 'Explain it simply', note: 'Make a complicated idea clear to a particular listener', destination: 'drill' },
  ],
  'Take Both Sides': [
    { id: 'take-both-sides', label: 'Take both sides', note: 'Argue for a statement, then against it', destination: 'drill' },
  ],
  'Describe the Image': [
    { id: 'describe-the-image', label: 'Describe the image', note: 'Paint a busy scene in words for someone who can’t see it', destination: 'drill' },
  ],
  'Recall & Retell': [
    { id: 'recall-and-retell', label: 'Recall & retell', note: 'Read a short story, then retell it once it is hidden', destination: 'drill' },
  ],
  'Pause, Don’t Fill': [
    { id: 'pause-dont-fill', label: 'Pause, don’t fill', note: 'Answer without “um” or “like” — pause silently instead', destination: 'drill' },
  ],
  'Emphasis & Melody': [
    { id: 'emphasis-and-melody', label: 'Emphasis & melody', note: 'Stress the key words so your voice never sounds flat', destination: 'drill' },
  ],
  'Clear Diction': [
    { id: 'clear-diction', label: 'Clear diction', note: 'Over-articulate, then speak naturally but just as clearly', destination: 'drill' },
  ],
  'Pace Control': [
    { id: 'pace-control', label: 'Pace control', note: 'Read an answer inside a target time: 130–160 words a minute', destination: 'drill' },
  ],
  'Speak to the Lens': [
    { id: 'speak-to-the-lens', label: 'Speak to the lens', note: 'Answer to camera with live eye-contact feedback', destination: 'drill' },
  ],
  'Project to the End': [
    { id: 'project-to-the-end', label: 'Project to the end', note: 'Keep your voice strong to the last word of every sentence', destination: 'drill' },
  ],
}

/** Session length the user chooses, in minutes. */
export const DURATION_MIN = 5
export const DURATION_MAX = 60
export const DURATION_STEP = 5
export const DURATION_DEFAULT = 15

export const DESTINATION_LABEL: Record<Destination, string> = {
  meeting: 'the meeting room',
  theater: 'the stage',
  call: 'the video call',
  drill: 'the practice room',
  talk: 'the park bench',
  exam: 'the examination room',
}

/** A session the user has set up, carried from the panel into the building. */
export interface SessionSetup {
  locationId: string
  area: string
  format: PracticeFormat
  posture?: Posture
  minutes: number
  /** A Practice Center drill opened from feedback, preset to what the user should practise. */
  drill?: { framework?: string }
  interview?: InterviewSetup
  sales?: SalesSetup
  leadership?: LeadershipSetup
  negotiation?: NegotiationSetup
  meeting?: MeetingSetup
  networking?: NetworkingSetup
  emotional?: EmotionalSetup
  exam?: ExamSetup
}

/** "Presentation · Small-room · Standing · 15 min", or "Interview · Behavioral · Online · Panel · 30 min" */
const gatheringLabel = (f: GatheringFormat) => GATHERING_FORMATS.find((g) => g.id === f)?.label

export const EXAM_STYLE_LABEL: Record<ExamStyle, string> = {
  oral_questions: 'The professor asks questions',
  board_work: 'Problems at the board',
  unknown: 'Format decided from your material',
}

export const describeSession = (s: SessionSetup) =>
  s.exam
    ? [s.exam.subject || s.area, EXAM_STYLE_LABEL[s.exam.style], `${s.minutes} min`].join(' · ')
    : s.emotional
    ? [
        s.area,
        EMOTIONAL_SCENARIOS.find((c) => c.id === s.emotional!.scenario)?.label,
        s.emotional.partner === 'woman' ? 'With a woman' : 'With a man',
        `${s.minutes} min`,
      ].join(' · ')
    : s.networking
    ? [
        s.area,
        s.networking.roleVisible
          ? s.networking.tags.map((t) => NETWORKING_TAGS.find((n) => n.id === t)?.label).join(', ')
          : 'Role unknown',
        `${s.minutes} min`,
      ].join(' · ')
    : s.negotiation
    ? [
        s.area,
        NEGOTIATION_SCENARIOS.find((c) => c.id === s.negotiation!.scenario)?.label,
        gatheringLabel(s.negotiation.format),
        `${s.minutes} min`,
      ].join(' · ')
    : s.meeting
    ? [
        s.area,
        MEETING_ROLES.find((r) => r.id === s.meeting!.role)?.label,
        gatheringLabel(s.meeting.format),
        `${s.minutes} min`,
      ].join(' · ')
    : s.sales
    ? [
        s.area,
        SALES_TYPES.find((t) => t.id === s.sales!.type)?.label,
        s.sales.mode === 'online' ? 'Online' : 'In person',
        `${s.minutes} min`,
      ].join(' · ')
    : s.leadership
    ? [
        s.area,
        s.leadership.mode === 'full'
          ? 'Full simulation'
          : LEADERSHIP_SCENARIOS.find((c) => c.id === s.leadership!.scenario)?.label,
        `${s.minutes} min`,
      ].join(' · ')
    : s.interview
    ? [
        s.area,
        s.interview.roundTitle ??
          (s.interview.general ? 'General behavioral' : INTERVIEW_TYPES.find((t) => t.id === s.interview!.type)?.label),
        s.interview.mode === 'online' ? 'Online' : 'In person',
        s.interview.panel === 'panel' ? 'Panel' : 'One-to-one',
        `${s.minutes} min`,
      ].join(' · ')
    : [
        s.area,
        s.format.label.toLowerCase() === s.area.toLowerCase() ? null : s.format.label.replace(/ presentation$/i, ''),
        s.posture && (s.posture === 'sitting' ? 'Sitting' : 'Standing'),
        `${s.minutes} min`,
      ]
        .filter(Boolean)
        .join(' · ')
