import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.fn()
vi.mock('@/platform/api/client', () => ({ api: (...args: unknown[]) => api(...args) }))

const { faceServerReady, holdFaces, useFaceWarmup, warmProgress, warmSecondsLeft } = await import('../faceWarmup')

const reply = (state: string, elapsedS = 0) => ({ state, elapsedS, expectedS: 80 })

describe('face warm-up', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    api.mockReset()
    useFaceWarmup.setState({ state: 'idle', since: 0, checkedAt: 0, holding: false, heldAt: 0 })
  })
  afterEach(() => vi.useRealTimers())

  it('asks the server to start as soon as something holds the face, and stops polling on release', async () => {
    api.mockResolvedValue(reply('starting'))
    const release = holdFaces()
    await vi.advanceTimersByTimeAsync(0)
    expect(api).toHaveBeenCalledWith('/faces/warm', expect.objectContaining({ method: 'POST' }))
    await vi.advanceTimersByTimeAsync(5_000)
    const polls = api.mock.calls.length
    expect(polls).toBeGreaterThan(1)
    release()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(api.mock.calls.length).toBe(polls)
    expect(useFaceWarmup.getState().holding).toBe(false)
  })

  it('resolves once the server is up', async () => {
    api.mockResolvedValueOnce(reply('starting')).mockResolvedValueOnce(reply('loading', 50)).mockResolvedValue(reply('ready', 80))
    const ready = faceServerReady()
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(ready).resolves.toBe(true)
  })

  it('gives up when no server can start, so the session goes on with its voice', async () => {
    api.mockResolvedValue(reply('unavailable'))
    const ready = faceServerReady()
    await vi.advanceTimersByTimeAsync(0)
    await expect(ready).resolves.toBe(false)
  })

  it('stops waiting when the room is left', async () => {
    api.mockResolvedValue(reply('starting'))
    const leaving = new AbortController()
    const ready = faceServerReady(150_000, leaving.signal)
    leaving.abort()
    await expect(ready).resolves.toBe(false)
    expect(useFaceWarmup.getState().holding).toBe(false)
  })

  it('counts down from the usual start time and never shows done before it is', () => {
    const state = { ...useFaceWarmup.getState(), state: 'starting' as const, since: 0, expectedS: 80 }
    expect(warmSecondsLeft(state, 20_000)).toBe(60)
    expect(warmProgress(state, 40_000)).toBeCloseTo(0.5)
    expect(warmProgress(state, 600_000)).toBeLessThan(1)
    expect(warmSecondsLeft(state, 600_000)).toBe(0)
    expect(warmProgress({ ...state, state: 'ready' }, 1)).toBe(1)
  })
})
