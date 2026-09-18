import { api, ApiError } from '@/platform/api/client'
import { env } from '@/platform/env'
import type { FaceSecond } from '@/platform/media/faceMetrics'

export type Severity = 'strength' | 'minor' | 'major' | 'critical'
export type ConfidenceLevel = 'high' | 'medium' | 'low'
export type ProcessingStatus =
  | 'none'
  | 'queued'
  | 'processing'
  | 'transcribing'
  | 'analyzing'
  | 'completed'
  | 'failed'

export interface FeedbackEvent {
  id: string
  timestampStart: number
  timestampEnd: number
  category: 'round' | 'communication'
  competencyId: string
  severity: Severity
  title: string
  observation: string
  whyItMatters: string
  recommendation: string
  example: string
  questionId: string | null
  responseId: string
  evidence: { quote: string; segmentIds: string[] }
  confidence: ConfidenceLevel
  priority: number
}

/** A measured fact next to a score, e.g. speaking rate against its target. */
export interface ScoreMetric {
  label: string
  value: number
  unit: string
  target: string
  verdict: string
  details?: string
}

export interface ScoreSummary {
  competencyId: string
  category: 'round' | 'communication'
  score: number
  confidence: ConfidenceLevel
  /** Why this score. */
  rationale?: string
  /** What was observed. */
  measured?: string
  /** What the score means, in one sentence. */
  meaning?: string
  toReach100?: string[]
  metric?: ScoreMetric | null
}

export interface DeltaSummary {
  competencyId: string
  score: number
  previous: number | null
  delta: number | null
}

export interface SessionView {
  id: string
  module: string
  context: Record<string, unknown>
  status: string
  processingStatus: ProcessingStatus
  failure: { step: string; retryable: boolean } | null
  attemptNo: number
  retryOfSessionId: string | null
  maxDurationMs: number
  endReason: string | null
  currentEvaluationRunId: string | null
  summary: {
    overallScore: number
    scores: ScoreSummary[]
    deltas: DeltaSummary[]
    eventCount: number
    strengths: string[]
    improvements: string[]
  } | null
  retryPlan: { competencyNames: string[] } | null
  media: {
    durationMs: number
    hasAudio: boolean
    deleted: boolean
    video: { state: VideoState; startedAtMediaMs: number } | null
  }
}

export type VideoState = 'uploading' | 'processing' | 'ready' | 'failed'
export type MediaKind = 'audio' | 'video'

export interface FeedbackResponse {
  session: SessionView
  evaluation: { overallScore: number; strengths: string[]; improvements: string[] } | null
  events: FeedbackEvent[]
  transcriptUrl?: string
  competencyNames?: Record<string, string>
}

export interface TranscriptSegment {
  id: string
  speaker: 'candidate' | 'interviewer'
  start_ms: number
  end_ms: number
  text: string
}

export const getFeedback = (sessionId: string) => api<FeedbackResponse>(`/sessions/${sessionId}/feedback`)

export const getPlaybackUrl = (sessionId: string, kind: MediaKind = 'audio') =>
  api<{ url: string; kind: MediaKind; expiresAt: string; startedAtMediaMs?: number }>(
    `/sessions/${sessionId}/media/playback-url?kind=${kind}`,
  )

export const getDownloadUrl = (sessionId: string, kind: MediaKind = 'audio') =>
  api<{ url: string; expiresAt: string; fileName: string }>(`/sessions/${sessionId}/media/download-url?kind=${kind}`)

export const createVideoUpload = (
  sessionId: string,
  body: { contentType: 'video/mp4' | 'video/webm'; sizeBytes: number; startedAtMediaMs: number },
) =>
  api<{ uploadId: string; uploadUrl: string; chunkBytes: number }>(`/sessions/${sessionId}/media/video-upload`, {
    method: 'POST',
    body,
  })

export type ExampleVoice = 'warm' | 'deep'

/** A spoken version of a moment's improved answer (synthesized once, then cached). */
export const getExampleAudio = (sessionId: string, eventId: string, voice: ExampleVoice = 'warm') =>
  api<{ url: string; expiresAt: string }>(`/sessions/${sessionId}/moments/${eventId}/example-audio?voice=${voice}`, {
    method: 'POST',
  })

