import { Capacitor } from '@capacitor/core'
import { FirebaseError } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { usePaywall } from '@/components/billing/Paywall'
import { Button } from '@/components/ui/Button'
import { IconClose, IconEye, IconEyeOff } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { getBillingStatus, PLAN_NAMES, type BillingStatus } from '@/modules/billing/api'
import { useAppStore } from '@/state/useAppStore'
import { ApiError, api } from '../api/client'
import { firebase, refreshVerification } from '../firebase'
import { isNative, revokeAppleTokenNative, signInWithAppleNative, signInWithGoogleNative } from '../native'
import { useAuthUser } from './useAuthUser'

type ConsentKind = 'ai_processing' | 'recording' | 'video_analysis'

interface Consent {
  kind: ConsentKind
  accepted: boolean
  version: string | null
  current: boolean
}

interface Profile {
  uid: string
  displayName: string | null
  plan: string
  consents: Consent[]
  consentVersion: string
  emailVerified: boolean
}

const CONSENT_COPY: Record<ConsentKind, { title: string; body: string }> = {
  recording: {
    title: 'Record my practice sessions',
    body: 'Your voice (and video, if you turn the camera on) is recorded so feedback can point to exact moments. You can download or delete recordings at any time.',
  },
  ai_processing: {
    title: 'Process my materials with AI',
    body: 'Your resume, job details, recordings and transcripts are sent to Google Cloud AI services to run the interviewer and generate feedback. They are not used to train models.',
  },
  video_analysis: {
    title: 'Analyse my camera video with AI',
    body: 'Optional. When your camera is on, a low-resolution copy of your video is reviewed by Google Cloud AI for facial expressions, eye contact and posture. Without this, only numbers measured on your device (like how often you look at the camera) are used.',
  },
}

function authMessage(error: unknown): string {
  const code = error instanceof FirebaseError ? error.code : ''
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password don’t match an account.'
    case 'auth/email-already-in-use':
      return 'An account already uses this email. Sign in instead.'
    case 'auth/weak-password':
      return 'Use a password with at least 8 characters.'
    case 'auth/invalid-email':
      return 'Enter a valid email address.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.'
    case 'auth/network-request-failed':
      return 'Could not reach the sign-in service. Check your connection.'
    default:
      return 'Sign-in failed. Try again.'
  }
}

const field =
  'h-10 w-full rounded-xl border border-white/8 bg-white/4 px-3 text-[13px] text-chalk outline-none placeholder:text-faint focus:border-jade-400/40'

export function SignInForm() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (mode === 'signup' && password.length < 8) {
      setError('Use a password with at least 8 characters.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { auth } = firebase()
      if (mode === 'signup') {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password)
        await sendEmailVerification(credential.user)
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password)
      }
    } catch (err) {
      setError(authMessage(err))
    } finally {
      setBusy(false)
    }
  }

  // Native sign-in: Google on Android and iPhone; Apple only on iPhone (it's Apple's service).
  const native = isNative()
  const appleSignIn = Capacitor.getPlatform() === 'ios'
  const nativeSignIn = async (provider: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await provider()
    } catch (err) {
      setError(err instanceof Error && err.message.includes('cancelled') ? null : authMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    {native && (
      <div className="mt-4 flex flex-col gap-2">
        {appleSignIn && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void nativeSignIn(signInWithAppleNative)}
            className="h-10 rounded-xl bg-white text-[13px] font-semibold text-black transition-opacity disabled:opacity-60"
          >
             Continue with Apple
          </button>
        )}
        <Button variant="ghost" disabled={busy} onClick={() => void nativeSignIn(signInWithGoogleNative)}>
          Continue with Google
        </Button>
        <div className="mt-1 text-center text-[10.5px] text-faint">or use email</div>
      </div>
    )}
    <form onSubmit={submit} className="mt-4 flex flex-col gap-2">
      <input
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        className={field}
      />
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className={cn(field, 'pr-11')}
        />
        {/* A typo in a password you cannot see is the commonest reason sign-in "doesn't match". */}
        <button
          type="button"
          onClick={() => setShowPassword((shown) => !shown)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          aria-pressed={showPassword}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-xl text-faint transition-colors hover:text-chalk focus-visible:text-chalk focus-visible:outline-none"
        >
          {showPassword ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
        </button>
      </div>
      {error && (
        <p className="text-[12px] text-[#fca5a5]" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={busy} className="mt-1 w-full">
        {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </Button>
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'signup' ? 'signin' : 'signup')
          setError(null)
        }}
        className="mt-1 text-[12px] text-mist hover:text-chalk"
      >
        {mode === 'signup' ? 'I already have an account' : 'Create an account'}
      </button>
      {!native && (
        <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
          In the iPhone app you can also continue with Apple or Google.
        </p>
      )}
    </form>
    </>
  )
}

