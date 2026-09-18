import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { LiveInterviewControls } from '@/modules/interview/live/useLiveInterview'

/**
 * The board the student works on during a board exam. What they write is sent to
 * the examiner as it settles, so it can be questioned line by line, and each
 * snapshot is kept with its time on the session clock for the evaluation.
 *
 * The sending follows the interview's shared editor (`CodePane`): share after a
 * pause, at least every few seconds while writing, and once more on the way out.
 */

/** The gateway's limit for one snapshot. */
const MAX_BOARD_CHARS = 20_000
/** Share after a pause in writing, and at least this often while writing continuously. */
const IDLE_SEND_MS = 2_000
const MAX_SEND_INTERVAL_MS = 6_000
/** The language the gateway tags board work with: prose and mathematics, not code. */
const BOARD_LANGUAGE = 'text'

interface Sent {
  text: string
  at: number
  /** The connection dropped since the last send, so the examiner may not have it. */
  stale: boolean
}

export function Board({ live, className }: { live: LiveInterviewControls; className?: string }) {
  const connected = live.state.phase === 'live'
  const send = live.sendCodeSnapshot
  const [text, setText] = useState('')
  const latest = useRef(text)
  latest.current = text
  const sent = useRef<Sent>({ text: '', at: performance.now(), stale: false })

  useEffect(() => {
    if (!connected) {
      sent.current.stale = true
      return
    }
    const pending = () => latest.current !== sent.current.text || (sent.current.stale && latest.current !== '')
    if (!pending()) return
    const sinceLast = performance.now() - sent.current.at
    const delay = Math.min(IDLE_SEND_MS, Math.max(0, MAX_SEND_INTERVAL_MS - sinceLast))
    const id = window.setTimeout(() => {
      if (!pending()) return
      sent.current = { text: latest.current, at: performance.now(), stale: false }
      send(BOARD_LANGUAGE, latest.current)
    }, delay)
    return () => window.clearTimeout(id)
  }, [connected, text, send])

  // Leaving the exam shares the final state of the board.
  useEffect(
    () => () => {
      if (latest.current !== sent.current.text) send(BOARD_LANGUAGE, latest.current)
    },
    [send],
  )

  // Tab indents; Shift+Tab still moves focus out of the board.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab' || event.shiftKey) return
    event.preventDefault()
    const el = event.currentTarget
    const start = el.selectionStart
    const next = `${el.value.slice(0, start)}  ${el.value.slice(el.selectionEnd)}`
    if (next.length > MAX_BOARD_CHARS) return
    setText(next)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 2
    })
  }

  return (
    <section
      aria-label="Your board"
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#f4f1e8] shadow-[0_20px_50px_-18px_rgba(0,0,0,0.8)]',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-black/10 px-3 py-1.5">
        <span className="text-[10.5px] font-semibold tracking-[0.14em] text-[#5b6472]">BOARD</span>
        <span className="ml-auto truncate text-[10.5px] text-[#7b8593]" role="status">
          {connected ? 'The examiner can see what you write' : 'Paused while reconnecting'}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value.slice(0, MAX_BOARD_CHARS))}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        aria-label="Work the problem here"
        placeholder="Work the problem here — the examiner reads it as you write."
        className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[13px] leading-relaxed text-[#14181f] outline-none placeholder:text-[#9aa4b2]"
      />
    </section>
  )
}
