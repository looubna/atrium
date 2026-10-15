/**
 * What a practice area offers once it is picked. Only areas listed in
 * PRACTICE_FORMATS are selectable; the rest stay display-only until their
 * formats exist.
 */

import type { ExamStyle } from '@/modules/exam/api'
import { DRILLS, STORY_COURSE } from './drills'
import type {
  DebateDifficulty,
  DebateFocus,
  DebateFormatId,
  DebatePosition,
} from '@/modules/debate/api'

export type Posture = 'sitting' | 'standing'

/** Where a format takes the user when they go in. */
export type Destination = 'meeting' | 'theater' | 'call' | 'drill' | 'talk' | 'exam' | 'debate' | 'admission'

export interface PracticeFormat {
  id: string
  label: string
  note: string
  destination: Destination
  /** Formats that also ask whether the user sits or stands. */
  askPosture?: boolean
  /** Formats with their own setup form (interview, sales, leadership). */
  kind?:
    | 'interview'
    | 'sales'
    | 'leadership'
    | 'negotiation'
    | 'meeting'
    | 'networking'
    | 'defence'
    | 'admission'
    | 'emotional'
    | 'exam'
    | 'debate'
    | 'presentation'
    | 'brainlab'
    | 'cafe'
    | 'busstop'
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
  /** The live session on the server (`backend/app/modules/sales`), once it has been set up. */
  sessionId?: string
  /** Who is on the other side, the one who speaks first. */
  people?: { key: string; name: string; role: string }[]
  /** The seller's pre-read, shown before joining: the deal, who is there, the goal. */
  briefing?: SalesBriefing
}

export interface SalesBriefing {
  title: string
  seller: string
  org: string
  about: string
  situation: string
  goal: string
  people: { name: string; role: string; known: string }[]
  format: string
}

export type LeadershipScenario = 'motivate' | 'conflict' | 'crisis' | 'delegate' | 'feedback'

export const LEADERSHIP_SCENARIOS: { id: LeadershipScenario; label: string; note: string }[] = [
  { id: 'motivate', label: 'Motivate people', note: 'The launch slipped twice and the team has gone flat' },
  { id: 'conflict', label: 'Manage conflict', note: 'Design and marketing clashed in public over a rollback' },
  { id: 'crisis', label: 'Handle a crisis', note: '12% of payments failing, the CEO wants an update by 10:30' },
  { id: 'delegate', label: 'Delegate, goals & expectations', note: 'Hand out three Q4 projects to a stretched team' },
  { id: 'feedback', label: 'Give feedback', note: 'One-to-one with a strong engineer whose behaviour slipped' },
]

/** The user's field, so the call is set in their kind of work. Mirrors `DOMAINS` in `modules/leadership/world.py`. */
export const LEADERSHIP_DOMAINS: { id: string; label: string; note: string }[] = [
  { id: 'software', label: 'Software & IT', note: 'Engineering, product, IT operations' },
  { id: 'marketing', label: 'Marketing', note: 'Campaigns, brand, content, growth' },
  { id: 'sales', label: 'Sales', note: 'Accounts, targets, pipeline' },
  { id: 'finance', label: 'Finance & accounting', note: 'Close, audit, reporting, budgets' },
  { id: 'healthcare', label: 'Healthcare', note: 'Clinical teams, wards, clinics' },
  { id: 'operations', label: 'Operations & manufacturing', note: 'Plants, logistics, supply chain' },
  { id: 'education', label: 'Education', note: 'Schools, departments, faculty' },
  { id: 'customer_service', label: 'Customer service', note: 'Support teams, contact centres' },
  { id: 'hospitality', label: 'Hospitality & retail', note: 'Hotels, restaurants, stores' },
  { id: 'other', label: 'Other', note: 'Describe your field' },
]

export interface LeadershipSetup {
  /** The full simulation runs through several situations; a scenario practises one. */
  mode: 'full' | 'scenario'
  scenario?: LeadershipScenario
  /** The live call on the server (`backend/app/modules/leadership`), once it has been set up. */
  sessionId?: string
  /** Who is on the call, the one who speaks most first. */
  team?: { name: string; role: string; avatar: string }[]
  /** The manager's pre-read, shown before joining: what happened, who is there, what it is for. */
  briefing?: LeadershipBriefing
}

