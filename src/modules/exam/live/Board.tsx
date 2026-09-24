import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { IconClose, IconText, IconUndo, IconWrite } from '@/components/ui/Icon'
import type { LiveInterviewControls } from '@/modules/interview/live/useLiveInterview'

/**
 * The board the student works on during a board exam.
 *
 * Mathematics is written, not typed: the pen is the primary tool, with pressure
 * from a stylus where the device reports it, and typing is there for the parts
 * that are prose. Both reach the examiner — typed lines as text, handwriting as
 * a picture of the board — so a derivation can be questioned line by line.
 *
 * The problem the examiner set is pinned above the writing area, because numbers
 * spoken once are numbers lost.
 */

/** The gateway's limit for one typed snapshot. */
const MAX_BOARD_CHARS = 20_000
/** Share after a pause in writing, and at least this often while writing continuously. */
const IDLE_SEND_MS = 2_000
const MAX_SEND_INTERVAL_MS = 6_000
/** The language the gateway tags board work with: prose and mathematics, not code. */
const BOARD_LANGUAGE = 'text'
/** The gateway accepts one board image every few seconds; a stroke or two is worth showing. */
const IMAGE_SEND_MS = 4_500
/** Wide enough for the examiner to read a derivation, small enough to stay inside the message cap. */
const IMAGE_MAX_WIDTH = 1_000
const IMAGE_QUALITY = 0.55

type Tool = 'pen' | 'eraser' | 'type'

interface Stroke {
  /** x, y in board coordinates (CSS pixels of the surface), and the width to draw at. */
  points: { x: number; y: number; w: number }[]
  erase: boolean
}

const PEN_WIDTH = 2.6
const ERASER_WIDTH = 26
const INK = '#14181f'
const BOARD = '#f4f1e8'

/** Pressure is 0 when a device doesn't report it; a mouse should still draw a normal line. */
const widthFor = (pressure: number, erase: boolean) =>
  erase ? ERASER_WIDTH : PEN_WIDTH * (pressure > 0 ? 0.5 + pressure * 1.4 : 1)

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const { points } = stroke
  if (points.length === 0) return
  ctx.save()
  ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over'
  ctx.strokeStyle = INK
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (points.length === 1) {
    // A tap still leaves a mark, the way a pen does.
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.arc(points[0].x, points[0].y, points[0].w / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    ctx.beginPath()
    // Width follows pressure, so each segment is drawn on its own.
    ctx.lineWidth = (from.w + to.w) / 2
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }
  ctx.restore()
}

