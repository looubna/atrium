import type { NegotiationBriefing, NegotiationScenario } from '@/data/practice'
import { api } from '@/platform/api/client'

/**
 * Negotiation sessions (`backend/app/modules/negotiation`): a salary, a price, a contract, a
 * deadline, scope, a partnership or the user's own situation, with one person or a group, online or
 * in person. The other side is played live on `/sessions/{id}/live`.
 */
export const createNegotiationSession = (body: {
  scenario: NegotiationScenario
  group: boolean
  mode: 'online' | 'in-person'
  durationMinutes: number
  /** The user's own situation and what they want; their field or job. */
  description?: string
  field?: string
}) =>
  api<{
    id: string
    maxDurationMs: number
    people: { key: string; name: string; role: string }[]
    briefing: NegotiationBriefing
  }>('/negotiation/sessions', {
    method: 'POST',
    body: { id: crypto.randomUUID(), ...body },
    // Writing the negotiation for the user's situation can wait out a busy model (it retries for
    // up to a minute before falling back to the preset): longer than an ordinary request.
    timeoutMs: 90_000,
  })
