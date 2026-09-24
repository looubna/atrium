import { api } from '@/platform/api/client'

/**
 * Debate practice: a motion, the documents it is argued from, the brief the debate is
 * prepared into, and the session itself (`backend/app/modules/debate`).
 *
 * Every setting below has a server-side default, so the simple screen sends a topic and
 * nothing else. The user classifies nothing: which side each of you argues, whether the
 * motion needs looking up, and what the motion finally reads as are all settled on the
 * server.
 */

export type DebatePosition = 'for' | 'against'
export type DebateFormatId = 'free' | 'structured' | 'socratic' | 'oxford' | 'devils_advocate'
export type DebateDifficulty = 'beginner' | 'intermediate' | 'advanced'
/** Who decides which side the user argues. */
export type DebatePositionMode = 'user' | 'assigned' | 'random'
export type DebateFocus =
  | 'none'
  | 'evidence'
  | 'rebuttals'
  | 'conciseness'
  | 'critical_thinking'
  | 'interruptions'

/** Mirrors `FOCUS_LABELS` in `backend/app/modules/debate/catalogs.py`. */
export const FOCUS_LABELS: Record<DebateFocus, string> = {
  none: 'A full debate',
  evidence: 'Evidence',
  rebuttals: 'Rebuttals',
  conciseness: 'Conciseness',
  critical_thinking: 'Critical thinking',
  interruptions: 'Handling interruptions',
}

export interface Debate {
  id: string
  topic: string
  /** The motion as it will be argued; set once the debate has been prepared. */
  motion: string | null
  status: 'draft' | 'preparing' | 'ready' | 'failed'
  format: DebateFormatId
  difficulty: DebateDifficulty
  positionMode: DebatePositionMode
  askedPosition: DebatePosition | null
  /** Both sides, settled by preparation. Null until then. */
  userPosition: DebatePosition | null
  aiPosition: DebatePosition | null
  durationMinutes: number
  /** The user's own research setting, when they set one. */
  researchEnabled: boolean | null
  /** Whether the motion would be looked up if the debate started now. */
  willResearch: boolean | null
  materialCount: number
  activePrepId: string | null
}

export interface DebateMaterial {
  id: string
  source: 'file' | 'link' | 'text'
  name: string
  url?: string | null
  status: 'processing' | 'ready' | 'failed'
  failureReason?: string | null
  sizeBytes?: number | null
}

export interface TopicSuggestion {
  motion: string
  area: string
  why: string
  /** False where only one side has an honest case; those make poor debates. */
  bothSidesArguable: boolean
  needsResearch: boolean
}

/** How firm a statement is. Never blurred: an opinion is never shown as a fact. */
export type ClaimType = 'fact' | 'source_based' | 'argument' | 'interpretation' | 'opinion'

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  fact: 'Established',
  source_based: 'A source says',
  argument: 'An argument',
  interpretation: 'An interpretation',
  opinion: 'An opinion',
}

export interface KeyFact {
  statement: string
  claimType: ClaimType
  sourceIds: string[]
  favours: 'for' | 'against' | 'neither'
  confidence: 'high' | 'medium' | 'low'
}

export interface DebateSource {
  id: string
  title: string
  domain: string
  /** 1 primary, 2 academic, 3 institutional, 4 journalism, 5 other. Sorted best first. */
  tier: number
}

export interface SideArgument {
  claim: string
  reason: string
  evidence: string
  /** The best objection to it — what the user should be ready for. */
  weakness: string
}

export interface ChallengeArea {
  area: string
  question: string
  why: string
}

/** What preparation has worked out so far; streamed while it works, so not final. */
export interface PreparationProgress {
  stage: 'starting' | 'reading' | 'researching' | 'briefing' | 'done'
  motion: string
  facts: string[]
  concepts: string[]
  notes: string
  sources: { title: string; domain: string }[]
  /** The AI service is busy and the step will be retried automatically. */
  busy?: boolean
}

/**
 * The preparation screen (§10). It shows the user their own side, the concepts, the
 * evidence and where they will be pressed — never the opponent's plan of attack.
 */
export interface Preparation {
  id: string
  status: 'queued' | 'preparing' | 'ready' | 'failed'
  failureReason?: string
  progress?: PreparationProgress | null
  motion?: string
  userPosition?: DebatePosition
  aiPosition?: DebatePosition
  positionMode?: DebatePositionMode
  researchEnabled?: boolean
  topicContext?: string
  concepts?: string[]
  keyFacts?: KeyFact[]
  sources?: DebateSource[]
  searchSuggestionsHtml?: string | null
  /** What they should be ready to defend: their own side, with each argument's weak point. */
  yourArguments?: SideArgument[]
  challengeAreas?: ChallengeArea[]
  caveats?: string[]
  materialSummary?: string | null
  materialContradictions?: string[]
  materialTopics?: { motion: string; why: string; materialTakesSide: string }[]
  /** Claims the brief wanted to call facts but had no source for; kept honest. */
  unsourcedClaims?: string[]
}

export interface DebateSessionCreated {
  id: string
  maxDurationMs: number
  motion: string
  userPosition: DebatePosition
  aiPosition: DebatePosition
  format: DebateFormatId
  difficulty: DebateDifficulty
  opponentName: string
}

// -- topics -------------------------------------------------------------------

/** The server writes these with the model inline: up to 30 s, plus its retries when the model is busy. */
const SUGGEST_TIMEOUT_MS = 90_000

export const suggestTopics = (interest = '') =>
  api<{ topics: TopicSuggestion[] }>('/debate/topics:suggest', {
    method: 'POST',
    body: { interest },
    timeoutMs: SUGGEST_TIMEOUT_MS,
  })

