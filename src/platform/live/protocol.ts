/**
 * Wire format shared with the API's live gateway
 * (backend/app/platform/agents/live_protocol.py).
 *
 * Client binary frames: seq u32 | captureMs u32 | PCM16 mono 16 kHz, little-endian.
 * Server binary frames: turnSeq u32 | chunk u32 | PCM16 mono 24 kHz, little-endian.
 */

export const HEADER_BYTES = 8
export const CAPTURE_RATE = 16_000
export const PLAYBACK_RATE = 24_000

export const CloseCode = {
  NORMAL: 1000,
  PROTOCOL_ERROR: 4400,
  UNAUTHENTICATED: 4401,
  FORBIDDEN: 4403,
  NOT_FOUND: 4404,
  AUTH_TIMEOUT: 4408,
  CONFLICT: 4409,
  QUOTA: 4429,
  UNAVAILABLE: 4503,
} as const

/**
 * Why a 4403 closed the socket: the gateway sends one of these as the close reason
 * (`ForbiddenReason` in live_protocol.py). They are wire format — the candidate reads a different
 * message for each, and a socket closed for an unverified address is worth one more try on a
 * freshly minted token, where a missing consent is not.
 */
export const ForbiddenReason = {
  EMAIL_UNVERIFIED: 'email not verified',
  CONSENT_REQUIRED: 'consent_required',
  ACCOUNT_DELETING: 'account_deleting',
  ORIGIN: 'origin not allowed',
} as const

/** Closing for these reasons will not succeed on retry. */
export const FATAL_CLOSE_CODES: ReadonlySet<number> = new Set([
  CloseCode.PROTOCOL_ERROR,
  CloseCode.FORBIDDEN,
  CloseCode.NOT_FOUND,
  CloseCode.CONFLICT,
  CloseCode.QUOTA,
])

export type EndReason =
  | 'candidate_ended'
  | 'interviewer_ended'
  | 'time_limit'
  | 'quota_exhausted'
  | 'idle_timeout'
  | 'disconnected'

export type ServerMessage =
  | {
      type: 'ready'
      sessionId: string
      resumed: boolean
      maxDurationMs: number
      elapsedMs: number
      lastSeq: number
      coding: boolean
    }
  | { type: 'caption'; speaker: 'interviewer' | 'candidate'; text: string; final: boolean; turnSeq?: number }
  | { type: 'interrupted'; turnSeq: number }
  /** The next interviewer turn is a panel colleague's question, voiced by the server. */
  | { type: 'panel_speaker'; turnSeq: number; name: string }
  /** The examiner wrote on the board: a problem, its numbers, a formula. */
  | { type: 'board_write'; text: string; mediaMs: number }
  | { type: 'turn_complete'; turnSeq: number }
  | { type: 'time_left'; ms: number }
  | { type: 'reconnect_soon' }
  | { type: 'ended'; reason: EndReason }

export type ClientControl =
  | { type: 'playback_started'; turnSeq: number; mediaMs: number }
  | { type: 'playback_stopped'; turnSeq: number; mediaMs: number }
  | { type: 'code_snapshot'; mediaMs: number; language: string; text: string }
  /** The board as it was written by hand, so the examiner can read the working. */
  | { type: 'board_image'; mediaMs: number; jpegBase64: string }
  | { type: 'ping'; mediaMs: number }
  /** The candidate is in place: the interviewer may open (after `holdOpening`). */
  | { type: 'begin' }
  /** A presentation's speaker takes questions: the audience, silent until now, may speak. */
  | { type: 'release' }
  | { type: 'end' }

export function encodeAudioFrame(seq: number, captureMs: number, pcm: Int16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_BYTES + pcm.byteLength)
  const view = new DataView(buffer)
  view.setUint32(0, seq >>> 0, true)
  view.setUint32(4, Math.max(0, Math.round(captureMs)) >>> 0, true)
  const out = new Int16Array(buffer, HEADER_BYTES, pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i]
  return buffer
}

export interface ServerAudio {
  turnSeq: number
  chunk: number
  pcm: Int16Array
}

export function decodeServerAudio(buffer: ArrayBuffer): ServerAudio {
  if (buffer.byteLength < HEADER_BYTES || (buffer.byteLength - HEADER_BYTES) % 2 !== 0) {
    throw new RangeError('invalid audio frame')
  }
  const view = new DataView(buffer)
  const samples = (buffer.byteLength - HEADER_BYTES) / 2
  const pcm = new Int16Array(samples)
  for (let i = 0; i < samples; i++) pcm[i] = view.getInt16(HEADER_BYTES + i * 2, true)
  return { turnSeq: view.getUint32(0, true), chunk: view.getUint32(4, true), pcm }
}

export function parseServerMessage(text: string): ServerMessage | null {
  try {
    const data = JSON.parse(text) as { type?: unknown }
    return typeof data?.type === 'string' ? (data as ServerMessage) : null
  } catch {
    return null
  }
}
