import { api } from '@/platform/api/client'

/**
 * Bus Stop conversations (`backend/app/modules/busstop`): one session per conversation, played
 * live on `/sessions/{id}/live`; the feedback is the platform's report, as after the café.
 */
export type BusStopArea = 'smalltalk' | 'boundaries'

/** The practice area (src/data/locations.ts) each bus stop area stands for. */
export const BUSSTOP_AREA_OF: Record<string, BusStopArea> = {
  'Small Talk': 'smalltalk',
  'Help & Boundaries': 'boundaries',
}

export interface BusStopScenario {
  id: string
  label: string
  /** Who the user talks with: one person per situation. */
  name: string
  /** The situation, from the user's side, and what they are there to do. */
  example: string
  goal: string
  /** Evidence-based techniques for it, each with its studies. */
  tips: { name: string; how: string; evidence: string; studies: { cite: string; title: string; url: string }[] }[]
}

export const getBusStopScenarios = (area: BusStopArea) =>
  api<BusStopScenario[]>(`/busstop/scenarios?area=${area}`)

export const createBusStopSession = (scenario: string, own: string, minutes: number, landscape: boolean) =>
  api<{ id: string; maxDurationMs: number }>('/busstop/sessions', {
    method: 'POST',
    body: { id: crypto.randomUUID(), scenario, own, minutes, landscape },
  })