/** Per-second face measurements from the device (numbers only, no images). */
export const saveFaceMetrics = (sessionId: string, seconds: FaceSecond[]) =>
  api<void>(`/sessions/${sessionId}/media/face-metrics`, { method: 'PUT', body: { seconds } })

export const completeVideoUpload = (sessionId: string, uploadId: string) =>
  api<{ state: VideoState }>(`/sessions/${sessionId}/media/video-complete`, { method: 'POST', body: { uploadId } })

export const reprocessSession = (sessionId: string) =>
  api<{ status: string }>(`/sessions/${sessionId}/reprocess`, { method: 'POST' })

export const retrySession = (sessionId: string) =>
  api<{ id: string; maxDurationMs: number }>(`/interview/sessions/${sessionId}/retry`, {
    method: 'POST',
    body: { id: crypto.randomUUID() },
  })

/** Signed links are absolute in the cloud and API-relative in local development. */
export const resolveMediaUrl = (url: string): string => (url.startsWith('/') ? `${env.apiBaseUrl}${url}` : url)

export async function fetchTranscript(url: string): Promise<TranscriptSegment[]> {
  const response = await fetch(resolveMediaUrl(url))
  if (!response.ok) throw new Error(`transcript unavailable (${response.status})`)
  const data = (await response.json()) as { segments?: TranscriptSegment[] }
  return data.segments ?? []
}

// -- resumes, applications and interview journeys ---------------------------------

export const ROUND_TYPES: { id: string; label: string }[] = [
  { id: 'screening', label: 'Recruiter / screening' },
  { id: 'behavioral', label: 'Behavioral' },
  { id: 'technical', label: 'Technical' },
  { id: 'coding', label: 'Coding' },
  { id: 'system_design', label: 'System design' },
  { id: 'case', label: 'Case' },
  { id: 'hiring_manager', label: 'Hiring manager' },
  { id: 'presentation', label: 'Presentation' },
  { id: 'take_home_review', label: 'Take-home review' },
  { id: 'other', label: 'Other' },
]

export const roundTypeLabel = (type: string, customLabel?: string): string =>
  (type === 'other' && customLabel) || ROUND_TYPES.find((t) => t.id === type)?.label || type

export interface ResumeItem {
  id: string
  fileName: string
  status: 'processing' | 'ready' | 'failed'
  /** While processing: reading the file, then summarising it. */
  stage?: 'reading' | 'summarising' | 'done' | null
  failureReason?: string | null
  currentTitle?: string | null
}

export interface BlueprintRound {
  id: string
  order: number
  type: string
  customLabel: string
  title: string
  format: string
  durationMin: number | null
  competencyIds: string[]
  questionFamilies: { name: string; description: string; exampleQuestions: string[] }[]
  reportedQuestions: { text: string; sourceIds: string[] }[]
  resumeFocus: string[]
  roleFocus: string[]
  companyFocus: string[]
  confidence: ConfidenceLevel
  rationale: string
  evidenceSourceIds: string[]
}

/** A round while the journey is still being written: display fields only. */
export interface DraftRound {
  order: number
  type: string
  customLabel: string
  title: string
  format: string
  durationMin: number | null
  confidence: ConfidenceLevel
}

/** What the strategist has found and written so far (streamed; not final). */
export interface BlueprintProgress {
  stage: 'starting' | 'research' | 'draft' | 'repair' | 'done'
  notes: string
  sources: { title: string; domain: string }[]
  queries: string[]
  summary: string
  rounds: DraftRound[]
  /** The AI service is busy and the step will be retried automatically. */
  busy?: boolean
}

export interface Blueprint {
  id: string
  status: 'queued' | 'researching' | 'ready' | 'failed'
  progress?: BlueprintProgress | null
  version: number
  source: 'agent' | 'user_edit'
  failureReason?: string
  processSummary?: string
  roleSummary?: string
  rounds?: BlueprintRound[]
  sources?: { id: string; title: string; domain: string; kind: string }[]
  caveats?: string[]
  searchSuggestionsHtml?: string
  competencyNames?: Record<string, string>
}

