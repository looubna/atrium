import { useEffect, useRef, useState } from 'react'
import type { LanguageInfo } from '@/data/language'
import { cn } from '@/lib/utils'
import { formatClock } from '@/modules/interview/api'
import { useLiveInterview, type Caption, type LiveFailure } from '@/modules/interview/live/useLiveInterview'
import { getHelp, getPhrases, getTip, pickPhrases, translateLine, type Phrase, type PracticeMode, type Scene, type Tip } from '@/modules/language/api'
import type { SpeakerTone } from '@/platform/media/pcmPlayer'
import { Button } from '../ui/Button'
import { IconBooks, IconCheck, IconClose, IconHand, IconMic, IconMicOff, IconPhoneOff } from '../ui/Icon'
import { IconGraduationCap, IconLightbulb, IconSlow, IconSpeaker, IconTarget, IconTranslate } from './icons'
import { PhraseRow, SaveButton } from './Phrases'
import { ACCENT, Spinner, guardMicrophone, problem, speak } from './shared'

/**
 * The tutor's voice peaks near full scale with a heavy 150-300 Hz body, which rattles a phone or
 * laptop speaker on loud syllables. The high-pass and the dip at 250 Hz take that out; the gain
 * leaves headroom (peaks about 0.6). No compressor: working on every syllable it added ~5%
 * distortion to the voice (measured on a live take), heard as a vibrating buzz; without it the
 * chain adds none.
 */
const TUTOR_TONE: SpeakerTone = { highpassHz: 150, gain: 0.8, thresholdDb: null, lowMidCutDb: 6 }

/** Live transcription sometimes spells punctuation out ("{question-mark}"). */
const tidy = (text: string) =>
  text
    .replace(/\s*\{question[- ]mark\}/gi, '?')
    .replace(/\s*\{exclamation[- ](mark|point)\}/gi, '!')
    .replace(/\s*\{(comma|period|full[- ]stop)\}/gi, (_, p: string) => (p.toLowerCase() === 'comma' ? ',' : '.'))
    .trim()

interface Line {
  key: number
  speaker: 'tutor' | 'learner'
  text: string
  tip?: Tip
  translation?: string
  translating?: boolean
  /** A lesson line: the phrases it teaches, each with a native voice. */
  phrases?: string[]
}

const FAILURES: Record<LiveFailure, string> = {
  mic_denied: 'Microphone access is blocked. Allow it in your settings to talk.',
  unsupported: "This device can't run a live conversation. Update your browser and try again.",
  forbidden: 'Accept recording and AI processing in your account first.',
  email_unverified: 'Verify your email address first: open the link we sent you, then try again.',
  origin_blocked: 'This address is not allowed to open a live session.',
  not_found: 'This conversation no longer exists. Start it again.',
  conflict: 'Another live session is open, or this one has already finished.',
  quota: "You've used this month's live minutes.",
  unavailable: 'Your conversation partner is unavailable right now. Try again in a moment.',
}

/**
 * A voice conversation in a scene. The partner speaks the language the learner studies; each
 * thing the learner says gets a tip beside it (or a tick), and each thing the partner says can be
 * heard again or translated.
 */
