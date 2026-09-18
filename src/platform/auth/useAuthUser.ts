import { onIdTokenChanged, type User } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { firebase, firebaseConfigured, refreshVerification } from '../firebase'

export interface AuthState {
  /** False until Firebase has restored (or ruled out) a saved sign-in. */
  ready: boolean
  user: User | null
  /** This build has Firebase configuration; accounts are available. */
  configured: boolean
}

export function useAuthUser(): AuthState {
  const configured = firebaseConfigured()
  // `version` re-renders on token refreshes: the SDK updates the same User object in place.
  const [state, setState] = useState<{ ready: boolean; user: User | null; version: number }>({
    ready: !configured,
    user: null,
    version: 0,
  })

  useEffect(() => {
    if (!configured) return
    const auth = firebase().auth
    const unsubscribe = onIdTokenChanged(auth, (user) =>
      setState((current) => ({ ready: true, user, version: current.version + 1 })),
    )
    // The verification link opens elsewhere; check again whenever the app comes back into view.
    const recheck = () => {
      const user = auth.currentUser
      if (document.visibilityState === 'visible' && user && !user.emailVerified) {
        void refreshVerification().catch(() => {})
      }
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [configured])

  return { ready: state.ready, user: state.user, configured }
}
