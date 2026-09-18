import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, setTimeout, clearTimeout })

vi.mock('@/platform/firebase', () => ({
  firebase: () => ({ auth: {} }),
  refreshVerification: () => Promise.resolve(false),
}))
vi.mock('@/platform/native', () => ({
  isNative: () => false,
  revokeAppleTokenNative: () => Promise.resolve(),
  signInWithAppleNative: () => Promise.resolve(),
  signInWithGoogleNative: () => Promise.resolve(),
}))

const { SignInForm } = await import('../AccountSheet')

const html = () => renderToStaticMarkup(createElement(SignInForm))

describe('signing in with an email address', () => {
  it('hides the password, and offers to show it', () => {
    const out = html()
    // A typo in a password nobody can see is the commonest cause of "that doesn't match".
    expect(out).toContain('type="password"')
    expect(out).toContain('aria-label="Show password"')
    expect(out).toContain('aria-pressed="false"')
  })

  it("keeps the browser's own password manager working", () => {
    expect(html()).toContain('autoComplete="current-password"')
  })

  it('offers both signing in and creating an account', () => {
    const out = html()
    expect(out).toContain('Sign in')
    expect(out).toContain('Create an account')
  })
})
