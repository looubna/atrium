import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  browserLocalPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'
import { env } from './env'

interface FirebaseServices {
  app: FirebaseApp
  auth: Auth
  db: Firestore
}

let services: FirebaseServices | null = null

export const firebaseConfigured = (): boolean => Boolean(env.firebase.apiKey && env.firebase.projectId)

/**
 * Initialized on first use, so a build without Firebase configuration still
 * boots the 3D experience. `initializeAuth` (not `getAuth`) loads no popup or
 * redirect resolver: inside the iOS WebView those flows are blocked, and native
 * sign-in hands credentials to `signInWithCredential` instead.
 */
export function firebase(): FirebaseServices {
  if (services) return services
  if (!firebaseConfigured()) throw new Error('Firebase is not configured for this build')
  const app = initializeApp(env.firebase)
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
  // Read-only listeners (status, blueprints, feedback, progress); every write goes through the API.
  const db = getFirestore(app)
  if (env.useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
  }
  services = { app, auth, db }
  return services
}

export class NotSignedIn extends Error {
  constructor() {
    super('not signed in')
    this.name = 'NotSignedIn'
  }
}

/**
 * Picks up an email address verified from the link (usually in another tab or on another
 * device): the SDK keeps the old profile and token until told otherwise. Reloads the profile
 * and, once verified, mints a token carrying `email_verified` for the API.
 */
export async function refreshVerification(): Promise<boolean> {
  const user = firebaseConfigured() ? firebase().auth.currentUser : null
  if (!user) return false
  await user.reload()
  if (user.emailVerified) await user.getIdToken(true)
  return user.emailVerified
}

/** ID token for API calls; the SDK refreshes it before expiry, or on demand after a 401. */
export async function idToken(forceRefresh = false): Promise<string> {
  const user = firebaseConfigured() ? firebase().auth.currentUser : null
  if (!user) throw new NotSignedIn()
  return user.getIdToken(forceRefresh)
}
