/**
 * Chunked, resumable upload of a large file (Cloud Storage's resumable upload
 * protocol; the local development server implements the same).
 *
 * Each chunk is a PUT with `Content-Range: bytes a-b/total`. The server answers
 * 308 with `Range: bytes=0-n` while it needs more, and 200/201 once the object
 * is complete. After a network error or a 5xx, the upload asks how much arrived
 * (`Content-Range: bytes * /total`) and continues from there.
 */

/** Cloud Storage requires every chunk except the last to be a multiple of 256 KiB. */
export const CHUNK_BYTES = 8 * 1024 * 1024

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export interface UploadOptions {
  chunkBytes?: number
  onProgress?: (sentBytes: number, totalBytes: number) => void
  signal?: AbortSignal
  maxRetries?: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

/** The next byte to send, from a 308 response's `Range: bytes=0-n` (absent: nothing stored yet). */
export function nextOffset(range: string | null): number {
  const match = range?.match(/^bytes=0-(\d+)$/)
  return match ? Number(match[1]) + 1 : 0
}

interface PutResult {
  done: boolean
  /** Where to continue, when the server said so. */
  next: number | null
  status?: number
}

const TRANSIENT = new Set([408, 429])

export async function uploadResumable(
  url: string,
  blob: Blob,
  contentType: string,
  options: UploadOptions = {},
): Promise<void> {
  const { chunkBytes = CHUNK_BYTES, onProgress, signal, maxRetries = 8 } = options
  const doFetch = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const total = blob.size
  if (total === 0) throw new UploadError('Nothing to upload')
  if (chunkBytes <= 0 || chunkBytes % (256 * 1024) !== 0) throw new UploadError('Chunk size must be a multiple of 256 KiB')

  const put = async (contentRange: string, body: Blob | null): Promise<PutResult> => {
    let response: Response
    try {
      response = await doFetch(url, {
        method: 'PUT',
        headers: body ? { 'Content-Type': contentType, 'Content-Range': contentRange } : { 'Content-Range': contentRange },
        body,
        signal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      return { done: false, next: null }
    }
    if (response.status === 200 || response.status === 201) return { done: true, next: total }
    if (response.status === 308) return { done: false, next: nextOffset(response.headers.get('Range')) }
    if (response.status >= 500 || TRANSIENT.has(response.status)) return { done: false, next: null, status: response.status }
    throw new UploadError(`The upload was rejected (${response.status})`, response.status)
  }

  let offset = 0
  let failures = 0
  for (;;) {
    signal?.throwIfAborted()
    const end = Math.min(offset + chunkBytes, total)
    const result = await put(`bytes ${offset}-${end - 1}/${total}`, blob.slice(offset, end))
    if (result.done) {
      onProgress?.(total, total)
      return
    }
    if (result.next !== null) {
      offset = result.next
      failures = 0
      onProgress?.(offset, total)
      continue
    }

    failures += 1
    if (failures > maxRetries) throw new UploadError('The upload kept failing', result.status)
    await sleep(Math.min(30_000, 1000 * 2 ** (failures - 1)))
    const probe = await put(`bytes */${total}`, null)
    if (probe.done) {
      onProgress?.(total, total)
      return
    }
    if (probe.next !== null) offset = probe.next
  }
}