function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      // Apple requires revoking the Sign in with Apple token; deletion proceeds even if the user cancels.
      await revokeAppleTokenNative().catch(() => undefined)
      await api('/me', { method: 'DELETE' })
      await signOut(firebase().auth)
      onDeleted()
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'recent_login_required'
          ? 'For your security, sign out and sign in again, then delete your account.'
          : err instanceof ApiError
            ? err.message
            : 'Could not delete your account. Check your connection and try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="mt-3 w-full text-center text-[12px] text-[#fca5a5] hover:underline">
        Delete account
      </button>
    )
  }
  return (
    <div className="mt-4 rounded-xl border border-[#f87171]/30 bg-[#f87171]/8 p-3" role="alertdialog" aria-label="Delete account">
      <p className="text-[12.5px] font-medium text-chalk">Delete your account?</p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-mist">
        This permanently deletes your profile, resumes, job applications, recordings, transcripts, feedback and progress.
        It can’t be undone.
      </p>
      {error && <p className="mt-2 text-[11.5px] text-[#fca5a5]">{error}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
          Cancel
        </Button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          className="h-10 rounded-xl bg-[#e5484d] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-[#f0595e] disabled:opacity-60"
        >
          {busy ? 'Deleting…' : 'Delete everything'}
        </button>
      </div>
    </div>
  )
}

