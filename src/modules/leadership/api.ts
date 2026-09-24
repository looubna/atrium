import type { LeadershipBriefing, LeadershipScenario } from '@/data/practice'
import { api } from '@/platform/api/client'

/**
 * Leadership calls (`backend/app/modules/leadership`): a video call the user leads with their
 * team, the full simulation or one scenario. The team is played live on `/sessions/{id}/live`.
 */
export const createLeadershipSession = (body: {
  mode: 'full' | 'scenario'
  scenario?: LeadershipScenario
  durationMinutes: number
  /** A `LEADERSHIP_DOMAINS` id, or the user's own words; and their job title. */
  domain?: string
  jobTitle?: string
}) =>
  api<{
    id: string
    maxDurationMs: number
    team: { name: string; role: string; avatar: string }[]
    briefing: LeadershipBriefing
  }>(
    '/leadership/sessions',
    { method: 'POST', body: { id: crypto.randomUUID(), ...body } },
  )
