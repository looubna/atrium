import { beforeAll, describe, expect, it, vi } from 'vitest'
import { LiveClient, type LiveStatus } from '../liveClient'
import { CloseCode, ForbiddenReason } from '../protocol'

class FakeSocket {
  readyState = 1 // OPEN
  binaryType = ''
  sent: string[] = []
  onopen: (() => void | Promise<void>) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  send(data: unknown) {
    if (typeof data === 'string') this.sent.push(data)
  }
  close() {}
}

const READY = JSON.stringify({ type: 'ready', sessionId: 's', resumed: false, maxDurationMs: 1, elapsedMs: 0, lastSeq: -1 })

function client(holdOpening: boolean) {
  const sockets: FakeSocket[] = []
  const live = new LiveClient({
    url: 'ws://test',
    idToken: async () => 'token',
    appCheckToken: async () => undefined,
    holdOpening,
    onMessage: () => {},
    onAudio: () => {},
    onStatus: () => {},
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
  })
  return { live, sockets }
}

const begins = (socket: FakeSocket) => socket.sent.filter((m) => JSON.parse(m).type === 'begin').length

describe('holding the opening until the candidate sits down', () => {
  // The client checks `WebSocket.OPEN`; Node's test environment has no WebSocket global.
  beforeAll(() => {
    if (typeof WebSocket === 'undefined') vi.stubGlobal('WebSocket', { OPEN: 1 })
  })

  it('asks the gateway to hold the opening', async () => {
    const { live, sockets } = client(true)
    live.connect()
    await sockets[0].onopen?.()
    expect(JSON.parse(sockets[0].sent[0])).toMatchObject({ type: 'auth', holdOpening: true })
  })

  it('sends begin once the session is ready, and only once', async () => {
    const { live, sockets } = client(true)
    live.connect()
    await sockets[0].onopen?.()
    live.begin() // sat down before the gateway was ready
    expect(begins(sockets[0])).toBe(0)
    sockets[0].onmessage?.({ data: READY })
    expect(begins(sockets[0])).toBe(1)
    live.begin()
    expect(begins(sockets[0])).toBe(1)
  })

  it('tells a reconnected gateway again, or the interviewer would never open', async () => {
    const { live, sockets } = client(true)
    live.connect()
    await sockets[0].onopen?.()
    sockets[0].onmessage?.({ data: READY })
    live.begin()
    live.reconnectNow()
    await sockets[1].onopen?.()
    sockets[1].onmessage?.({ data: READY })
    expect(begins(sockets[1])).toBe(1)
  })

  it("doesn't hold anything for screens that open straight away", async () => {
    const { live, sockets } = client(false)
    live.connect()
    await sockets[0].onopen?.()
    expect(JSON.parse(sockets[0].sent[0])).toMatchObject({ holdOpening: false })
  })
})


describe('a token minted before the address was verified', () => {
  beforeAll(() => {
    if (typeof WebSocket === 'undefined') vi.stubGlobal('WebSocket', { OPEN: 1 })
  })

  /** Like `client()`, but watching the tokens asked for and the statuses reported. */
  function watched() {
    const sockets: FakeSocket[] = []
    const refreshes: boolean[] = []
    const statuses: { status: LiveStatus; code?: number; reason?: string }[] = []
    const live = new LiveClient({
      url: 'ws://test',
      idToken: async (forceRefresh) => {
        refreshes.push(forceRefresh)
        return 'token'
      },
      appCheckToken: async () => undefined,
      onMessage: () => {},
      onAudio: () => {},
      onStatus: (status, code, reason) => statuses.push({ status, code, reason }),
      createSocket: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket as unknown as WebSocket
      },
    })
    return { live, sockets, refreshes, statuses }
  }

  const forbid = (socket: FakeSocket, reason: string) =>
    socket.onclose?.({ code: CloseCode.FORBIDDEN, reason })

  it('mints a new one and tries again, rather than reporting a failure', async () => {
    vi.useFakeTimers()
    const { live, sockets, refreshes, statuses } = watched()
    live.connect()
    await sockets[0].onopen?.()
    expect(refreshes).toEqual([false])

    forbid(sockets[0], ForbiddenReason.EMAIL_UNVERIFIED)
    expect(statuses.at(-1)).toMatchObject({ status: 'reconnecting', code: CloseCode.FORBIDDEN })
    await vi.advanceTimersByTimeAsync(1000)
    await sockets[1].onopen?.()
    // The second attempt asks for a token again, so the verified address reaches the gateway.
    expect(refreshes).toEqual([false, true])
    expect(statuses.some((s) => s.status === 'failed')).toBe(false)
    vi.useRealTimers()
  })

  it('gives up after that one retry: a fresh token said the same thing', async () => {
    vi.useFakeTimers()
    const { live, sockets, statuses } = watched()
    live.connect()
    await sockets[0].onopen?.()
    forbid(sockets[0], ForbiddenReason.EMAIL_UNVERIFIED)
    await vi.advanceTimersByTimeAsync(1000)
    await sockets[1].onopen?.()
    forbid(sockets[1], ForbiddenReason.EMAIL_UNVERIFIED)
    expect(statuses.at(-1)).toMatchObject({ status: 'failed', reason: ForbiddenReason.EMAIL_UNVERIFIED })
    expect(sockets).toHaveLength(2)
    vi.useRealTimers()
  })

  it('does not retry a consent that was never given: no token will change it', async () => {
    const { live, sockets, statuses } = watched()
    live.connect()
    await sockets[0].onopen?.()
    forbid(sockets[0], ForbiddenReason.CONSENT_REQUIRED)
    expect(statuses.at(-1)).toMatchObject({ status: 'failed', reason: ForbiddenReason.CONSENT_REQUIRED })
    expect(sockets).toHaveLength(1)
  })

  it('does not retry an address the API will not accept either', async () => {
    const { live, sockets, statuses } = watched()
    live.connect()
    await sockets[0].onopen?.()
    forbid(sockets[0], ForbiddenReason.ORIGIN)
    expect(statuses.at(-1)).toMatchObject({ status: 'failed', reason: ForbiddenReason.ORIGIN })
    expect(sockets).toHaveLength(1)
  })

  it('passes the reason on, so the screen can say which of them it was', async () => {
    const { live, sockets, statuses } = watched()
    live.connect()
    await sockets[0].onopen?.()
    forbid(sockets[0], ForbiddenReason.ACCOUNT_DELETING)
    expect(statuses.at(-1)?.reason).toBe('account_deleting')
  })
})
