import type { EmotionalPartner, EmotionalScenario } from '@/data/practice'
import { api } from '@/platform/api/client'

/** A situation's brief: the example, what the user is there to do (in it, or in their own), three techniques. */
export interface EmotionalBrief {
  example: string
  goal: string
  ownGoal: string
  tips: string[]
}

/** Read before the conversation starts; creates nothing. */
export const getEmotionalBrief = (scenario: EmotionalScenario) =>
  api<EmotionalBrief>(`/emotional/briefs/${scenario}`)

/**
 * Park conversations (`backend/app/modules/emotional`): one session per sit-down on the bench.
 * The friend is played live on `/sessions/{id}/live`; `landscape` picks which cut of the park
 * footage their lip-synced face is painted on; `ownSituation` is the user's own story to practise
 * instead of the example ("" for the example).
 */
export const createEmotionalSession = (
  partner: EmotionalPartner,
  scenario: EmotionalScenario,
  minutes: number,
  landscape: boolean,
  ownSituation: string,
) =>
  api<{ id: string; maxDurationMs: number }>('/emotional/sessions', {
    method: 'POST',
    body: { id: crypto.randomUUID(), partner, scenario, minutes, landscape, ownSituation },
  })

/** What the page saw of the friend's face over the last few seconds; logged on the server only. */
export interface FaceDiagnostics {
  atS: number
  decoded: number
  dropped: number
  stalled: boolean
  playedS: number
  trackState: string
  trackMuted: boolean
  longestTaskMs: number
  speaking: boolean
  recoveries: number
}

export const sendFaceDiagnostics = (sessionId: string, report: FaceDiagnostics) =>
  api<void>(`/emotional/sessions/${sessionId}/diagnostics`, { method: 'POST', body: report })
