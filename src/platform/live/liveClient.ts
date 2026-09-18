import {
  CloseCode,
  FATAL_CLOSE_CODES,
  decodeServerAudio,
  encodeAudioFrame,
  parseServerMessage,
  type ClientControl,
  type ServerAudio,
  type ServerMessage,
} from './protocol'

/** Keeps the most recent audio frames so a reconnect can resend what the server never received. */
export class FrameRingBuffer {
  private frames: { seq: number; captureMs: number; pcm: Int16Array }[] = []

  constructor(private readonly capacity: number) {}

  push(seq: number, captureMs: number, pcm: Int16Array): void {
    this.frames.push({ seq, captureMs, pcm })
    if (this.frames.length > this.capacity) this.frames.splice(0, this.frames.length - this.capacity)
  }

  after(seq: number): { seq: number; captureMs: number; pcm: Int16Array }[] {
    return this.frames.filter((f) => f.seq > seq)
  }
}

/** 0.5 s, 1 s, 2 s, 4 s, then 8 s between attempts. */
export const backoffMs = (attempt: number): number => Math.min(8000, 500 * 2 ** attempt)

export const MAX_RECONNECT_ATTEMPTS = 6

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'ended' | 'failed'

export interface LiveClientHandlers {
  onMessage: (message: ServerMessage) => void
  onAudio: (audio: ServerAudio) => void
  onStatus: (status: LiveStatus, closeCode?: number) => void
}

export interface LiveClientOptions extends LiveClientHandlers {
  url: string
  idToken: (forceRefresh: boolean) => Promise<string>
  appCheckToken: () => Promise<string | undefined>
  /** Injectable for tests. */
  createSocket?: (url: string) => WebSocket
}

/**
 * The app's side of the live gateway protocol: authenticate on the first
 * message, stream microphone frames, relay control messages, and reconnect
 * (resending recent frames) when the connection drops without a final close.
 */
export class LiveClient {
  private socket: WebSocket | null = null
  private attempts = 0
  private closedByUs = false
  private ended = false
  private forceTokenRefresh = false
  private readonly buffer = new FrameRingBuffer(120) // ~12 s at 100 ms frames
  private lastAckSeq = -1
  private ready = false

  constructor(private readonly options: LiveClientOptions) {}

  connect(): void {
    this.closedByUs = false
    this.options.onStatus(this.attempts === 0 ? 'connecting' : 'reconnecting')
    const socket = (this.options.createSocket ?? ((u: string) => new WebSocket(u)))(this.options.url)
    socket.binaryType = 'arraybuffer'
    this.socket = socket
    this.ready = false

    socket.onopen = async () => {
      try {
        const [token, attest] = await Promise.all([
          this.options.idToken(this.forceTokenRefresh),
          this.options.appCheckToken(),
        ])
        this.forceTokenRefresh = false
        socket.send(JSON.stringify({ type: 'auth', idToken: token, appCheckToken: attest ?? null }))
      } catch {
        socket.close()
      }
    }

    socket.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        try {
          this.options.onAudio(decodeServerAudio(event.data))
        } catch {
          /* a malformed frame is dropped, not fatal */
        }
        return
      }
      const message = parseServerMessage(String(event.data))
      if (!message) return
      if (message.type === 'ready') {
        this.ready = true
        this.attempts = 0
        this.lastAckSeq = message.lastSeq
        for (const frame of this.buffer.after(message.lastSeq)) {
          socket.send(encodeAudioFrame(frame.seq, frame.captureMs, frame.pcm))
        }
        this.options.onStatus('live')
      }
      if (message.type === 'ended') this.ended = true
      this.options.onMessage(message)
    }

    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return
      this.socket = null
      if (this.ended || event.code === CloseCode.NORMAL) {
        this.options.onStatus('ended', event.code)
        return
      }
      if (this.closedByUs) return
      if (FATAL_CLOSE_CODES.has(event.code)) {
        this.options.onStatus('failed', event.code)
        return
      }
      if (event.code === CloseCode.UNAUTHENTICATED) this.forceTokenRefresh = true
      if (this.attempts >= MAX_RECONNECT_ATTEMPTS) {
        this.options.onStatus('failed', event.code)
        return
      }
      const delay = backoffMs(this.attempts++)
      this.options.onStatus('reconnecting', event.code)
      setTimeout(() => {
        if (!this.closedByUs && !this.ended) this.connect()
      }, delay)
    }
  }

  /** Always buffered; sent immediately when the session is ready. */
  sendAudio(seq: number, captureMs: number, pcm: Int16Array): void {
    this.buffer.push(seq, captureMs, pcm)
    if (this.ready && this.socket?.readyState === WebSocket.OPEN && seq > this.lastAckSeq) {
      this.socket.send(encodeAudioFrame(seq, captureMs, pcm))
    }
  }

  send(control: ClientControl): void {
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(control))
  }

  /** Reconnect deliberately (e.g. before Cloud Run's connection limit) at a quiet moment. */
  reconnectNow(): void {
    const socket = this.socket
    if (!socket) return
    this.socket = null
    socket.onclose = null
    socket.close(1000)
    this.connect()
  }

  end(): void {
    this.send({ type: 'end' })
  }

  close(): void {
    this.closedByUs = true
    this.socket?.close(1000)
    this.socket = null
  }
}