export interface LeadershipBriefing {
  title: string
  company: string
  situations: { label: string; whatHappened: string; yourGoal: string }[]
  people: { name: string; role: string; noticed: string }[]
  format: string
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
  scenario: NegotiationScenario
  /** With one person, or a group of three. */
  group: boolean
  mode: InterviewMode
  /** The user's own situation and goal (always for "Other"). */
  description?: string
  /** The live session on the server (`backend/app/modules/negotiation`), once it has been set up. */
  sessionId?: string
  /** Who is across the table, the one who leads first. */
  people?: { key: string; name: string; role: string }[]
  /** The user's pre-read, shown before joining. */
  briefing?: NegotiationBriefing
}

export interface NegotiationBriefing {
  title: string
  you: string
  org: string
  about: string
  situation: string
  /** The user's own side: what they want, their walk-away point, their alternatives. */
  position: string
  goal: string
  people: { name: string; role: string; known: string }[]
  format: string
}

export type MeetingRole = 'participant' | 'leader' | 'stakeholder'

export const MEETING_ROLES: { id: MeetingRole; label: string; note: string }[] = [
  { id: 'participant', label: 'Participant', note: 'Contribute, ask, and make your point heard' },
  { id: 'leader', label: 'Meeting leader', note: 'Run the agenda, keep time, drive to decisions' },
  { id: 'stakeholder', label: 'Client / stakeholder', note: 'Represent your interests to the team' },
]

export interface MeetingSetup {
  role: MeetingRole
  /** What the meeting is about. */
  topic: string
  /** With one colleague, or a group of three. */
  group: boolean
  mode: InterviewMode
  material?: AttachedFile
  /** The live session on the server (`backend/app/modules/meeting`), once it has been set up. */
  sessionId?: string
  /** Who else is in the meeting, the one who speaks most first. */
  people?: { key: string; name: string; role: string }[]
  /** The user's pre-read, shown before joining. */
  briefing?: MeetingBriefing
}

/** The pre-read for a meeting: a negotiation's parts (the user's aims as the position), and what to discuss. */
export type MeetingBriefing = NegotiationBriefing & {
  /** What the user should raise in the meeting, from their role, the topic and their material. */
  points?: string[]
}

export type PresentationFormat = 'small-room' | 'large-audience' | 'virtual' | 'academic' | 'defence'

/** The presentation a menu entry sets up: the business formats by their id, the university's by name. */
export const presentationFormatOf = (format: PracticeFormat): PresentationFormat =>
  format.id === 'academic-presentation'
    ? 'academic'
    : format.id === 'thesis-defence'
      ? 'defence'
      : (format.id as PresentationFormat)

/**
 * Presentations judged standing at a lectern, where posture and gestures are part of the analysis:
 * the camera check asks for the whole body there.
 */
export const presentsStanding = (format: PresentationFormat): boolean =>
  format === 'academic' || format === 'large-audience' || format === 'defence'

export interface PresentationSetup {
  format: PresentationFormat
  /** Questions on the talk and the slides (the audience listens), or on the slides alone. */
  questions: 'talk' | 'slides'
  title?: string
  /** The live session on the server (`backend/app/modules/presentation`), once it has been set up. */
  sessionId?: string
  /** The audience, the chair first. */
  people?: { key: string; name: string; role: string }[]
  briefing?: PresentationBriefing
}