function SignedIn({
  email,
  emailVerified,
  onDeleted,
}: {
  email: string | null
  emailVerified: boolean
  onDeleted: () => void
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const showPlans = usePaywall((s) => s.show)
  const paywallOpen = usePaywall((s) => s.open)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<ConsentKind | null>(null)
  const [verificationSent, setVerificationSent] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [p, b] = await Promise.all([api<Profile>('/me'), getBillingStatus()])
      setProfile(p)
      setBilling(b)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your account. Check your connection.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, paywallOpen])

  const toggle = async (consent: Consent) => {
    if (!profile) return
    setSaving(consent.kind)
    try {
      await api(`/me/consents/${consent.kind}`, {
        method: 'PUT',
        body: { accepted: !consent.current, version: profile.consentVersion },
      })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your choice.')
    } finally {
      setSaving(null)
    }
  }


  return (
    <div className="mt-4">
      <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2.5">
        <div className="truncate text-[13px] font-medium text-chalk">{email ?? 'Signed in'}</div>
        {!emailVerified && (
          <div className="mt-1 flex items-center justify-between gap-2 text-[11.5px] text-[#fcd34d]">
            <span>{checkResult ?? 'Verify your email to use AI practice.'}</span>
            <span className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                disabled={checking}
                onClick={async () => {
                  setChecking(true)
                  try {
                    const verified = await refreshVerification()
                    setCheckResult(verified ? null : 'Not verified yet — open the link in the email first.')
                  } catch {
                    setCheckResult('Could not check. Try again.')
                  } finally {
                    setChecking(false)
                  }
                }}
                className="underline disabled:no-underline disabled:opacity-60"
              >
                {checking ? 'Checking…' : "I've verified"}
              </button>
              <button
                type="button"
                disabled={verificationSent}
                onClick={async () => {
                  const user = firebase().auth.currentUser
                  if (user) await sendEmailVerification(user)
                  setVerificationSent(true)
                }}
                className="underline disabled:no-underline disabled:opacity-60"
              >
                {verificationSent ? 'Sent' : 'Resend'}
              </button>
            </span>
          </div>
        )}
      </div>

      <div className="eyebrow mt-5">Privacy choices</div>
      <div className="mt-2 flex flex-col gap-2">
        {(profile?.consents ?? []).map((consent) => (
          <button
            key={consent.kind}
            type="button"
            role="switch"
            aria-checked={consent.current}
            disabled={saving !== null}
            onClick={() => void toggle(consent)}
            className={cn(
              'flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 disabled:opacity-60',
              consent.current ? 'border-jade-400/40 bg-jade-500/10' : 'border-white/8 bg-white/4 hover:bg-white/8',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
                consent.current ? 'bg-jade-500' : 'bg-white/15',
              )}
            >
              <span className={cn('size-4 rounded-full bg-white transition-transform', consent.current && 'translate-x-4')} />
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium text-chalk">{CONSENT_COPY[consent.kind].title}</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-faint">{CONSENT_COPY[consent.kind].body}</span>
              {consent.accepted && !consent.current && (
                <span className="mt-1 block text-[11px] text-[#fcd34d]">Updated terms — please review and accept again.</span>
              )}
            </span>
          </button>
        ))}
        {!profile && !error && <div className="text-[12px] text-faint">Loading…</div>}
      </div>

      {billing && (
        <>
          <div className="eyebrow mt-5">
            {PLAN_NAMES[billing.plan]}
            {billing.isTrial ? ' · one-time' : ' · this month'}
          </div>
          <div className="mt-2 text-[12.5px] text-mist">
            {billing.minutesLeft} of {billing.allowanceMinutes} live minutes left
            {billing.todayMinutesLeft !== null && ` · ${billing.todayMinutesLeft} left today`}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-jade-400"
              style={{ width: `${Math.min(100, (billing.minutesLeft / Math.max(1, billing.allowanceMinutes)) * 100)}%` }}
            />
          </div>
          {billing.plan !== 'internal' && (
            <button type="button" onClick={() => showPlans('upgrade')} className="mt-2 text-[12px] font-medium text-jade-400 hover:underline">
              {billing.plan === 'free' ? 'See plans · Have a code?' : 'Change plan · Have a code?'}
            </button>
          )}
        </>
      )}

      {error && (
        <p className="mt-3 text-[12px] text-[#fca5a5]" role="alert">
          {error}
        </p>
      )}

      <Button variant="ghost" className="mt-6 w-full" onClick={() => void signOut(firebase().auth)}>
        Sign out
      </Button>
      <DeleteAccount onDeleted={onDeleted} />
    </div>
  )
}

/** Sign-in, privacy choices and usage. Opened from the profile button. */
export function AccountSheet() {
  const open = useAppStore((s) => s.accountOpen)
  const setOpen = useAppStore((s) => s.setAccountOpen)
  const { ready, user, configured } = useAuthUser()
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  return (
    <div className="anim-fade absolute inset-0 z-[55] flex justify-end bg-black/45" onClick={() => setOpen(false)}>
      <aside
        role="dialog"
        aria-label="Account"
        onClick={(e) => e.stopPropagation()}
        className="glass hud-inset h-full w-full max-w-sm overflow-y-auto rounded-none sm:rounded-l-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight text-chalk">Account</h2>
          <Button variant="icon" aria-label="Close account" onClick={() => setOpen(false)}>
            <IconClose width={14} height={14} />
          </Button>
        </div>
        {!configured ? (
          <p className="mt-4 text-[12.5px] text-mist">Accounts aren’t available in this build.</p>
        ) : !ready ? (
          <p className="mt-4 text-[12.5px] text-faint">Loading…</p>
        ) : user ? (
          <SignedIn
            key={user.uid}
            email={user.email}
            emailVerified={user.emailVerified}
            onDeleted={() => setNotice('Your account and data are being deleted. This finishes within a few hours.')}
          />
        ) : (
          <>
            {notice && <p className="mt-4 rounded-xl border border-white/8 bg-white/4 p-3 text-[12px] text-mist">{notice}</p>}
            <SignInForm />
          </>
        )}
      </aside>
    </div>
  )
}
