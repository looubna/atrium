import { useEffect, useRef, useState } from 'react'
import { DECK_ACCEPT, DeckError, loadDeck } from '@/lib/loadDeck'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/state/useAppStore'
import { IconChevronLeft, IconChevronRight, IconClose, IconFile, IconUpload } from '../ui/Icon'

/** Opens the file picker and turns the choice into slides, with progress and errors. */
function useDeckUpload() {
  const setDeck = useAppStore((s) => s.setDeck)
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onFiles = async (list: FileList | null) => {
    const files = list ? [...list] : []
    if (files.length === 0) return
    setError(null)
    setProgress('Preparing slides…')
    try {
      const deck = await loadDeck(files, (done, total) =>
        setProgress(total === 0 ? 'Converting PowerPoint…' : `Preparing slides… ${done}/${total}`),
      )
      setDeck(deck)
    } catch (e) {
      setError(e instanceof DeckError ? e.message : 'These slides couldn’t be opened.')
    } finally {
      setProgress(null)
    }
  }

  const picker = (
    <input
      ref={input}
      type="file"
      accept={DECK_ACCEPT}
      multiple
      className="hidden"
      onChange={(e) => {
        void onFiles(e.target.files)
        e.target.value = ''
      }}
    />
  )
  return { picker, open: () => input.current?.click(), progress, error }
}

/** Next / previous from the keyboard while slides are on screen. */
function useSlideKeys(enabled: boolean) {
  const goSlide = useAppStore((s) => s.goSlide)
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault()
        goSlide(1)
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
        e.preventDefault()
        goSlide(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, goSlide])
}

/**
 * While presenting: upload slides if there are none, then previous / next and the
 * page count. Arrow keys, Page Up/Down and the space bar also turn pages.
 */
export function SlideControls({ compact, inline }: { compact?: boolean; inline?: boolean }) {
  const deck = useAppStore((s) => s.deck)
  const index = useAppStore((s) => s.slideIndex)
  const goSlide = useAppStore((s) => s.goSlide)
  const setZoom = useAppStore((s) => s.setSlideZoom)
  const upload = useDeckUpload()
  useSlideKeys(Boolean(deck))

  const button = cn(
    'grid place-items-center rounded-full text-chalk transition-all active:scale-95 disabled:opacity-35',
    compact ? 'size-8' : 'size-10',
  )

  if (inline) {
    // A small pill for the presenter's control bar: an upload button, then ‹ n/N ›.
    return (
      <div className="relative">
        {upload.picker}
        {upload.error && (
          <div className="glass absolute bottom-full left-1/2 mb-2 w-60 -translate-x-1/2 rounded-lg px-2.5 py-1.5 text-center text-[11px] text-[#fca5a5]" role="status">
            {upload.error}
          </div>
        )}
        {deck ? (
          <div className="glass flex h-10 items-center rounded-full px-1" role="group" aria-label="Slides">
            <button type="button" aria-label="Previous slide" disabled={index === 0} onClick={() => goSlide(-1)} className="grid size-8 place-items-center rounded-full text-chalk active:scale-95 disabled:opacity-35">
              <IconChevronLeft width={15} height={15} />
            </button>
            <button type="button" aria-label={`Slide ${index + 1} of ${deck.slides.length}, open to read`} onClick={() => setZoom(true)}
              className="min-w-[2.2rem] rounded-full px-0.5 text-center text-[11px] font-semibold tabular-nums text-mist hover:text-chalk" aria-live="polite">
              {index + 1}/{deck.slides.length}
            </button>
            <button type="button" aria-label="Next slide" disabled={index >= deck.slides.length - 1} onClick={() => goSlide(1)} className="grid size-8 place-items-center rounded-full text-chalk active:scale-95 disabled:opacity-35">
              <IconChevronRight width={15} height={15} />
            </button>
          </div>
        ) : (
          <button type="button" onClick={upload.open} disabled={Boolean(upload.progress)} aria-label="Upload slides" title={upload.progress ?? 'Upload slides (PDF or PowerPoint)'}
            className="glass grid size-10 place-items-center rounded-full text-mist transition-colors hover:text-chalk disabled:animate-pulse">
            <IconUpload width={16} height={16} />
          </button>
        )}
      </div>
    )
  }

  if (!deck) {
    return (
      <div className="flex flex-col items-center gap-1">
        {upload.picker}
        <button
          type="button"
          onClick={upload.open}
          disabled={Boolean(upload.progress)}
          className={cn('glass flex items-center gap-2 rounded-full px-3.5 text-[12px] font-medium text-mist transition-colors hover:text-chalk', compact ? 'h-8' : 'h-10')}
        >
          <IconUpload width={15} height={15} />
          {upload.progress ?? 'Upload slides (PDF or PowerPoint)'}
        </button>
        {upload.error && <div className="glass max-w-xs rounded-lg px-2.5 py-1.5 text-center text-[11px] text-[#fca5a5]" role="status">{upload.error}</div>}
      </div>
    )
  }

  return (
    <div className={cn('glass flex items-center gap-1 rounded-full p-1')} role="group" aria-label="Slides">
      <button type="button" aria-label="Previous slide" disabled={index === 0} onClick={() => goSlide(-1)} className={button}>
        <IconChevronLeft width={18} height={18} />
      </button>
      <span className={cn('min-w-[3.5rem] text-center font-semibold tabular-nums text-chalk', compact ? 'text-[12px]' : 'text-[13px]')} aria-live="polite">
        {index + 1} / {deck.slides.length}
      </span>
      <button
        type="button"
        aria-label="Next slide"
        disabled={index >= deck.slides.length - 1}
        onClick={() => goSlide(1)}
        className={button}
      >
        <IconChevronRight width={18} height={18} />
      </button>
    </div>
  )
}

