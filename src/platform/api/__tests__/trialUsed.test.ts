import { describe, expect, it, vi } from 'vitest'

vi.mock('@/platform/firebase', () => ({
  idToken: () => Promise.resolve('token'),
  refreshVerification: () => Promise.resolve(false),
}))
vi.mock('@/platform/appcheck', () => ({ appCheckToken: () => Promise.resolve(undefined) }))

const { api, ApiError, onTrialUsed } = await import('../client')

const reply = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(body), { status })))

describe('a free account whose minutes are used up', () => {
  it('opens the paywall from whichever room asked, and still fails the request', async () => {
    const opened = vi.fn()
    onTrialUsed(opened)
    reply(403, { code: 'trial_used', title: 'Your free minutes are used up' })
    await expect(api('/cafe/sessions', { method: 'POST' })).rejects.toBeInstanceOf(ApiError)
    expect(opened).toHaveBeenCalledTimes(1)

    // Any other refusal leaves the paywall alone.
    reply(429, { code: 'quota_exceeded' })
    await expect(api('/practice/rounds', { method: 'POST' })).rejects.toBeInstanceOf(ApiError)
    expect(opened).toHaveBeenCalledTimes(1)
  })
})
