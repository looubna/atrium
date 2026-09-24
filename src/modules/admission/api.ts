import { api } from '@/platform/api/client'

/**
 * Scholarship and university admission interview preparation
 * (`backend/app/modules/admission`).
 *
 * The candidate names the opportunity and hands over whatever they have. Nothing here asks
 * them to classify a document or describe themselves: the server researches the scholarship
 * and reads the application, and this module only shows the work as it happens.
 */

/** What the candidate is preparing for. Mirrors `OpportunityKind` on the server. */
export type OpportunityKind = 'scholarship' | 'admission' | 'both'

export const KIND_LABELS: Record<OpportunityKind, string> = {
  admission: 'University admission',
  scholarship: 'Scholarship',
  both: 'University + scholarship',
}

/** What the server calls a kind: it names a university place `university`, where the picker says `admission`. */
export type ServerKind = OpportunityKind | 'university'

export const kindLabel = (kind: ServerKind): string => KIND_LABELS[kind === 'university' ? 'admission' : kind]

/** What each choice means, in the words the candidate would use about themselves. */
export const KIND_NOTES: Record<OpportunityKind, string> = {
  admission: 'A place on a programme: your academic record, your fit, your plan of study',
  scholarship: 'Funding: your motivation, what you would do with it, what you would give back',
  both: 'One interview that decides both',
}

export type StageId = 'research' | 'materials' | 'preparation'
export type StageState = 'pending' | 'running' | 'done' | 'skipped' | 'failed'
export type PreparationStatus = 'preparing' | 'ready' | 'failed'

export interface Stage {
  stage: StageId
  /** Written server-side as the work being done, so it reads the same everywhere. */
  label: string
  state: StageState
  /** Said only when it is worth saying — "Read 6 sources", not "OK". */
  note: string
}

export interface Preparation {
  id: string
  name: string
  kind: ServerKind
  cycle: string
  program: string
  status: PreparationStatus
  stages: Stage[]
  opportunityKey: string
  materialCount: number
}

export interface Material {
  id: string
  title: string
  source: 'upload' | 'link' | 'text'
  type: string
  /** What the analyzer decided the document is. Empty until it has read it. */
  typeLabel: string
  status: 'pending' | 'ready' | 'failed'
}

/** How firmly something about the opportunity is known. Mirrors `EvidenceTier`. */
export type EvidenceTier = 'official' | 'reported' | 'secondary' | 'inference'

export interface Insight {
  text: string
  tier: EvidenceTier
  sourceIds: string[]
  cycle: string
}

export interface Topic {
  text: string
  tier: EvidenceTier
  sourceIds: string[]
  /** How many separate accounts mention it; 0 when it comes from official pages. */
  accounts: number
}

export interface Source {
  id: string
  title: string
  domain: string
  tier: EvidenceTier
  published: string
}

export interface OpportunityProfile {
  name: string
  kind: ServerKind
  cycle: string
  summary: string
  officialRequirements: Insight[]
  selectionCriteria: Insight[]
  programPriorities: Insight[]
  interviewFormat: Insight[]
  interviewTopics: Topic[]
  selectedCandidatePatterns: Insight[]
  sources: Record<string, Source>
  /** What the evidence cannot support, in the candidate's own reading. Always shown. */
  caveats: string[]
}

/**
 * How a claim may be spoken to the candidate. The tier is not decoration: a requirement and
 * a stranger's recollection are both useful and must never read as the same kind of thing.
 */
export const TIER_LABELS: Record<EvidenceTier, string> = {
  official: 'Stated by the programme',
  reported: 'From applicants’ own accounts',
  secondary: 'From third-party write-ups',
  inference: 'Our reading of the evidence',
}

/** True once the candidate may be let through, whatever each stage managed. */
export const isReady = (prep: Preparation | null): boolean => prep?.status === 'ready'

/** True while any line of the checklist is still moving. */
export const isWorking = (prep: Preparation | null): boolean => prep?.status === 'preparing'

export const createPreparation = (name: string, kind: OpportunityKind, program = '') =>
  api<Preparation>('/admission/preparations', {
    method: 'POST',
    body: { id: crypto.randomUUID(), name, kind, program },
  })

export const listPreparations = () => api<Preparation[]>('/admission/preparations')

export const getPreparation = (prepId: string) => api<Preparation>(`/admission/preparations/${prepId}`)

export const deletePreparation = (prepId: string) =>
  api<void>(`/admission/preparations/${prepId}`, { method: 'DELETE' })

export const getOpportunity = (prepId: string) =>
  api<OpportunityProfile>(`/admission/preparations/${prepId}/opportunity`)

export const listMaterials = (prepId: string) => api<Material[]>(`/admission/preparations/${prepId}/materials`)

export function uploadMaterial(prepId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return api<Material>(`/admission/preparations/${prepId}/materials`, { method: 'POST', body: form })
}

export const addMaterialLink = (prepId: string, url: string, title = '') =>
  api<Material>(`/admission/preparations/${prepId}/materials/link`, {
    method: 'POST',
    body: { id: crypto.randomUUID(), url, title },
  })

export const addMaterialText = (prepId: string, text: string, title = '') =>
  api<Material>(`/admission/preparations/${prepId}/materials/text`, {
    method: 'POST',
    body: { id: crypto.randomUUID(), text, title },
  })

export const deleteMaterial = (prepId: string, materialId: string) =>
  api<void>(`/admission/preparations/${prepId}/materials/${materialId}`, { method: 'DELETE' })

/** §14. The first four claim support; the rest claim shape. */
export type QuestionCategory =
  | 'very_likely'
  | 'likely'
  | 'personalized'
  | 'follow_up'
  | 'challenging'
  | 'opportunity_specific'

export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  very_likely: 'Very likely',
  likely: 'Likely',
  personalized: 'About you',
  follow_up: 'Follow-up',
  challenging: 'Harder',
  opportunity_specific: 'About this one',
}

export interface Question {
  text: string
  category: QuestionCategory
  /** What in the research or their own file makes it likely (§15). */
  why: string[]
  /** What to have ready — evidence and connections, never a script. */
  prepare: string[]
}

export interface Differentiator {
  text: string
  why: string
  /** Their own claims it rests on; the section is empty rather than flattering. */
  evidence: string[]
  where: string[]
}

export interface Concern {
  text: string
  why: string
  prepare: string[]
}

export interface Story {
  past: string
  present: string
  program: string
  future: string
  /** Joins their documents do not make. */
  missingLinks: string[]
}

export interface PreparationPlan {
  questions: Question[]
  differentiators: Differentiator[]
  concerns: Concern[]
  story: Story
}

export const getPlan = (prepId: string) => api<PreparationPlan>(`/admission/preparations/${prepId}/plan`)

export const getCandidate = (prepId: string) =>
  api<Record<string, unknown>>(`/admission/preparations/${prepId}/candidate`)

/** The mock interview itself: a video call with a professor from the committee. */
export const createAdmissionSession = (prepId: string, durationMinutes = 20) =>
  api<{ id: string; maxDurationMs: number; professor: string }>('/admission/sessions', {
    method: 'POST',
    body: { id: crypto.randomUUID(), prepId, durationMinutes },
  })
