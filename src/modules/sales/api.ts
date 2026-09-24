import type { SalesBriefing, SalesType } from '@/data/practice'
import { api } from '@/platform/api/client'

/**
 * Sales sessions (`backend/app/modules/sales`): a prospecting call, a pitch or demo, an account
 * review or an investor pitch, online or in person. The other side is played live on
 * `/sessions/{id}/live`.
 */
export const createSalesSession = (body: {
  type: SalesType
  mode: 'online' | 'in-person'
  durationMinutes: number
  /** What the user sells, their company and who they sell to: the deal is written for these. */
  product?: string
  company?: string
  customer?: string
}) =>
  api<{
    id: string
    maxDurationMs: number
    people: { key: string; name: string; role: string }[]
    briefing: SalesBriefing
  }>('/sales/sessions', { method: 'POST', body: { id: crypto.randomUUID(), ...body } })
