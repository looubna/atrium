import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { LiveInterviewControls } from './useLiveInterview'

/** Values must match the gateway's language pattern (live_protocol.CodeSnapshot). */
const LANGUAGES = [
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'java', label: 'Java' },
  { id: 'c++', label: 'C++' },
  { id: 'c#', label: 'C#' },
  { id: 'go', label: 'Go' },
  { id: 'sql', label: 'SQL' },
  { id: 'text', label: 'Notes / design' },
] as const

/** The gateway's limit for one snapshot. */
export const MAX_EDITOR_CHARS = 20_000
/** Share after a pause in typing, and at least this often while typing continuously. */
const IDLE_SEND_MS = 2_000
const MAX_SEND_INTERVAL_MS = 6_000

interface Sent {
  language: string
  text: string
  at: number
  /** The connection dropped since the last send, so the interviewer may not have it. */
  stale: boolean
}

/**
 * Shared editor for coding and system-design rounds. The interviewer receives
 * snapshots while the candidate works, and each snapshot is kept with its time
 * on the session clock for the evaluation.
 */
export function CodePane({ live, compact }: { live: LiveInterviewControls; compact?: boolean }) {
  const connected = live.state.phase === 'live'
  const send = live.sendCodeSnapshot
  const [language, setLanguage] = useState<string>('python')
  const [text, setText] = useState('')
  const latest = useRef({ language, text })
  latest.current = { language, text }
  const sent = useRef<Sent>({ language: 'python', text: '', at: performance.now(), stale: false })

  useEffect(() => {
    if (!connected) {
      sent.current.stale = true
      return
    }
    const pending = () => {
      const now = latest.current
      const changed = now.text !== sent.current.text || now.language !== sent.current.language
      return changed || (sent.current.stale && now.text !== '')
    }
    if (!pending()) return
    const sinceLast = performance.now() - sent.current.at
    const delay = Math.min(IDLE_SEND_MS, Math.max(0, MAX_SEND_INTERVAL_MS - sinceLast))
    const id = window.setTimeout(() => {
      if (!pending()) return
      sent.current = { ...latest.current, at: performance.now(), stale: false }
      send(latest.current.language, latest.current.text)
    }, delay)
    return () => window.clearTimeout(id)
  }, [connected, language, text, send])

  // Closing the editor (or the call) shares the final state.
  useEffect(
    () => () => {
      const now = latest.current
      if (now.text !== sent.current.text || now.language !== sent.current.language) send(now.language, now.text)
    },
    [send],
  )

  // Tab indents; Shift+Tab still moves focus out of the editor.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab' || event.shiftKey) return
    event.preventDefault()
    const el = event.currentTarget
    const start = el.selectionStart
    const next = `${el.value.slice(0, start)}  ${el.value.slice(el.selectionEnd)}`
    if (next.length > MAX_EDITOR_CHARS) return
    setText(next)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 2
    })
  }

  return (
    <section className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl" aria-label="Shared editor">
      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
        <span className="text-[10.5px] font-semibold tracking-[0.14em] text-jade-400">EDITOR</span>
        <select
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          aria-label="Language"
          className="h-7 rounded-lg border border-white/10 bg-white/6 px-2 text-[12px] text-chalk outline-none focus-visible:ring-2 focus-visible:ring-jade-400/70"
        >
          {LANGUAGES.map((option) => (
            <option key={option.id} value={option.id} className="bg-ink-900">
              {option.label}
            </option>
          ))}
        </select>
        <span className="ml-auto truncate text-[11px] text-faint" role="status">
          {connected ? 'The interviewer can see what you write' : 'Paused while reconnecting'}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value.slice(0, MAX_EDITOR_CHARS))}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        aria-label="Code and notes"
        placeholder={language === 'text' ? 'Sketch components, data flow and trade-offs…' : 'Write your solution here…'}
        className={cn(
          'min-h-0 flex-1 resize-none bg-transparent p-3 font-mono leading-relaxed text-chalk outline-none placeholder:text-faint',
          compact ? 'text-[12px]' : 'text-[13px]',
        )}
      />
      {text.length > MAX_EDITOR_CHARS * 0.9 && (
        <div className="px-3 pb-2 text-[11px] text-[#fca5a5]">
          {text.length.toLocaleString()} / {MAX_EDITOR_CHARS.toLocaleString()} characters
        </div>
      )}
    </section>
  )
}