// -- debates ------------------------------------------------------------------

export const createDebate = (body: {
  topic?: string
  format?: DebateFormatId
  difficulty?: DebateDifficulty
  positionMode?: DebatePositionMode
  position?: DebatePosition
  durationMinutes?: number
  researchEnabled?: boolean | null
}) => api<Debate>('/debate/debates', { method: 'POST', body: { id: crypto.randomUUID(), ...body } })

export const listDebates = () => api<Debate[]>('/debate/debates')

export const getDebate = (debateId: string) => api<Debate>(`/debate/debates/${debateId}`)

/** Change the settings before the debate is prepared; a prepared one answers 409. */
export const updateDebate = (
  debateId: string,
  body: Partial<{
    topic: string
    format: DebateFormatId
    difficulty: DebateDifficulty
    positionMode: DebatePositionMode
    position: DebatePosition
    durationMinutes: number
    researchEnabled: boolean
  }>,
) => api<Debate>(`/debate/debates/${debateId}`, { method: 'PATCH', body })

export const deleteDebate = (debateId: string) =>
  api<void>(`/debate/debates/${debateId}`, { method: 'DELETE' })

// -- what it is argued from ---------------------------------------------------

export const listDebateMaterials = (debateId: string) =>
  api<DebateMaterial[]>(`/debate/debates/${debateId}/materials`)

export function uploadDebateMaterial(debateId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return api<DebateMaterial>(`/debate/debates/${debateId}/materials`, { method: 'POST', body: form })
}

export const addDebateLink = (debateId: string, url: string, title = '') =>
  api<DebateMaterial>(`/debate/debates/${debateId}/materials/link`, {
    method: 'POST',
    body: { id: crypto.randomUUID(), url, title },
  })

export const addDebateText = (debateId: string, text: string, title = '') =>
  api<DebateMaterial>(`/debate/debates/${debateId}/materials/text`, {
    method: 'POST',
    body: { id: crypto.randomUUID(), text, title },
  })

export const deleteDebateMaterial = (debateId: string, materialId: string) =>
  api<void>(`/debate/debates/${debateId}/materials/${materialId}`, { method: 'DELETE' })

// -- preparation --------------------------------------------------------------

export const prepareDebate = (debateId: string) =>
  api<{ prepId: string; status: string }>(`/debate/debates/${debateId}/preparations:generate`, {
    method: 'POST',
  })

export const getPreparation = (debateId: string, prepId: string) =>
  api<Preparation>(`/debate/debates/${debateId}/preparations/${prepId}`)

// -- the debate itself --------------------------------------------------------

export const createDebateSession = (body: {
  debateId?: string
  prepId?: string
  topic?: string
  format?: DebateFormatId
  difficulty?: DebateDifficulty
  positionMode?: DebatePositionMode
  position?: DebatePosition
  durationMinutes?: number
  focus?: DebateFocus
  camera?: boolean
}) =>
  api<DebateSessionCreated>('/debate/sessions', {
    method: 'POST',
    body: { id: crypto.randomUUID(), ...body },
  })

/** The four ways to debate again after feedback (§31). */
export type AgainMode = 'again' | 'switch' | 'harder' | 'focus'

export const debateAgain = (sessionId: string, mode: AgainMode, focus: DebateFocus = 'none') =>
  api<DebateSessionCreated>(`/debate/sessions/${sessionId}/again`, {
    method: 'POST',
    body: { id: crypto.randomUUID(), mode, focus },
  })

// -- the argument map, after the debate --------------------------------------

/** Marks the app renders next to a part of an argument. */
export type ArgumentFlag =
  | 'unsupported'
  | 'assumption'
  | 'evidence_ok'
  | 'evidence_vague'
  | 'unanswered'
  | 'evaded'
  | 'contradicted'
  | 'conceded'

export interface MapChallenge {
  id: string
  target: string
  text: string
  atMs: number
  answered: boolean
  quality: string
  pressed: number
  response: { claim: string; atMs: number } | null
}

export interface MapArgument {
  id: string
  claim: string
  atMs: number
  turn: number
  support: 'supported' | 'unsupported' | 'asserted'
  reasons: string[]
  evidence: { text: string; specific: boolean; attribution: string; claimType: ClaimType }[]
  assumptions: string[]
  conclusion: string
  flags: ArgumentFlag[]
  challenges: MapChallenge[]
}

export interface ArgumentMap {
  motion: string
  userPosition: DebatePosition
  aiPosition: DebatePosition
  arguments: MapArgument[]
  opponentArguments: { id: string; claim: string; atMs: number; turn: number }[]
  contradictions: { earlier: string; later: string; why: string; atMs: number; raised: boolean }[]
  concessions: { side: 'user' | 'ai'; text: string; atMs: number; keptPosition: boolean }[]
  definitions: { term: string; meaning: string; agreed: boolean }[]
  unansweredChallenges: { id: string; text: string; target: string; atMs: number }[]
  topicsCovered: string[]
  counts: Record<string, number>
}

/** What "practise this" offers next, decided from the debate rather than guessed. */
export interface NextPractice {
  harderDifficulty: DebateDifficulty
  suggestedFocus: DebateFocus
}

export const FLAG_LABEL: Record<ArgumentFlag, string> = {
  unsupported: 'No evidence given',
  assumption: 'Rests on an assumption',
  evidence_ok: 'Specific evidence',
  evidence_vague: 'Vague evidence',
  unanswered: 'Objection unanswered',
  evaded: 'Answered a different question',
  contradicted: 'Contradicts an earlier claim',
  conceded: 'You gave this up',
}

/** Flags that are a strength rather than something to work on. */
export const GOOD_FLAGS: ArgumentFlag[] = ['evidence_ok']
