/**
 * Build-time configuration. Values come from `.env.<mode>` (public by design:
 * Firebase web config identifies a project, it authorizes nothing) and never
 * include secrets.
 */
const read = (key: string): string => (import.meta.env[key] as string | undefined)?.trim() ?? ''

export const env = {
  apiBaseUrl: read('VITE_API_BASE_URL').replace(/\/+$/, ''),
  useEmulators: read('VITE_USE_EMULATORS') === 'true',
  firebase: {
    apiKey: read('VITE_FIREBASE_API_KEY'),
    authDomain: read('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: read('VITE_FIREBASE_PROJECT_ID'),
    appId: read('VITE_FIREBASE_APP_ID'),
    messagingSenderId: read('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  },
} as const

/** Inside the Capacitor iOS shell (no dependency on the Capacitor package here). */
export const isNativeApp = (): boolean =>
  Boolean((globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.())

/** Absolute WebSocket URL for an API path, honouring a separate API origin. */
export function websocketUrl(path: string): string {
  const base = env.apiBaseUrl || globalThis.location.origin
  return `${base.replace(/^http/, 'ws')}${path}`
}
