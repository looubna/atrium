import type { AvatarRenderer, AvatarState } from './types'

/** What the server hands back for one LiveTalking face (our own lip-sync server). */
export interface LiveTalkingConnection {
  /** The LiveTalking server, e.g. `http://localhost:8010`. */
  url: string
  /** Short-lived, signed by our backend; it names the recording this face may use. */
  token: string
}

/** How long the face may take to appear before the interview goes on without it. */
const JOIN_TIMEOUT_MS = 25_000

/**
 * An interviewer recorded seated at a desk, lip-synced live by our LiveTalking server.
 *
 * The server receives exactly the 24 kHz PCM the call plays (nothing from the candidate) and
 * streams back the person's video with that voice on it, from the same frames, so what the
 * candidate hears is locked to the lips. While nobody speaks it plays the recording of the
 * interviewer writing notes.
 */
export class LiveTalkingRenderer implements AvatarRenderer {
  readonly providesAudio = true
  readonly videoLagMs = 0
  readonly framing = 'office' as const

  private pc: RTCPeerConnection | null = null
  private socket: WebSocket | null = null
  private attaching: Promise<void> | null = null
  private video: HTMLVideoElement | null = null
  private stream: MediaStream | null = null
  private outbox: (string | ArrayBuffer)[] = []
  private state: AvatarState = 'listening'
  private disposed = false
  private ended = false
  private readonly endedListeners = new Set<(reason: string) => void>()
  private readonly release = () => this.dispose()

  constructor(private readonly session: LiveTalkingConnection) {}

  attach(video: HTMLVideoElement): Promise<void> {
    if (!this.attaching) {
      this.video = video
      this.attaching = this.connect(video)
      return this.attaching
    }
    // A face re-created elsewhere on the page takes over the same stream.
    return this.attaching.then(() => {
      if (this.disposed || !this.stream || this.video === video) return
      if (this.video) this.video.srcObject = null
      this.video = video
      video.muted = false
      video.srcObject = this.stream
      void video.play().catch(() => {})
    })
  }

  private async connect(video: HTMLVideoElement): Promise<void> {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    this.pc = pc
    const stream = new MediaStream()
    this.stream = stream
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    const gotVideo = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('the face did not appear')), JOIN_TIMEOUT_MS)
      pc.ontrack = (event) => {
        stream.addTrack(event.track)
        const target = this.video ?? video
        if (target.srcObject !== stream) target.srcObject = stream
        target.muted = false
        void target.play().catch(() => {})
        if (event.track.kind === 'video') {
          window.clearTimeout(timer)
          resolve()
        }
      }
    })
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.end(pc.connectionState)
    }

    await pc.setLocalDescription(await pc.createOffer())
    await iceGathered(pc)
    const response = await fetch(`${this.session.url}/atrium/offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: pc.localDescription?.sdp, type: 'offer', token: this.session.token }),
    })
    if (!response.ok) throw new Error(`the face server refused the session (${response.status})`)
    const answer = (await response.json()) as { sdp: string; type: RTCSdpType; sessionid: string }
    if (this.disposed) return
    await pc.setRemoteDescription({ sdp: answer.sdp, type: answer.type })
    this.openSocket(answer.sessionid)
    await gotVideo
    window.addEventListener('pagehide', this.release)
  }

  private openSocket(sessionId: string): void {
    const base = this.session.url.replace(/^http/, 'ws')
    const query = new URLSearchParams({ sessionid: sessionId, token: this.session.token })
    const socket = new WebSocket(`${base}/atrium/audio?${query}`)
    socket.binaryType = 'arraybuffer'
    this.socket = socket
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'state', state: this.state }))
      this.outbox.splice(0).forEach((frame) => socket.send(frame))
    }
    socket.onclose = () => {
      if (this.socket === socket) this.end('socket closed')
    }
  }

  private send(frame: string | ArrayBuffer): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(frame)
    else if (!this.disposed) this.outbox.push(frame)
  }

  pushAudio(_turnSeq: number, pcm: Int16Array): void {
    if (this.disposed || this.ended || pcm.length === 0) return
    // Everything goes over at once: the server plays it at speaking pace itself, and a queue
    // that never runs dry is what keeps its lips and its voice in step (a starved queue makes
    // it fill the gap with silence, which shifts one against the other).
    this.send(pcm.slice().buffer)
  }

  interrupt(): void {
    this.outbox = this.outbox.filter((frame) => typeof frame === 'string')
    this.send(JSON.stringify({ type: 'interrupt' }))
  }

  setState(state: AvatarState): void {
    // "speaking" is the lip-sync itself; the other states pick what plays in silence.
    if (state === 'speaking' || state === this.state) return
    this.state = state
    this.send(JSON.stringify({ type: 'state', state }))
  }

  onEnded(listener: (reason: string) => void): () => void {
    this.endedListeners.add(listener)
    return () => this.endedListeners.delete(listener)
  }

  private end(reason: string): void {
    if (this.disposed || this.ended) return
    this.ended = true
    this.endedListeners.forEach((listener) => listener(reason))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.endedListeners.clear()
    window.removeEventListener('pagehide', this.release)
    // Closing the socket ends the session on the server and frees its slot.
    const socket = this.socket
    this.socket = null
    socket?.close()
    this.pc?.close()
    this.pc = null
    if (this.video) this.video.srcObject = null
  }
}

/** The server answers once, without trickle ICE, so the offer carries every candidate. */
function iceGathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, 3_000)
    function done() {
      window.clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    function check() {
      if (pc.iceGatheringState === 'complete') done()
    }
    pc.addEventListener('icegatheringstatechange', check)
  })
}
