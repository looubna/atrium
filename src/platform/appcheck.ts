/**
 * App Check token source. The native app registers a provider backed by App
 * Attest (via the Capacitor plugin) at startup; until one is registered no
 * header is sent, which the API accepts only where enforcement is off.
 */
type TokenSource = () => Promise<string | undefined>

let source: TokenSource | null = null

export function registerAppCheckSource(next: TokenSource): void {
  source = next
}

export async function appCheckToken(): Promise<string | undefined> {
  if (!source) return undefined
  try {
    return await source()
  } catch {
    // The API rejects the request if App Check is enforced; never block on a token failure here.
    return undefined
  }
}
