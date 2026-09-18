import { appCheckToken } from '../appcheck'
import { env } from '../env'
import { idToken, refreshVerification } from '../firebase'

/** An RFC 9457 problem returned by the API. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail?: string
  readonly requestId?: string
  readonly extra: Record<string, unknown>

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.title === 'string' ? body.title : `Request failed (${status})`)
    this.status = status
    this.code = typeof body.code === 'string' ? body.code : 'http_error'
    this.detail = typeof body.detail === 'string' ? body.detail : undefined
    this.requestId = typeof body.requestId === 'string' ? body.requestId : undefined
    this.extra = body
  }
}

/**
 * Nothing this API does takes anywhere near this long, so a request still open
 * after it has stalled — a proxy socket that died under a restarted server, a
 * network that went away mid-flight — and the caller must be told, not left
 * waiting on a promise that will never settle.
 */
const TIMEOUT_MS = 30_000
/** Uploads carry a file, so they are measured in megabytes rather than milliseconds. */
const UPLOAD_TIMEOUT_MS = 180_000

/** The caller's own cancellation, plus a deadline of our own. */
function deadline(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('request timed out', 'TimeoutError')), ms)
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    },
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
}

async function send(path: string, options: RequestOptions, forceRefresh: boolean): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers, Authorization: `Bearer ${await idToken(forceRefresh)}` }
  const attest = await appCheckToken()
  if (attest) headers['X-Firebase-AppCheck'] = attest
  let body: BodyInit | undefined
  if (options.body instanceof FormData) {
    body = options.body
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  return fetch(`${env.apiBaseUrl}/api/v1${path}`, { method: options.method ?? 'GET', headers, body, signal: options.signal })
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T
  const text = await response.text()
  const data = text ? (JSON.parse(text) as unknown) : undefined
  if (!response.ok) throw new ApiError(response.status, (data ?? {}) as Record<string, unknown>)
  return data as T
}

/**
 * Authenticated JSON request; retries once with a refreshed token after an
 * expired-token 401. The deadline covers the whole exchange, body included, so
 * a stalled response surfaces as an error the UI can explain.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const timeout = deadline(options.signal, options.body instanceof FormData ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS)
  const attempt = { ...options, signal: timeout.signal }
  try {
    let response = await send(path, attempt, false)
    if (response.status === 401) response = await send(path, attempt, true)
    if (response.status === 403) {
      // Verified since this token was issued: refresh the profile and token, then try once more.
      const problem = (await response.clone().json().catch(() => null)) as { code?: string } | null
      if (problem?.code === 'email_not_verified' && (await refreshVerification().catch(() => false))) {
        response = await send(path, attempt, false)
      }
    }
    return await parse<T>(response)
  } finally {
    timeout.clear()
  }
}