export function Conversation({ sessionId, scene, mode, target, onFeedback, onDone }: {
  sessionId: string
  scene: Scene
  mode: PracticeMode
  target: LanguageInfo
  onFeedback: () => void
  onDone: () => void
}) {
  const live = useLiveInterview(sessionId, null, undefined, undefined, false, TUTOR_TONE)
  const { phase, captions, timeLeftMs, muted, headphones, interviewerSpeaking, micLevel } = live.state
  const active = phase === 'live' || phase === 'reconnecting' || phase === 'connecting'

  // The chat: every finished caption, kept (the hook keeps only the last few).
  const [lines, setLines] = useState<Line[]>([])
  const seen = useRef(new WeakSet<Caption>())
  const lastTutor = useRef('')
  const keyRef = useRef(0)
  const tips = useRef<AbortController | null>(null)

  useEffect(() => {
    for (const c of captions) {
      if (!c.final || seen.current.has(c) || !c.text.trim()) continue
      seen.current.add(c)
      const key = ++keyRef.current
      const text = tidy(c.text)
      if (c.speaker === 'interviewer') {
        lastTutor.current = text
        setLines((all) => [...all, { key, speaker: 'tutor', text }])
        // A lesson quotes the phrases it teaches; only those in the language taught become buttons
        // (not a meaning quoted in the learner's own language, nor their own mistaken attempt).
        const quoted = mode === 'lesson' ? quotedPhrases(text) : []
        if (quoted.length > 0) {
          pickPhrases(text, quoted)
            .then((r) => setLines((all) => all.map((l) => (l.key === key ? { ...l, phrases: r.phrases } : l))))
            .catch(() => {})
        }
        continue
      }
      setLines((all) => [...all, { key, speaker: 'learner', text }])
      // A word or two ("oui", "merci") needs no tip.
      if (text.split(/\s+/).length < 2 && text.length < 6) continue
      getTip(lastTutor.current, text, tips.current?.signal)
        .then((tip) => setLines((all) => all.map((l) => (l.key === key ? { ...l, tip } : l))))
        .catch(() => {})
    }
  }, [captions, mode])
  useEffect(() => {
    const controller = new AbortController()
    tips.current = controller
    return () => controller.abort()
  }, [])

  // Newest line in view.
  const bottom = useRef<HTMLDivElement>(null)
  const partial = captions[captions.length - 1]
  const partialText = partial && !partial.final ? tidy(partial.text) : ''
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [lines.length, partialText])

  const translate = (key: number, text: string) => {
    setLines((all) => all.map((l) => (l.key === key ? { ...l, translating: true } : l)))
    translateLine(text)
      .then((r) => setLines((all) => all.map((l) => (l.key === key ? { ...l, translation: r.text, translating: false } : l))))
      .catch(() => setLines((all) => all.map((l) => (l.key === key ? { ...l, translating: false } : l))))
  }

  // Replays close the mic while they play (the partner must not hear them), then restore it.
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  useEffect(() => {
    let before = false
    return guardMicrophone({
      hold: () => {
        before = mutedRef.current
        live.setMuted(true)
      },
      release: () => live.setMuted(before),
    })
  }, [live])

  // "I'm stuck" and the word bank open over the conversation, which carries on underneath.
  const [sheet, setSheet] = useState<'stuck' | 'bank' | null>(null)
  useEffect(() => {
    bankFor(scene).catch(() => {})
  }, [scene])
  const [ending, setEnding] = useState(false)
  const end = () => {
    setEnding(true)
    live.end()
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* The scene and the clock. */}
      <div className="flex items-center gap-3 border-b border-white/6 px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+0.9rem)] sm:px-6">
        <span className="text-[22px]" aria-hidden>{target.flag}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-chalk">{scene.title}</div>
          {mode === 'lesson' ? (
            <div className="flex items-center gap-1 truncate text-[11.5px] font-medium text-jade-400">
              <IconGraduationCap width={13} height={13} aria-hidden /> Tutor lesson
            </div>
          ) : (
            <div className="truncate text-[11.5px] text-mist">With {scene.role}</div>
          )}
        </div>
        {timeLeftMs !== null && active && (
          <span className="rounded-md bg-white/8 px-2 py-1 font-mono text-[11.5px] text-chalk">{formatClock(timeLeftMs)}</span>
        )}
      </div>

      {/* The conversation. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto grid max-w-2xl gap-3">
          <div className="flex items-start gap-2.5 rounded-2xl border border-white/8 bg-white/[0.03] px-3.5 py-3 text-[12.5px] leading-relaxed text-mist">
            <IconTarget width={17} height={17} className="mt-px shrink-0 text-jade-400" aria-label="Your goal" />
            {scene.goal}
          </div>

          {lines.map((l) =>
            l.speaker === 'tutor' ? (
              <div key={l.key} className="anim-rise max-w-[85%]">
                <div className="rounded-2xl rounded-tl-md bg-white/[0.07] px-4 py-2.5 text-[14.5px] leading-relaxed text-chalk">
                  {l.text}
                  {l.translation && <div className="mt-2 border-t border-white/10 pt-2 text-[13px] text-mist">{l.translation}</div>}
                </div>
                {/* A lesson line mixes both languages: each taught phrase gets its own native voice. */}
                {mode === 'lesson' && l.phrases && l.phrases.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5 pl-1">
                    {l.phrases.map((p) => (
                      <span key={p} className="inline-flex h-[34px] items-center gap-0.5 rounded-xl border border-jade-400/30 bg-jade-500/10 pl-2.5 pr-1 text-[13.5px] text-jade-400">
                        <button type="button" onClick={() => speak(p, target.speech)} aria-label={`Hear ${p} in a native voice`} className="flex items-center gap-1.5 pr-1 font-semibold">
                          <IconSpeaker width={15} height={15} aria-hidden /> {p}
                        </button>
                        <button type="button" onClick={() => speak(p, target.speech, 0.6)} aria-label={`Hear ${p} slowly`} className="grid size-7 place-items-center rounded-lg hover:bg-white/8">
                          <IconSlow width={15} height={15} aria-hidden />
                        </button>
                        <SaveButton phrase={{ term: p, translation: '', example: '' }} compact />
                      </span>
                    ))}
                  </div>
                )}
                <div className={cn('mt-1 flex gap-1 pl-1', mode === 'lesson' && 'hidden')}>
                  <LineAction onClick={() => speak(l.text, target.speech)}>
                    <IconSpeaker width={13} height={13} aria-hidden /> Replay
                  </LineAction>
                  <LineAction onClick={() => speak(l.text, target.speech, 0.6)}>
                    <IconSlow width={13} height={13} aria-hidden /> Slower
                  </LineAction>
                  {!l.translation && (
                    <LineAction disabled={l.translating} onClick={() => translate(l.key, l.text)}>
                      <IconTranslate width={13} height={13} aria-hidden /> {l.translating ? 'Translating…' : 'Translate'}
                    </LineAction>
                  )}
                  {l.text.length <= 80 && (
                    <SaveButton phrase={{ term: l.text, translation: l.translation ?? '', example: '' }} className="ml-auto h-7" />
                  )}
                </div>
              </div>
            ) : (
              <div key={l.key} className="anim-rise ml-auto max-w-[85%]">
                <div className="rounded-2xl rounded-tr-md bg-jade-500 px-4 py-2.5 text-[14.5px] font-medium leading-relaxed text-ink-900">
                  {l.text}
                </div>
                {l.tip?.kind === 'good' && (
                  <div className="mt-1 flex items-center justify-end gap-1 pr-1 text-[11.5px] font-medium text-jade-400">
                    <IconCheck width={13} height={13} /> Sounds natural
                  </div>
                )}
                {l.tip?.kind === 'tip' && (
                  <div className="anim-rise mt-1.5 rounded-[14px] border border-[#fbbf6b]/30 bg-[#fbbf6b]/8 px-3.5 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[#fbbf6b]">
                        <IconLightbulb width={15} height={15} aria-hidden /> Try
                      </span>
                      <button
                        type="button"
                        aria-label="Hear it"
                        onClick={() => l.tip?.kind === 'tip' && speak(l.tip.better, target.speech)}
                        className="grid size-7 place-items-center rounded-lg text-[#fbbf6b] hover:bg-white/8"
                      >
                        <IconSpeaker width={15} height={15} />
                      </button>
                    </div>
                    <div className="mt-0.5 text-[13.5px] font-medium leading-snug text-chalk">{l.tip.better}</div>
                    {l.tip.why && <div className="mt-0.5 text-[11.5px] text-mist">{l.tip.why}</div>}
                  </div>
                )}
              </div>
            ),
          )}

          {partialText && (
            <div className={cn('max-w-[85%] text-[14px] italic text-faint', partial.speaker === 'candidate' && 'ml-auto text-right')}>
              {partialText}…
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>

      {/* The mic and the controls. */}
      <div className="border-t border-white/6 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-3 sm:px-6">
        {phase === 'idle' || phase === 'starting' ? (
          <div className="mx-auto max-w-md">
            <div role="radiogroup" aria-label="Audio output" className="grid grid-cols-2 gap-1.5">
              {[
                { id: false, label: 'Speaker' },
                { id: true, label: 'Headphones' },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={headphones === o.id}
                  onClick={() => live.setHeadphones(o.id)}
                  className={cn(
                    'h-9 rounded-xl border text-[12.5px] font-medium transition-all',
                    headphones === o.id ? 'bg-white/[0.09] text-chalk' : 'border-white/8 bg-white/4 text-mist hover:text-chalk',
                  )}
                  style={headphones === o.id ? { borderColor: ACCENT } : undefined}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <Button variant="primary" className="mt-3 h-12 w-full text-[14px]" disabled={phase === 'starting'} onClick={() => void live.start()}>
              <IconMic width={16} height={16} />
              {phase === 'starting' ? 'Opening microphone…' : 'Start talking'}
            </Button>
            <button type="button" onClick={onDone} className="mt-2 w-full py-2 text-[12.5px] text-mist hover:text-chalk">
              Not now
            </button>
          </div>
        ) : phase === 'failed' ? (
          <div className="mx-auto max-w-md text-center">
            <p className="text-[13px] text-[#fca5a5]">{FAILURES[live.state.failure ?? 'unavailable']}</p>
            <Button className="mt-3 h-11 w-full" onClick={onDone}>Back to the Center</Button>
          </div>
        ) : phase === 'ended' ? (
          <div className="mx-auto max-w-md text-center">
            <p className="text-[14px] font-semibold text-chalk">Nice work!</p>
            <p className="mt-1 text-[12.5px] text-mist">Your feedback is being prepared. New words go to your vocab coach.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="primary" className="h-11" onClick={onFeedback}>See feedback</Button>
              <Button className="h-11" onClick={onDone}>Back to the Center</Button>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-md">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSheet('stuck')}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] text-[12.5px] font-medium text-mist transition-colors hover:text-chalk"
            >
              <IconHand width={15} height={15} /> I'm stuck
            </button>
            <button
              type="button"
              onClick={() => setSheet('bank')}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] text-[12.5px] font-medium text-mist transition-colors hover:text-chalk"
            >
              <IconBooks width={15} height={15} /> Word bank
            </button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              aria-label={muted ? 'Unmute' : 'Mute'}
              onClick={() => live.setMuted(!muted)}
              className={cn(
                'grid size-12 place-items-center rounded-full border transition-colors',
                muted ? 'border-[#e5484d]/50 bg-[#e5484d]/20 text-[#fca5a5]' : 'border-white/15 bg-white/8 text-chalk',
              )}
            >
              {muted ? <IconMicOff width={19} height={19} /> : <IconMic width={19} height={19} />}
            </button>

            {/* The orb: the partner talking, or the learner's voice level. */}
            <button
              type="button"
              onClick={interviewerSpeaking && !headphones ? live.interrupt : undefined}
              className="flex flex-col items-center gap-1.5"
              aria-label={interviewerSpeaking ? 'Your partner is speaking. Tap to cut in' : 'Listening'}
            >
              <span
                className="block size-16 rounded-full transition-transform duration-150"
                style={{
                  // Jade while the partner speaks; the app's chalk, swelling with your voice, on your turn.
                  background: interviewerSpeaking
                    ? `radial-gradient(circle at 35% 30%, #b9f5dd, ${ACCENT} 60%, #0f7a55)`
                    : 'radial-gradient(circle at 35% 30%, #ffffff, #aab6c2 60%, #3b4652)',
                  transform: `scale(${1 + (interviewerSpeaking ? 0.06 : Math.min(0.25, micLevel * 1.4))})`,
                  boxShadow: interviewerSpeaking ? `0 0 28px ${ACCENT}88` : `0 0 ${10 + micLevel * 60}px rgba(243,245,247,0.35)`,
                }}
              />
              <span className="text-[11px] text-mist">
                {phase === 'connecting' ? 'Connecting…' : phase === 'reconnecting' ? 'Reconnecting…' : interviewerSpeaking ? (headphones ? 'Speaking' : 'Tap to cut in') : muted ? 'Muted' : 'Your turn'}
              </span>
            </button>

            <button
              type="button"
              aria-label="End conversation"
              disabled={ending}
              onClick={end}
              className="grid size-12 place-items-center rounded-full bg-[#e5484d] text-white transition-colors hover:bg-[#d13d42] disabled:opacity-50"
            >
              <IconPhoneOff width={19} height={19} />
            </button>
          </div>
          </div>
        )}
      </div>
      {sheet && (
        <Sheet title={sheet === 'stuck' ? "I'm stuck" : 'Word bank'} onClose={() => setSheet(null)}>
          {sheet === 'stuck' ? (
            <StuckHelp heard={lastTutor.current} scene={scene} target={target} lesson={mode === 'lesson'} />
          ) : (
            <WordBank scene={scene} target={target} />
          )}
        </Sheet>
      )}
    </div>
  )
}

function LineAction({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-medium text-faint transition-colors hover:bg-white/6 hover:text-chalk disabled:opacity-60"
    >
      {children}
    </button>
  )
}

/** The phrases a lesson line teaches: the tutor quotes those, and only those. */
function quotedPhrases(text: string): string[] {
  const found = [...text.matchAll(/["“«„]\s*([^"“”«»„]{1,80}?)\s*["”»“]/g)].map((m) => m[1].replace(/[.,!?¡¿]+$/u, '').trim())
  return [...new Set(found.filter((p) => p.length > 0))].slice(0, 4)
}

/** A panel over the bottom of the conversation. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end bg-black/45" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="anim-rise glass max-h-[75%] overflow-y-auto rounded-t-3xl px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-4 sm:px-6"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-chalk">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-xl text-mist hover:bg-white/8 hover:text-chalk">
            <IconClose width={16} height={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** What the partner just said, in your language; hear it slowly; three things you could say. */
function StuckHelp({ heard, scene, target, lesson }: { heard: string; scene: Scene; target: LanguageInfo; lesson: boolean }) {
  const [help, setHelp] = useState<{ translation: string; replies: { text: string; translation: string }[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    getHelp(heard, scene)
      .then((h) => live && setHelp(h))
      .catch((e) => live && setError(problem(e)))
    return () => {
      live = false
    }
  }, [heard, scene])

  if (error) return <p className="text-[13px] text-[#fca5a5]">{error}</p>
  if (!help) return <Spinner label="Finding what to say…" />
  return (
    <div className="grid gap-4">
      {heard && (
        <section>
          <div className="eyebrow">They said</div>
          <p className="mt-1 text-[14px] text-chalk">{heard}</p>
          {/* When they spoke your own language (a lesson explains in it), there is nothing to translate. */}
          {help.translation && help.translation.trim() !== heard.trim() && (
            <p className="mt-1 text-[13px] text-jade-400">{help.translation}</p>
          )}
          {/* A lesson line is in both languages; its phrases have their own native buttons. */}
          <div className={cn('mt-2 flex gap-2', lesson && 'hidden')}>
            <Button className="h-9" onClick={() => speak(heard, target.speech, 0.6)}>
              <IconSlow width={15} height={15} aria-hidden /> Hear it slowly
            </Button>
            <Button className="h-9" onClick={() => speak(heard, target.speech)}>
              <IconSpeaker width={15} height={15} aria-hidden /> Again
            </Button>
          </div>
        </section>
      )}
      {help.replies.length > 0 && (
        <section className="grid gap-2">
          <div className="eyebrow">You could say</div>
          {help.replies.map((r) => (
            <PhraseRow key={r.text} phrase={{ term: r.text, translation: r.translation, example: '' }} target={target} />
          ))}
          <p className="text-[11.5px] text-faint">Say one out loud: your partner is still listening.</p>
        </section>
      )}
    </div>
  )
}

/** The words and phrases this scene needs, once per conversation. */
function WordBank({ scene, target }: { scene: Scene; target: LanguageInfo }) {
  const [items, setItems] = useState<Phrase[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    bankFor(scene)
      .then((found) => live && setItems(found))
      .catch((e) => live && setError(problem(e)))
    return () => {
      live = false
    }
  }, [scene])
  if (error) return <p className="text-[13px] text-[#fca5a5]">{error}</p>
  if (!items) return <Spinner label="Opening the word bank…" />
  return (
    <div className="grid gap-2">
      {items.map((p) => (
        <PhraseRow key={p.term} phrase={p} target={target} />
      ))}
    </div>
  )
}

/** One word bank per scene, fetched as the conversation opens so it is ready when asked for. */
const banks = new Map<string, Promise<Phrase[]>>()
function bankFor(scene: Scene): Promise<Phrase[]> {
  const key = `${scene.title}|${scene.goal}`
  let bank = banks.get(key)
  if (!bank) {
    bank = getPhrases(`${scene.title}. ${scene.goal}`, 10).then((r) => r.items)
    bank.catch(() => banks.delete(key))
    banks.set(key, bank)
  }
  return bank
}
