import { Capacitor } from '@capacitor/core'
import { registerAppCheckSource } from './appcheck'
import { firebase } from './firebase'

/**
 * Native capabilities of the iOS app. Every function is a no-op or a web
 * fallback outside the native shell, and plugins load only when used.
 */
export const isNative = (): boolean => Capacitor.isNativePlatform()

export async function signInWithAppleNative(): Promise<void> {
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
  const { OAuthProvider, signInWithCredential } = await import('firebase/auth')
  const result = await FirebaseAuthentication.signInWithApple({ skipNativeAuth: true })
  const idToken = result.credential?.idToken
  if (!idToken) throw new Error('Sign in with Apple was cancelled')
  const credential = new OAuthProvider('apple.com').credential({ idToken, rawNonce: result.credential?.nonce })
  await signInWithCredential(firebase().auth, credential)
}

export async function signInWithGoogleNative(): Promise<void> {
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
  const { GoogleAuthProvider, signInWithCredential } = await import('firebase/auth')
  const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true })
  const idToken = result.credential?.idToken
  if (!idToken) throw new Error('Google sign-in was cancelled')
  await signInWithCredential(firebase().auth, GoogleAuthProvider.credential(idToken, result.credential?.accessToken))
}

/** Apple requires apps to revoke Sign in with Apple tokens when an account is deleted. */
export async function revokeAppleTokenNative(): Promise<void> {
  if (!isNative()) return
  const user = firebase().auth.currentUser
  if (!user?.providerData.some((provider) => provider.providerId === 'apple.com')) return
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication')
  const result = await FirebaseAuthentication.signInWithApple({ skipNativeAuth: true })
  const token = result.credential?.accessToken
  if (token) await FirebaseAuthentication.revokeAccessToken({ token })
}

let appCheckStarted = false

/**
 * App Attest tokens exist only on the native side. They are handed to the API
 * (X-Firebase-AppCheck, WebSocket auth) and to the Firebase JS SDK through a
 * custom provider, so Firestore listeners keep working with enforcement on.
 */
export async function startNativeAppCheck(): Promise<void> {
  if (!isNative() || appCheckStarted) return
  appCheckStarted = true
  const { FirebaseAppCheck } = await import('@capacitor-firebase/app-check')
  // Debug builds use the debug provider (register the token printed in Xcode's console).
  await FirebaseAppCheck.initialize({ debugToken: import.meta.env.DEV, isTokenAutoRefreshEnabled: true })

  const getToken = async () => {
    const result = await FirebaseAppCheck.getToken()
    return { token: result.token, expireTimeMillis: result.expireTimeMillis ?? Date.now() + 30 * 60_000 }
  }
  registerAppCheckSource(async () => (await getToken()).token)

  const { CustomProvider, initializeAppCheck } = await import('firebase/app-check')
  initializeAppCheck(firebase().app, { provider: new CustomProvider({ getToken }), isTokenAutoRefreshEnabled: true })
}

/** Keeps the screen on during a live interview. */
export async function setKeepAwake(on: boolean): Promise<void> {
  if (!isNative()) return
  const { KeepAwake } = await import('@capacitor-community/keep-awake')
  await (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep())
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('could not read file'))
    reader.readAsDataURL(blob)
  })
}

/** Saves a file the user asked to download: a browser download on the web, the share sheet in the app. */
export async function saveFile(url: string, filename: string): Promise<void> {
  if (!isNative()) {
    const link = document.createElement('a')
    link.href = url
    link.rel = 'noopener'
    link.download = filename
    link.click()
    return
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`download failed (${response.status})`)
  const data = await blobToBase64(await response.blob())
  const [{ Directory, Filesystem }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
  const { uri } = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache })
  await Share.share({ title: filename, files: [uri] })
}
