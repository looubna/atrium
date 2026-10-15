import { api } from '@/platform/api/client'

/**
 * Brain Lab consultations (`backend/app/modules/brainlab`): one session per consultation, played
 * live on `/sessions/{id}/live`; the Brain Plan is written after the report.
 */
export type BrainFocus = 'speaking-confidence' | 'motivation-habits' | 'own'

export const BRAIN_FOCUSES: { id: BrainFocus; label: string; note: string }[] = [
  { id: 'speaking-confidence', label: 'Speaking with confidence', note: 'Nerves, freezing, a shaking voice' },
  { id: 'motivation-habits', label: 'Motivation and habits', note: 'Starting, keeping going, distraction' },
  { id: 'own', label: 'Something of my own', note: 'Tell her what you want to change' },
]

export interface BrainPlan {
  /** The issue the user brought, in their words. */
  summary?: string
  /** What is happening in their brain or body, each with the studies behind it. */
  insights?: { point: string; sources: string[] }[]
  /** The evidence-based techniques that solve their issue: why for them, how, when, and the studies. */
  solutions?: {
    technique: string
    name: string
    whyForYou: string
    steps: string[]
    when: string
    evidence: string
    sources: { cite: string; title: string; url: string }[]
  }[]
  goal: string
  obstacle: string
  ifThen: { when: string; then: string }[]
  routine: { sighs: number; line: string }
  /** Easiest first; each a room in the app (`formatId` is a PRACTICE_FORMATS id). */
  ladder: { step: string; room: string; label: string; locationId: string; formatId: string }[]
  techniques: string[]
  /** The verified studies behind each technique in the plan (backend brainlab/evidence.py). */
  sources?: { technique: string; cite: string; title: string; url: string }[]
  note: string
  sessionId?: string
  createdAt?: string
}

export const createBrainSession = (focus: BrainFocus, own: string, minutes: number, landscape: boolean) =>
  api<{ id: string; maxDurationMs: number }>('/brainlab/sessions', {
    method: 'POST',
    body: { id: crypto.randomUUID(), focus, own, minutes, landscape },
  })

export const getSessionPlan = (sessionId: string) =>
  api<{ processingStatus: string | null; plan: BrainPlan | null }>(`/brainlab/sessions/${sessionId}/plan`)

export const getLatestPlan = () => api<{ plan: BrainPlan | null }>('/brainlab/plan')

/** The techniques by id, as she names them (backend expert.TECHNIQUES). */
export const TECHNIQUE_NAMES: Record<string, string> = {
  reappraisal: 'Stress reappraisal',
  sigh: 'The physiological sigh',
  ladder: 'A fear ladder',
  woop: 'WOOP',
  identity: 'If-then plans and self-affirmation',
  rewards: 'Cue, routine, reward',
  attention: 'Noticing and returning',
}
