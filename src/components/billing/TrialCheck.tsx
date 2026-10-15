import { useEffect } from 'react'
import { checkTrial } from '@/modules/billing/api'
import { useAuthUser } from '@/platform/auth/useAuthUser'
import { deviceId } from '@/platform/billing/purchases'

const DONE_KEY = 'atrium.trialChecked.'

/**
 * Right after sign-in, asks the server once whether this account gets the free trial
 * (backend/app/platform/trial.py). Renders nothing, and never blocks anything: if the check fails the
 * account simply keeps its trial, and the server only decides once per account anyway.
 */
export function TrialCheck() {
  const { user } = useAuthUser()
  const uid = user?.uid
  useEffect(() => {
    if (!uid) return
    try {
      if (localStorage.getItem(DONE_KEY + uid)) return
    } catch {
      // Storage unavailable: ask anyway; the server answers the same every time.
    }
    let dropped = false
    void deviceId()
      .then((id) => checkTrial(id))
      .then(() => {
        if (dropped) return
        try {
          localStorage.setItem(DONE_KEY + uid, '1')
        } catch {
          // Not remembered on this device; harmless.
        }
      })
      .catch(() => {})
    return () => {
      dropped = true
    }
  }, [uid])
  return null
}