/** In the session setup: attach the slides to present, optional. */
export function DeckPicker() {
  const deck = useAppStore((s) => s.deck)
  const setDeck = useAppStore((s) => s.setDeck)
  const upload = useDeckUpload()

  return (
    <div>
      {upload.picker}
      {deck ? (
        <div className="flex h-10 items-center gap-2 rounded-xl border border-jade-400/30 bg-jade-500/10 pl-3 pr-1.5">
          <IconFile width={15} height={15} className="shrink-0 text-jade-400" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[12px] font-medium text-chalk">{deck.name}</div>
            <div className="text-[10px] text-faint">{deck.slides.length} slides</div>
          </div>
          <button
            type="button"
            aria-label="Remove slides"
            onClick={() => setDeck(null)}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-white/8 hover:text-chalk"
          >
            <IconClose width={13} height={13} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={upload.open}
          disabled={Boolean(upload.progress)}
          className="flex h-10 w-full items-center gap-2 rounded-xl border border-dashed border-white/8 bg-white/4 px-3 text-left text-[12.5px] font-medium text-mist transition-all duration-200 hover:bg-white/8 hover:text-chalk"
        >
          <IconUpload width={15} height={15} className="shrink-0" />
          <span className="flex-1">{upload.progress ?? 'Upload your slides'}</span>
          <span className="text-[10.5px] text-faint">PDF, PPT or images</span>
        </button>
      )}
      <p className="mt-1 text-[10.5px] text-faint">
        {upload.error ?? 'PDF or PowerPoint. Change slides with the arrows or your keyboard.'}
      </p>
    </div>
  )
}

/**
 * The current slide, large enough to read. Tap outside or ✕ to close; arrows,
 * keys and a swipe turn pages.
 */
export function SlideReader() {
  const deck = useAppStore((s) => s.deck)
  const index = useAppStore((s) => s.slideIndex)
  const open = useAppStore((s) => s.slideZoom)
  const setOpen = useAppStore((s) => s.setSlideZoom)
  const goSlide = useAppStore((s) => s.goSlide)
  const swipe = useRef<number | null>(null)
  const swiped = useRef(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, setOpen])

  if (!open || !deck) return null
  // As much of the screen as possible goes to the slide: the page controls already sit in
  // the presenter's bar below, so the reader only adds a close button.
  return (
    <div
      className="anim-fade pointer-events-auto absolute inset-0 z-[35] bg-black/90 backdrop-blur-sm hud-inset"
      role="dialog"
      aria-label="Slide"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative h-full w-full pb-14"
        onPointerDown={(e) => {
          swipe.current = e.clientX
        }}
        onPointerUp={(e) => {
          const start = swipe.current
          swipe.current = null
          if (start !== null && Math.abs(e.clientX - start) > 50) {
            swiped.current = true
            goSlide(e.clientX < start ? 1 : -1)
          }
        }}
        onClickCapture={(e) => {
          // A swipe ends in a click on the backdrop: it turned the page, it must not close.
          if (swiped.current) {
            swiped.current = false
            e.stopPropagation()
          }
        }}
      >
        <div className="relative h-full w-full">
          <img
            src={deck.slides[index]}
            alt={`Slide ${index + 1} of ${deck.slides.length}`}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-0 m-auto max-h-full max-w-full select-none rounded-md object-contain shadow-2xl"
          />
        </div>
      </div>
      <button
        type="button"
        aria-label="Close slide"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(false)
        }}
        className="glass absolute right-3 top-3 grid size-9 place-items-center rounded-full text-chalk"
      >
        <IconClose width={15} height={15} />
      </button>
    </div>
  )
}
