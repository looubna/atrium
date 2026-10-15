import { SpeakerVoice } from '../media/voiceFilter'
import type { AvatarRenderer, AvatarState } from './types'
import { faceIceServers } from './iceServers'

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
 * The same on Cloud Run, where a face can also be loaded from storage and a fresh instance sets itself up
 * first (~30 s in all). The loading screen covers the wait; giving up earlier dropped faces that were arriving.
 */
const CLOUD_RUN_JOIN_TIMEOUT_MS = 90_000
/** Above this RMS the face's own track is carrying her voice (it is silent between turns). */
const VOICE_RMS = 0.008
/** Gaps between words shorter than this still count as speaking. */
const VOICE_HOLD_MS = 250
const METER_INTERVAL_MS = 40

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
  private meter: { ctx: AudioContext; timer: number } | null = null
  private lastVoiceAt = -Infinity
  /** See setPlayoutBuffer; null keeps the browser's default. */
  private playoutBufferMs: number | null = null
  private readonly endedListeners = new Set<(reason: string) => void>()
  private readonly release = () => this.dispose()
  /** The face plays what it is sent, so the voice is shaped for the speakers before it goes. */
  private readonly voice = new SpeakerVoice()

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
    if (isCloudRun(this.session.url)) return this.connectCloudRun(video)
    // Direct first, and a TURN relay when the network blocks the direct route (see iceServers.ts).
    const pc = new RTCPeerConnection({ iceServers: await faceIceServers() })
    this.pc = pc
    const stream = new MediaStream()
    this.stream = stream
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    const gotVideo = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('the face did not appear')), JOIN_TIMEOUT_MS)
      pc.ontrack = (event) => {
        this.applyPlayoutBuffer()
        stream.addTrack(event.track)
        const target = this.video ?? video
        if (target.srcObject !== stream) target.srcObject = stream
        target.muted = false
        void target.play().catch(() => {})
        if (event.track.kind === 'audio') this.listen(event.track)
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

  /**
   * The face server on Cloud Run: there, two requests may reach two different instances and nothing
   * comes in over UDP. So the offer, the answer and then the voice all travel on one WebSocket
   * (`/atrium/session`), and the video goes through the TURN relay, which both ends are given.
   */
  private async connectCloudRun(video: HTMLVideoElement): Promise<void> {
    const iceServers = await faceIceServers()
    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' })
    this.pc = pc
    const stream = new MediaStream()
    this.stream = stream
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    const gotVideo = this.trackStream(pc, stream, video, CLOUD_RUN_JOIN_TIMEOUT_MS)
    gotVideo.catch(() => {}) // awaited below; this only keeps an early failure from going unhandled
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.end(pc.connectionState)
    }

    await pc.setLocalDescription(await pc.createOffer())
    await iceGathered(pc)
    const base = this.session.url.replace(/^http/, 'ws')
    const socket = new WebSocket(`${base}/atrium/session?${new URLSearchParams({ token: this.session.token })}`)
    socket.binaryType = 'arraybuffer'
    this.socket = socket
    const answer = await new Promise<{ sdp: string }>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('the face server did not answer')), CLOUD_RUN_JOIN_TIMEOUT_MS)
      socket.onopen = () =>
        socket.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription?.sdp, iceServers }))
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        const message = JSON.parse(event.data) as { type?: string; sdp?: string }
        window.clearTimeout(timer)
        if (message.type === 'answer' && message.sdp) resolve({ sdp: message.sdp })
        else reject(new Error(`the face server refused the session (${message.type ?? 'unknown'})`))
      }
      socket.onclose = () => {
        window.clearTimeout(timer)
        reject(new Error('the face server closed the session'))
      }
    })
    if (this.disposed) return
    await pc.setRemoteDescription({ sdp: answer.sdp, type: 'answer' })
    // From here the socket is the voice channel, exactly as /atrium/audio is on the VMs.
    socket.onmessage = null
    socket.send(JSON.stringify({ type: 'state', state: this.state }))
    this.outbox.splice(0).forEach((frame) => socket.send(frame))
    socket.onclose = () => {
      if (this.socket === socket) this.end('socket closed')
    }
    await gotVideo
    window.addEventListener('pagehide', this.release)
  }

  /** Puts the face's tracks on the page as they arrive; resolves on the first video track. */
  private trackStream(pc: RTCPeerConnection, stream: MediaStream, video: HTMLVideoElement, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('the face did not appear')), timeoutMs)
      pc.ontrack = (event) => {
        this.applyPlayoutBuffer()
        stream.addTrack(event.track)
        const target = this.video ?? video
        if (target.srcObject !== stream) target.srcObject = stream
        target.muted = false
        void target.play().catch(() => {})
        if (event.track.kind === 'audio') this.listen(event.track)
        if (event.track.kind === 'video') {
          window.clearTimeout(timer)
          resolve()
        }
      }
    })
  }

  /** Measures the face's voice as it is heard: the one source of truth for when she is talking. */
  private listen(track: MediaStreamTrack): void {
    if (this.meter || typeof AudioContext === 'undefined') return
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser)
    void ctx.resume().catch(() => {})
    const samples = new Float32Array(analyser.fftSize)
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
      if (Math.sqrt(sum / samples.length) > VOICE_RMS) this.lastVoiceAt = performance.now()
    }, METER_INTERVAL_MS)
    this.meter = { ctx, timer }
  }

  setPlayoutBuffer(ms: number): void {
    this.playoutBufferMs = ms
    this.applyPlayoutBuffer()
  }

  private applyPlayoutBuffer(): void {
    if (this.playoutBufferMs === null || !this.pc) return
    for (const receiver of this.pc.getReceivers()) {
      // Chrome and Safari; elsewhere the default buffer stays.
      if ('jitterBufferTarget' in receiver) (receiver as { jitterBufferTarget: number | null }).jitterBufferTarget = this.playoutBufferMs
    }
  }

  isVoicing(): boolean {
    return performance.now() - this.lastVoiceAt < VOICE_HOLD_MS
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
    this.send(this.voice.process(pcm).buffer)
  }

  interrupt(): void {
    this.voice.reset()
    this.outbox = this.outbox.filter((frame) => typeof frame === 'string')
    this.send(JSON.stringify({ type: 'interrupt' }))
  }

  /** Whose mouth the audio that follows belongs to, on a face with several people in it. */
  private speaker = 0

  private setSpeaker(index: number): void {
    if (index === this.speaker) return
    this.speaker = index
    // Sent on the audio socket, in order with the audio, so it takes effect exactly between turns.
    this.send(JSON.stringify({ type: 'speaker', index }))
  }

  /**
   * One person on a face that shows several (the in-person panel: one shot of the whole table).
   * Every person shares this one stream; their audio is marked as theirs before it goes over, so
   * the server paints that person's mouth. Person 0 owns the stream and is the one attached.
   */
  forSpeaker(index: number): AvatarRenderer {
    return {
      attach: (video) => (index === 0 ? this.attach(video) : Promise.resolve()),
      pushAudio: (turnSeq, pcm) => {
        this.setSpeaker(index)
        this.pushAudio(turnSeq, pcm)
      },
      interrupt: () => this.interrupt(),
      setState: (state) => this.setState(state),
      providesAudio: this.providesAudio,
      isVoicing: () => this.isVoicing(),
      videoLagMs: this.videoLagMs,
      onEnded: (listener) => this.onEnded(listener),
      dispose: () => {
        if (index === 0) this.dispose()
      },
    }
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
    if (this.meter) {
      window.clearInterval(this.meter.timer)
      void this.meter.ctx.close().catch(() => {})
      this.meter = null
    }
    if (this.video) this.video.srcObject = null
  }
}

/** The face server runs on Cloud Run (one WebSocket, relayed video) rather than on a VM. */
export function isCloudRun(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.run.app')
  } catch {
    return false
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
