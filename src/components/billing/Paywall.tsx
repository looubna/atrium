import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { cn } from '@/lib/utils'
import { getBillingStatus, PLAN_NAMES, redeemCode, syncBilling, type BillingStatus, type PlanId } from '@/modules/billing/api'
import { ApiError, onTrialUsed } from '@/platform/api/client'
import { firebase } from '@/platform/firebase'
import {
  canPurchase,
  configureStore,
  plansComingSoon,
  purchasePackage,
  restorePurchases,
  storePackages,
  type StorePackage,
} from '@/platform/billing/purchases'
import { Button } from '../ui/Button'

type Reason = 'minutes' | 'upgrade'

/** Opens the paywall from anywhere: when live minutes run out, or from the account sheet. */
export const usePaywall = create<{ open: Reason | null; show: (reason: Reason) => void; close: () => void }>((set) => ({
  open: null,
  show: (reason) => set({ open: reason }),
  close: () => set({ open: null }),
}))

// Any room refused because the free minutes are used up opens the paywall.
onTrialUsed(() => usePaywall.getState().show('minutes'))

/**
 * The plans, in the store's own order. Minutes are the server's (`backend/app/platform/plans.py`);
 * prices come from the store through RevenueCat, with these as the fallback before it answers.
 */
const PLANS: { plan: PlanId; productIds: string[]; minutes: string; note: string; price: string; best?: boolean }[] = [
  // Google Play ids ("product:basePlan") first, then Samsung Seller Portal's, then the RevenueCat Test Store's.
  { plan: 'pro', productIds: ['atrium_pro:monthly', 'atrium_pro', 'atrium_pro_monthly', 'Atrium_Pro', 'monthly'], minutes: '10 hours a month', note: 'Up to 1 hour a day · about 120 conversations', price: '$49.99' },
  { plan: 'pro_max', productIds: ['atrium_pro_max:monthly', 'atrium_pro_max', 'atrium_promax_monthly', 'Altrium_Max', 'monthly_2'], minutes: '20 hours a month', note: 'Up to 2 hours a day · about 240 conversations', price: '$89.99', best: true },
]

const RANK: Record<PlanId, number> = { free: 0, pro: 1, pro_max: 2, internal: 3 }

export function Paywall() {
  const open = usePaywall((s) => s.open)
  const close = usePaywall((s) => s.close)
  if (!open) return null
  return <PaywallSheet reason={open} onClose={close} />
}