export interface RoundEdit {
  id?: string
  type: string
  customLabel?: string
  title: string
  format?: string
  durationMinutes?: number
}

export const listResumes = () => api<ResumeItem[]>('/interview/resumes')

export function uploadResume(file: File) {
  const form = new FormData()
  form.append('file', file)
  return api<ResumeItem>('/interview/resumes', { method: 'POST', body: form })
}

export const createApplication = (body: {
  company: string
  roleTitle: string
  location: string
  jobDescription: string
  resumeId: string | null
}) => api<{ id: string }>('/interview/applications', { method: 'POST', body: { id: crypto.randomUUID(), ...body } })

/** A job the user has set up; `activeBlueprintId` is its researched journey, once ready. */
export interface ApplicationItem {
  id: string
  company: string
  roleTitle: string
  location: string
  activeBlueprintId: string | null
  status: string
}

export const listApplications = () => api<ApplicationItem[]>('/interview/applications')

export const generateBlueprint = (applicationId: string) =>
  api<{ blueprintId: string }>(`/interview/applications/${applicationId}/blueprints:generate`, { method: 'POST' })

export const getBlueprint = (applicationId: string, blueprintId: string) =>
  api<Blueprint>(`/interview/applications/${applicationId}/blueprints/${blueprintId}`)

/** A preparation guide for one round: likely questions, how to answer, and ways to stand out. */
export interface RoundGuide {
  roundId: string
  approach: string
  questions: {
    question: string
    /** Publicly reported by candidates (with sources); otherwise a prediction. */
    reported: boolean
    sources: string[]
    assesses: string
    outline: string[]
    sampleAnswer: string
    resumeHook: string
    pitfalls: string[]
  }[]
  standOut: { title: string; idea: string; how: string; why: string; effort: 'quick' | 'prep' | 'project' }[]
  questionsToAsk: { question: string; why: string }[]
  /** The sample answers were built from the candidate's resume. */
  hasResume: boolean
}

const guideUrl = (applicationId: string, blueprintId: string, roundId: string) =>
  `/interview/applications/${applicationId}/blueprints/${blueprintId}/rounds/${roundId}/guide`

/** The written guide, or null when there is none yet. */
export async function getRoundGuide(applicationId: string, blueprintId: string, roundId: string): Promise<RoundGuide | null> {
  try {
    return await api<RoundGuide>(guideUrl(applicationId, blueprintId, roundId))
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/** Writes (or rewrites) the guide; takes a little while. */
export const writeRoundGuide = (applicationId: string, blueprintId: string, roundId: string) =>
  api<RoundGuide>(guideUrl(applicationId, blueprintId, roundId), { method: 'POST' })

export const editBlueprint = (applicationId: string, blueprint: Blueprint, rounds: RoundEdit[]) =>
  api<Blueprint>(`/interview/applications/${applicationId}/blueprints/${blueprint.id}`, {
    method: 'PUT',
    headers: { 'If-Match': `"${blueprint.version}"` },
    body: { rounds },
  })

export const createInterviewSession = (body: {
  practice?: 'general_behavioral'
  applicationId?: string
  blueprintId?: string
  roundId?: string
  mode: 'online' | 'in_person'
  panel: 'one_to_one' | 'panel'
  durationMinutes: number
}) => api<{ id: string; maxDurationMs: number }>('/interview/sessions', {
  method: 'POST',
  body: { id: crypto.randomUUID(), ...body },
})

/** An interviewer recorded seated at a desk, lip-synced by our own LiveTalking server. */
export interface AvatarSession {
  url: string
  token: string
  name: string
  role: string
  panel?: { name: string; role: string; url: string; token: string }[]
}

/** Modules that put a face on screen; each picks the person for its own kind of session. */
export type FaceModule = 'interview' | 'exam'

/**
 * Asks for a face for this session. The server picks the person and holds the
 * face server's secret; a 503 means no avatar, and the session runs on audio alone.
 */
export const getAvatarSession = (sessionId: string, module: FaceModule = 'interview') =>
  api<AvatarSession>(`/${module}/sessions/${sessionId}/avatar-session`, { method: 'POST' })

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${String(minutes).padStart(2, '0')}:${seconds}`
}
