import { api } from '@/platform/api/client'

/**
 * Networking conversations (`backend/app/modules/networking`): one session per guest the user
 * walks up to. The guest is played live on `/sessions/{id}/live`, like an interviewer.
 */
export const createNetworkingSession = (guestId: string, roleVisible: boolean) =>
  api<{ id: string; maxDurationMs: number }>('/networking/sessions', {
    method: 'POST',
    body: { id: crypto.randomUUID(), guestId, roleVisible },
  })
