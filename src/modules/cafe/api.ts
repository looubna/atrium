import { api } from '@/platform/api/client'

/**
 * Café & Restaurant conversations (`backend/app/modules/cafe`): one session per conversation, played
 * live on `/sessions/{id}/live`; the feedback is the platform's report, as after the Park.
 */
export type CafeArea = 'starting' | 'everyday'

/** The practice area (src/data/locations.ts) each café area stands for. */
export const CAFE_AREA_OF: Record<string, CafeArea> = {
  'Starting Conversations': 'starting',
  'Everyday Communication': 'everyday',
}

export interface CafeScenario {
  id: string
  label: string
  /** Who the user talks with: one person per situation, filmed in its place. */
  name: string
  /** The situation, from the user's side, and what they are there to do. */
  example: string
  goal: string
  /** Evidence-based techniques for it, each with its studies. */
  tips: { name: string; how: string; evidence: string; studies: { cite: string; title: string; url: string }[] }[]
}

export const getCafeScenarios = (area: CafeArea) => api<CafeScenario[]>(`/cafe/scenarios?area=${area}`)

export const createCafeSession = (scenario: string, own: string, minutes: number, landscape: boolean) =>
  api<{ id: string; maxDurationMs: number }>('/cafe/sessions', {
    method: 'POST',
    body: { id: crypto.randomUUID(), scenario, own, minutes, landscape },
  })