export interface PresentationBriefing {
  title: string
  audience: string
  expects: string
  tips: string[]
  people: { name: string; role: string }[]
  format: string
  /** Whether the slides could be read (their text shapes the questions). */
  slides: boolean
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

/**
 * A scholarship or admission interview: the preparation it runs on (the researched opportunity,
 * the read application and the predicted questions) and, once the call exists, its session.
 */
export interface AdmissionSessionSetup {
  prepId: string
  /** The scholarship or programme, for the call's header. */
  opportunity: string
  sessionId?: string
  /** The candidate asked for feedback on how they come across, so the camera is on. */
  camera?: boolean
}

/**
 * A debate the user set up. The motion, both positions, the format and the
 * difficulty are all settled by the server; this is what the room needs to render
 * and what `describeSession` puts in the summary line.
 */
export interface DebateSetup {
  /** The motion, as it will be argued. */
  motion: string
  /** Which side each of you takes. */
  position: DebatePosition
  aiPosition: DebatePosition
  format: DebateFormatId
  difficulty: DebateDifficulty
  /** The prepared debate this came from, when it was prepared at all. */
  debateId?: string
  prepId?: string
  /** The server-side session; present once the debate can go live. */
  sessionId?: string
  /** Who argues the other side. */
  opponentName?: string
  /** One weakness this attempt leans on, when it was started from feedback. */
  focus?: DebateFocus
  /** The user asked for feedback on how they come across, so the camera is on. */
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
      // All three are the presentation screen (`PresentationCall`), with a live audience.
      destination: 'call',
      kind: 'presentation',
    },
    {
      id: 'large-audience',
      label: 'Large audience presentation',
      note: 'In the auditorium: tiered seats, a stage, a big screen',
      destination: 'call',
      kind: 'presentation',
    },
    {
      id: 'virtual',
      label: 'Virtual presentation',
      note: 'Straight into a video call, screen shared',
      destination: 'call',
      kind: 'presentation',
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
      // A live presentation (`PresentationCall`) in the lecture hall: present your thesis, then the
      // committee at the front table (the chair and two examiners) questions you on it.
      destination: 'call',
      kind: 'presentation',
    },
  ],
  // The other university sessions also take place in the lecture hall, its only room.
  'Scholarship / Admissions Interview': [
    {
      id: 'admissions-interview',
      label: 'Scholarship / admissions interview',
      note: 'Before the selection committee: your goals, your record, why you',
      // A video call with a professor from the committee, questioning you from your own file.
      destination: 'admission',
      // Its own kind: the preparation behind it researches the scholarship and reads the
      // candidate's application, which no other format does.
      kind: 'admission',
    },
  ],
  'Academic Presentation': [
    {
      id: 'academic-presentation',
      label: 'Academic presentation',
      note: 'Present your research from the lectern, then take questions from the room',
      // A live presentation (`PresentationCall`): the university classroom, a session chair and
      // academics asking about the research, recorded for feedback.
      destination: 'call',
      kind: 'presentation',
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
      note: 'Take a side and argue it against an opponent who argues back',
      // Its own screen: the two of you across a table, not a stage with an audience.
      destination: 'debate',
      kind: 'debate',
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
      // Online is a video call, in person the room: both are the negotiation screen, not the building.
      destination: 'call',
      kind: 'negotiation',
    },
  ],
  Meeting: [
    {
      id: 'team-meeting',
      label: 'Meeting practice',
      note: 'Your role, the topic, and any material to bring',
      // Online is a video call, in person the room: both are the meeting screen, not the building.
      destination: 'call',
      kind: 'meeting',
    },
  ],
  Leadership: [
    {
      id: 'leadership',
      label: 'Leadership practice',
      note: 'A full leadership simulation, or one specific scenario',
      // A video call with your team, like Zoom (LeadershipCall).
      destination: 'call',
      kind: 'leadership',
    },
  ],
  // The park's Story Course: each step a drill round (DrillStage), unlocked in order (PracticePicker).
  Storytelling: STORY_COURSE.map((id, i) => ({
    id,
    label: i === STORY_COURSE.length - 1 ? `★ ${DRILLS[id].title}` : `${i + 1}. ${DRILLS[id].title}`,
    note: DRILLS[id].goal,
    destination: 'drill' as const,
  })),
  // The Brain Lab: a live consultation with a neuroscientist coach (BrainLab, on the 'talk' screen).
  'Brain consultation': [
    {
      id: 'brain-consultation',
      label: 'Consultation with Dr. Maya Rahimi',
      note: 'What happens in your brain, and a plan that works',
      destination: 'talk',
      kind: 'brainlab',
    },
  ],
  // The Café & Restaurant: a live conversation at a table (CafeTalk); the situation is picked there.
  'Starting Conversations': [
    {
      id: 'cafe-starting',
      label: 'Start a conversation',
      note: 'A stranger, a new colleague, someone you met once',
      destination: 'talk',
      kind: 'cafe',
    },
  ],
  'Everyday Communication': [
    {
      id: 'cafe-everyday',
      label: 'Everyday conversations',
      note: 'Coffee with someone you admire, say no, disagree, a client dinner',
      destination: 'talk',
      kind: 'cafe',
    },
  ],
  // The Bus Stop: a short live conversation while waiting (BusStopTalk); the situation is picked there.
  'Small Talk': [
    {
      id: 'busstop-smalltalk',
      label: 'Small talk at the stop',
      note: 'The bus is late, a name you forgot, your bus arriving',
      destination: 'talk',
      kind: 'busstop',
    },
  ],
  'Help & Boundaries': [
    {
      id: 'busstop-boundaries',
      label: 'Help & boundaries',
      note: 'Ask a stranger for help, a pushy stranger, a queue jumper',
      destination: 'talk',
      kind: 'busstop',
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
  debate: 'the debating room',
  admission: 'the video call',
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
  presentation?: PresentationSetup
  negotiation?: NegotiationSetup
  meeting?: MeetingSetup
  networking?: NetworkingSetup
  emotional?: EmotionalSetup
  exam?: ExamSetup
  debate?: DebateSetup
  admission?: AdmissionSessionSetup
}

/** "Presentation · Small-room · Standing · 15 min", or "Interview · Behavioral · Online · Panel · 30 min" */

/** Mirrors `FORMAT_LABELS` and the difficulties in `backend/app/modules/debate/catalogs.py`. */
export const DEBATE_FORMAT_LABEL: Record<DebateFormatId, string> = {
  free: 'Free debate',
  structured: 'Structured debate',
  socratic: 'Socratic debate',
  oxford: 'Formal (Oxford-style)',
  devils_advocate: "Devil's advocate",
}

export const DEBATE_DIFFICULTY_LABEL: Record<DebateDifficulty, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

export const EXAM_STYLE_LABEL: Record<ExamStyle, string> = {
  oral_questions: 'The professor asks questions',
  board_work: 'Problems at the board',
  unknown: 'Format decided from your material',
}

export const describeSession = (s: SessionSetup) =>
  s.debate
    ? [
        s.debate.position === 'for' ? 'Arguing FOR' : 'Arguing AGAINST',
        DEBATE_FORMAT_LABEL[s.debate.format],
        DEBATE_DIFFICULTY_LABEL[s.debate.difficulty],
        `${s.minutes} min`,
      ].join(' · ')
    : s.exam
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
        s.negotiation.group ? 'Group' : 'One-to-one',
        s.negotiation.mode === 'online' ? 'Online' : 'In person',
        `${s.minutes} min`,
      ].join(' · ')
    : s.meeting
    ? [
        s.area,
        MEETING_ROLES.find((r) => r.id === s.meeting!.role)?.label,
        s.meeting.group ? 'Group' : 'One-to-one',
        s.meeting.mode === 'online' ? 'Online' : 'In person',
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

/**
 * Formats whose session puts a lip-synced face on screen (an interviewer, an examiner, a debate
 * opponent, a networking guest, anyone on a video call). Opening their setup starts the face server.
 */
export function showsLiveFace(format: PracticeFormat): boolean {
  // Every presentation audience has lip-synced faces (the auditorium's front row included).
  if (format.kind === 'presentation') return true
  return (
    format.destination === 'call' ||
    format.kind === 'interview' ||
    format.kind === 'exam' ||
    format.kind === 'debate' ||
    format.kind === 'networking' ||
    format.kind === 'admission' ||
    // The park: the friend on the bench is lip-synced live.
    format.kind === 'emotional' ||
    // The Brain Lab's neuroscientist.
    format.kind === 'brainlab' ||
    // The Café & Restaurant's people.
    format.kind === 'cafe' ||
    // The Bus Stop's people.
    format.kind === 'busstop'
  )
}
