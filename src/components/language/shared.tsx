import type { ReactNode } from 'react'
import { sayNative } from '@/modules/language/api'
import { ApiError } from '@/platform/api/client'
import { cn } from '@/lib/utils'
import { IconArrowLeft } from '../ui/Icon'

/** The app's accent, jade, as in every other screen. */
export const ACCENT = '#34d399'
/** Jade for text on dark: eyebrows, scores, translations. */
export const ACCENT_TEXT = '#5fe3a8'
/** The raised surface the feedback and practice screens use. */
export const SURFACE = 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015))'

/**
 * While a live conversation is open, what plays from here must not reach its microphone: the
 * partner would hear the phrase and take it for the learner's answer. The conversation registers
 * how to close and reopen its mic around playback.
 */
let micGuard: { hold: () => void; release: () => void } | null = null
export function guardMicrophone(guard: { hold: () => void; release: () => void }): () => void {
  micGuard = guard
  return () => {
    if (micGuard === guard) micGuard = null
  }
}

/** Native recordings already fetched, by line and speed. */
const clips = new Map<string, Promise<string | null>>()
let playing: HTMLAudioElement | null = null

/** The device's own voice: the fallback when the native one cannot be had. */
function deviceVoice(text: string, lang: string, rate: number): Promise<void> {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  if (!synth || !text.trim()) return Promise.resolve()
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  const prefix = lang.split('-')[0]
  utterance.voice =
    synth.getVoices().find((v) => v.lang === lang) ?? synth.getVoices().find((v) => v.lang.startsWith(prefix)) ?? null
  utterance.rate = rate
  return new Promise((resolve) => {
    utterance.onend = () => resolve()
    utterance.onerror = () => resolve()
    synth.speak(utterance)
  })
}

/**
 * Say a line in the language being learned, in a native voice (the tutor's own voice family,
 * native to that language); the device's voice if that fails. Resolves when it has been said.
 * `rate` below 0.85 asks for the slow version.
 */
export async function speak(text: string, lang: string, rate = 0.92): Promise<void> {
  const clean = text.trim()
  if (!clean) return
  await say(clean, lang, rate)
}

/** Closes the conversation's mic (when one is open) while `play` runs. */
async function guarded(play: () => Promise<void>): Promise<void> {
  const guard = micGuard
  guard?.hold()
  try {
    await play()
  } finally {
    guard?.release()
  }
}

async function say(clean: string, lang: string, rate: number): Promise<void> {
  const slow = rate < 0.85
  const key = `${slow ? 'slow' : 'normal'}|${clean}`
  let clip = clips.get(key)
  if (!clip) {
    clip = sayNative(clean, slow)
      .then((r) => (r.audio ? `data:${r.mime};base64,${r.audio}` : null))
      .catch(() => null)
    clips.set(key, clip)
  }
  const src = await clip
  if (!src) {
    clips.delete(key)
    return guarded(() => deviceVoice(clean, lang, rate))
  }
  playing?.pause()
  const audio = new Audio(src)
  playing = audio
  await guarded(
    () =>
      new Promise<void>((resolve) => {
        audio.onended = () => resolve()
        audio.onerror = () => resolve()
        audio.onpause = () => resolve()
        audio.play().catch(() => resolve())
      }),
  )
}

/** A message for a failed request, in words the learner can act on. */
export function problem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "You've reached today's limit. Try again later."
    if (error.status === 403) return 'Verify your email and accept AI processing in your account first.'
    return error.detail ?? error.message
  }
  return "Couldn't reach Atrium. Check your connection and try again."
}

/** One screen's header: back, a title, and whatever sits on the right. */
export function ScreenHeader({ title, eyebrow, onBack, right }: {
  title: string
  eyebrow?: string
  onBack: () => void
  right?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+0.9rem)] sm:px-6">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-mist transition-colors hover:bg-white/10 hover:text-chalk"
      >
        <IconArrowLeft width={17} height={17} />
      </button>
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="eyebrow" style={{ color: ACCENT }}>{eyebrow}</div>}
        <h1 className="truncate text-[18px] font-semibold leading-tight tracking-tight text-chalk">{title}</h1>
      </div>
      {right}
    </div>
  )
}

/** A card in the Center's lists. */
export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const style = cn('rounded-2xl border border-white/8 p-4', className)
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(style, 'text-left transition-colors hover:border-jade-400/30 active:scale-[0.99]')}
      style={{ background: SURFACE }}
    >
      {children}
    </button>
  ) : (
    <div className={style} style={{ background: SURFACE }}>{children}</div>
  )
}

/** A thin progress bar. */
export function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-white/8', className)}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: ACCENT }}
      />
    </div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="grid place-items-center gap-3 py-16 text-[13px] text-mist" role="status">
      <span className="size-7 animate-spin rounded-full border-2 border-white/15" style={{ borderTopColor: ACCENT }} />
      {label}
    </div>
  )
}
