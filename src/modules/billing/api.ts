import { api } from '@/platform/api/client'

/**
 * Paid plans (`backend/app/platform/billing.py`). The server owns the plan: the app buys through the
 * store, then asks the server to re-check (`sync`); promo codes are redeemed on the server too.
 */
export type PlanId = 'free' | 'pro' | 'pro_max' | 'internal'

export interface BillingStatus {
  plan: PlanId
  subscription: PlanId
  renewsAt: string | null
  promoUntil: string | null
  allowanceMinutes: number
  minutesLeft: number
  /** The paid plans' daily fair-use line (None on the free trial). */
  todayMinutesLeft: number | null
  /** Free accounts: the minutes are a one-time trial, not monthly. */
  isTrial: boolean
}

export const PLAN_NAMES: Record<PlanId, string> = {
  free: 'Free trial',
  pro: 'Pro',
  pro_max: 'Pro Max',
  internal: 'Team',
}

export const getBillingStatus = () => api<BillingStatus>('/billing/status')
export const syncBilling = () => api<BillingStatus>('/billing/sync', { method: 'POST' })
/** Once, right after sign-in: does this account get the free trial (one per phone, no throwaway emails). */
export const checkTrial = (deviceId: string) =>
  api<BillingStatus>('/billing/trial-check', { method: 'POST', body: { deviceId } })
export const redeemCode = (code: string) => api<BillingStatus>('/billing/redeem', { method: 'POST', body: { code } })