function PaywallSheet({ reason, onClose }: { reason: Reason; onClose: () => void }) {
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [packages, setPackages] = useState<StorePackage[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [codeOn, setCodeOn] = useState(false)
  const [code, setCode] = useState('')

  useEffect(() => {
    let dropped = false
    getBillingStatus().then((s) => !dropped && setStatus(s)).catch(() => {})
    const uid = firebase().auth.currentUser?.uid
    if (uid && canPurchase()) {
      configureStore(uid)
        .then(storePackages)
        .then((list) => !dropped && setPackages(list))
        .catch(() => !dropped && setNote('The store is unavailable right now. Try again later.'))
    }
    return () => {
      dropped = true
    }
  }, [])

  const done = (next: BillingStatus, message: string) => {
    setStatus(next)
    setNote(message)
  }

  const buy = async (pkg: StorePackage | undefined) => {
    if (!pkg) return
    setBusy(pkg.productId)
    setNote(null)
    try {
      await purchasePackage(pkg.id)
      done(await syncBilling(), 'Thank you! Your new plan is active.')
    } catch {
      setNote('The purchase did not go through. You have not been charged.')
    } finally {
      setBusy(null)
    }
  }

  const restore = async () => {
    setBusy('restore')
    setNote(null)
    try {
      await restorePurchases()
      done(await syncBilling(), 'Purchases restored.')
    } catch {
      setNote('Nothing to restore on this account.')
    } finally {
      setBusy(null)
    }
  }

  const redeem = async () => {
    setBusy('code')
    setNote(null)
    try {
      done(await redeemCode(code.trim()), 'Code accepted. Enjoy!')
      setCodeOn(false)
    } catch (err) {
      setNote(
        err instanceof ApiError && err.code === 'promo_code_used'
          ? 'This code has already been used.'
          : err instanceof ApiError && err.status === 404
            ? "That code doesn't exist. Check the spelling."
            : 'The code could not be checked. Try again.',
      )
    } finally {
      setBusy(null)
    }
  }

  const current = status?.plan ?? 'free'
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-label="Plans">
      <div className="glass hud-inset anim-rise pointer-events-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl p-4">
        <p className="text-[15px] font-semibold text-chalk">
          {reason !== 'minutes'
            ? 'Plans'
            : status?.isTrial
              ? 'Your free minutes are used up'
              : status?.todayMinutesLeft === 0 && status.minutesLeft === 0
                ? "You've reached today's limit. It resets tomorrow."
                : "You've used this month's hours"}
        </p>
        <p className="mt-1 text-[12.5px] leading-snug text-mist">
          {status
            ? status.isTrial
              ? `${PLAN_NAMES[current]} · ${status.minutesLeft} of ${status.allowanceMinutes} free minutes left (one-time)`
              : `${PLAN_NAMES[current]} · ${status.minutesLeft} min left now · ${status.allowanceMinutes / 60} h a month`
            : 'Keep practising live conversations with feedback after each one.'}
        </p>

        <div className="mt-3 flex flex-col gap-2">
          {PLANS.map((p) => {
            const pkg = packages.find((x) => p.productIds.includes(x.productId))
            const owned = current === p.plan
            const lower = RANK[p.plan] < RANK[current]
            return (
              <div
                key={p.plan}
                className={cn('rounded-xl border px-3 py-2.5', p.best ? 'border-jade-400/50 bg-jade-400/8' : 'border-white/8 bg-white/4')}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13.5px] font-semibold text-chalk">
                    {PLAN_NAMES[p.plan]}
                    {p.best && <span className="ml-2 text-[10.5px] font-medium uppercase tracking-[0.12em] text-jade-400">Best value</span>}
                  </span>
                  <span className="text-[13px] font-semibold text-chalk">
                    {pkg?.price ?? p.price}
                    <span className="text-[11px] font-normal text-faint"> / month</span>
                  </span>
                </div>
                <div className="mt-0.5 text-[12px] text-mist">{p.minutes}</div>
                <div className="text-[11px] text-faint">{p.note}</div>
                {canPurchase() && (
                  <Button
                    variant={p.best ? 'primary' : 'ghost'}
                    className="mt-2 w-full"
                    disabled={owned || lower || !pkg || busy !== null}
                    onClick={() => void buy(pkg)}
                  >
                    {owned ? 'Your plan' : pkg && busy === pkg.productId ? 'Opening the store…' : lower ? 'Included in your plan' : 'Choose'}
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        {!canPurchase() && (
          <p className="mt-3 text-[12px] leading-snug text-mist">
            {plansComingSoon()
              ? 'Pro plans are coming soon. Have a code? Enter it below to keep practising.'
              : 'Plans are available in the Atrium app on Google Play.'}
          </p>
        )}
        {note && <p className="mt-3 text-[12px] text-chalk" role="status">{note}</p>}

        {codeOn ? (
          <div className="mt-3 flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Promo code"
              maxLength={40}
              className="min-w-0 flex-1 rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-[12.5px] text-chalk outline-none placeholder:text-faint focus:border-jade-400/40"
            />
            <Button variant="primary" disabled={code.trim().length < 4 || busy !== null} onClick={() => void redeem()}>
              {busy === 'code' ? 'Checking…' : 'Apply'}
            </Button>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
          <button type="button" onClick={onClose} className="font-medium text-mist hover:text-chalk">
            Close
          </button>
          <button type="button" onClick={() => setCodeOn((v) => !v)} className="font-medium text-jade-400 hover:underline">
            Have a code?
          </button>
          {canPurchase() && (
            <button type="button" disabled={busy !== null} onClick={() => void restore()} className="font-medium text-mist hover:text-chalk">
              Restore purchases
            </button>
          )}
        </div>
        <p className="mt-2 text-[10.5px] leading-snug text-faint">
          {!plansComingSoon() &&
            "Monthly subscription, renews automatically until cancelled in Google Play › Profile › Payments & subscriptions. Unused minutes don't carry over. "}
          <a href="/privacy.html" target="_blank" rel="noreferrer" className="underline">Privacy &amp; terms</a>
        </p>
      </div>
    </div>
  )
}