export function Board({ live, className }: { live: LiveInterviewControls; className?: string }) {
  const connected = live.state.phase === 'live'
  const problem = live.state.boardProblem
  const { sendCodeSnapshot, sendBoardImage } = live

  const [tool, setTool] = useState<Tool>('pen')
  const [text, setText] = useState('')
  const [strokeCount, setStrokeCount] = useState(0)

  const canvas = useRef<HTMLCanvasElement | null>(null)
  const surface = useRef<HTMLDivElement | null>(null)
  const strokes = useRef<Stroke[]>([])
  const drawing = useRef<Stroke | null>(null)
  const size = useRef({ width: 0, height: 0, dpr: 1 })

  /** Repaints every stroke: after a resize, an undo or a clear. */
  const repaint = useCallback(() => {
    const element = canvas.current
    const ctx = element?.getContext('2d')
    if (!element || !ctx) return
    ctx.setTransform(size.current.dpr, 0, 0, size.current.dpr, 0, 0)
    ctx.clearRect(0, 0, size.current.width, size.current.height)
    strokes.current.forEach((stroke) => drawStroke(ctx, stroke))
  }, [])

  // The canvas is sized in device pixels so strokes are sharp on a retina screen.
  useEffect(() => {
    const element = canvas.current
    const box = surface.current
    if (!element || !box) return
    const measure = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const { width, height } = box.getBoundingClientRect()
      if (width === 0 || height === 0) return
      size.current = { width, height, dpr }
      element.width = Math.round(width * dpr)
      element.height = Math.round(height * dpr)
      element.style.width = `${width}px`
      element.style.height = `${height}px`
      repaint()
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(box)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [repaint])

  const pointAt = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      w: widthFor(event.pressure, tool === 'eraser'),
    }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool === 'type') return
    // A palm resting on the screen while writing with a stylus must not draw.
    if (event.pointerType === 'touch' && strokes.current.some((s) => s.points.length > 0) && event.width > 40) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = { points: [pointAt(event)], erase: tool === 'eraser' }
    const ctx = canvas.current?.getContext('2d')
    if (ctx) drawStroke(ctx, drawing.current)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const stroke = drawing.current
    if (!stroke) return
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    // Coalesced events keep a fast stroke smooth instead of jagged.
    const moves = typeof event.nativeEvent.getCoalescedEvents === 'function'
      ? event.nativeEvent.getCoalescedEvents()
      : [event.nativeEvent]
    const rect = event.currentTarget.getBoundingClientRect()
    for (const move of moves) {
      const point = {
        x: move.clientX - rect.left,
        y: move.clientY - rect.top,
        w: widthFor(move.pressure, stroke.erase),
      }
      const previous = stroke.points[stroke.points.length - 1]
      stroke.points.push(point)
      drawStroke(ctx, { points: [previous, point], erase: stroke.erase })
    }
  }

  const endStroke = () => {
    const stroke = drawing.current
    drawing.current = null
    if (!stroke || stroke.points.length === 0) return
    strokes.current.push(stroke)
    setStrokeCount(strokes.current.length)
  }

  const undo = () => {
    strokes.current.pop()
    setStrokeCount(strokes.current.length)
    repaint()
  }

  const clear = () => {
    strokes.current = []
    setStrokeCount(0)
    repaint()
  }

  // -- what the examiner receives -------------------------------------------

  const latestText = useRef(text)
  latestText.current = text
  const sentText = useRef({ text: '', at: performance.now(), stale: false })

  useEffect(() => {
    if (!connected) {
      sentText.current.stale = true
      return
    }
    const pending = () => latestText.current !== sentText.current.text || (sentText.current.stale && latestText.current !== '')
    if (!pending()) return
    const sinceLast = performance.now() - sentText.current.at
    const delay = Math.min(IDLE_SEND_MS, Math.max(0, MAX_SEND_INTERVAL_MS - sinceLast))
    const timer = window.setTimeout(() => {
      if (!pending()) return
      sentText.current = { text: latestText.current, at: performance.now(), stale: false }
      sendCodeSnapshot(BOARD_LANGUAGE, latestText.current)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [connected, text, sendCodeSnapshot])

  // Leaving the exam shares the final state of the typed working.
  useEffect(
    () => () => {
      if (latestText.current !== sentText.current.text) sendCodeSnapshot(BOARD_LANGUAGE, latestText.current)
    },
    [sendCodeSnapshot],
  )

  /** The handwriting, flattened onto the board's colour so the examiner reads dark ink on light. */
  const boardImage = useCallback((): string | null => {
    const element = canvas.current
    if (!element || element.width === 0) return null
    const scale = Math.min(1, IMAGE_MAX_WIDTH / element.width)
    const flat = document.createElement('canvas')
    flat.width = Math.max(1, Math.round(element.width * scale))
    flat.height = Math.max(1, Math.round(element.height * scale))
    const ctx = flat.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = BOARD
    ctx.fillRect(0, 0, flat.width, flat.height)
    ctx.drawImage(element, 0, 0, flat.width, flat.height)
    try {
      return flat.toDataURL('image/jpeg', IMAGE_QUALITY).split(',')[1] ?? null
    } catch {
      return null // a tainted or oversized canvas: the typed working still goes through
    }
  }, [])

  const sentStrokes = useRef(0)
  useEffect(() => {
    if (!connected || strokeCount === 0 || strokeCount === sentStrokes.current) return
    const timer = window.setTimeout(() => {
      const jpeg = boardImage()
      if (!jpeg) return
      sentStrokes.current = strokeCount
      sendBoardImage(jpeg)
    }, IMAGE_SEND_MS)
    return () => window.clearTimeout(timer)
  }, [connected, strokeCount, boardImage, sendBoardImage])

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

  const toolButton = (id: Tool | 'undo' | 'clear', label: string, icon: React.ReactNode, onClick: () => void, active = false) => (
    <button
      key={id}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active || undefined}
      className={cn(
        'grid size-8 place-items-center rounded-lg transition-colors',
        active ? 'bg-[#14181f] text-[#f4f1e8]' : 'text-[#5b6472] hover:bg-black/8 hover:text-[#14181f]',
      )}
    >
      {icon}
    </button>
  )

  return (
    <section
      aria-label="Your board"
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#f4f1e8] shadow-[0_20px_50px_-18px_rgba(0,0,0,0.8)]',
        className,
      )}
    >
      <div className="flex items-center gap-1 border-b border-black/10 px-2 py-1.5">
        <span className="px-1 text-[10.5px] font-semibold tracking-[0.14em] text-[#5b6472]">BOARD</span>
        <div className="ml-1 flex items-center gap-0.5">
          {toolButton('pen', 'Write with the pen', <IconWrite width={16} height={16} />, () => setTool('pen'), tool === 'pen')}
          {toolButton('eraser', 'Erase', <EraserGlyph />, () => setTool('eraser'), tool === 'eraser')}
          {toolButton('type', 'Type', <IconText width={16} height={16} />, () => setTool('type'), tool === 'type')}
          <span className="mx-1 h-5 w-px bg-black/10" aria-hidden />
          {toolButton('undo', 'Undo the last stroke', <IconUndo width={16} height={16} />, undo)}
          {toolButton('clear', 'Clear the board', <IconClose width={15} height={15} />, clear)}
        </div>
        <span className="ml-auto truncate pr-1 text-[10.5px] text-[#7b8593]" role="status">
          {connected ? 'The examiner can see your board' : 'Paused while reconnecting'}
        </span>
      </div>

      {problem && (
        <div className="anim-fade border-b border-black/10 bg-[#e9e4d6] px-3 py-2">
          <div className="text-[9.5px] font-semibold tracking-[0.14em] text-[#5b6472]">THE PROBLEM</div>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-[#14181f]">{problem}</pre>
        </div>
      )}

      <div ref={surface} className="relative min-h-0 flex-1">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, MAX_BOARD_CHARS))}
          onKeyDown={onKeyDown}
          readOnly={tool !== 'type'}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          aria-label="Type your working"
          placeholder={tool === 'type' ? 'Type your working here…' : 'Write with your finger, stylus or mouse — the examiner reads the board as you work.'}
          className={cn(
            'absolute inset-0 size-full resize-none bg-transparent p-3 font-mono text-[13px] leading-relaxed text-[#14181f] outline-none placeholder:text-[#9aa4b2]',
            tool === 'type' ? 'cursor-text' : 'pointer-events-none select-none',
          )}
        />
        <canvas
          ref={canvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
          aria-label="Write on the board"
          className={cn('absolute inset-0 touch-none', tool === 'type' ? 'pointer-events-none' : 'cursor-crosshair')}
        />
      </div>
    </section>
  )
}

/** The eraser is the one tool with no obvious line-art glyph, so it is drawn here. */
function EraserGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 19.5 4 15a1.5 1.5 0 0 1 0-2.1l8-8a1.5 1.5 0 0 1 2.1 0l5 5a1.5 1.5 0 0 1 0 2.1l-7.4 7.5H8.5Z" />
      <path d="M8.5 19.5H19M9 8l7 7" />
    </svg>
  )
}
