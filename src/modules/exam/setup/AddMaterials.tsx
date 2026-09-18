import { type ReactNode, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { IconArrowLeft, IconClose, IconLink, IconText, IconUpload } from '@/components/ui/Icon'

/**
 * The one way material gets in: files, a link, or pasted text. Three options and
 * nothing else — the student never says what a file is, and never fills in a form
 * about it. Everything else is read off the material itself.
 */

export type MaterialDraft =
  | { kind: 'files'; files: File[] }
  | { kind: 'link'; url: string }
  | { kind: 'text'; text: string }

type Choice = 'files' | 'link' | 'text'

/** Everything the reader accepts; images cover photographed board notes and scans. */
export const ACCEPTED_FILES =
  '.pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.rtf,.png,.jpg,.jpeg,.webp,application/pdf,image/*'

const option =
  'flex w-full items-start gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-2.5 text-left ' +
  'transition-all duration-200 hover:border-jade-400/40 hover:bg-jade-500/10 active:scale-[0.99]'

function Option({
  icon,
  title,
  note,
  onClick,
}: {
  icon: ReactNode
  title: string
  note: string
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className={option}>
      <span className="mt-0.5 shrink-0 text-jade-400">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-chalk">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-faint">{note}</span>
      </span>
    </button>
  )
}

const field =
  'w-full rounded-xl border border-white/8 bg-white/4 px-3 text-[12.5px] text-chalk outline-none ' +
  'placeholder:text-faint focus:border-jade-400/40'

/**
 * A compact sheet over the setup panel. It closes as soon as something is added,
 * so adding three files in a row is three taps, not a form each time.
 */
export function AddMaterials({ onAdd, onClose }: { onAdd: (draft: MaterialDraft) => void; onClose: () => void }) {
  const [choice, setChoice] = useState<Choice | null>(null)
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const firstField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (choice === 'link' || choice === 'text') firstField.current?.focus()
  }, [choice])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (choice) setChoice(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [choice, onClose])

  const linkReady = /^https?:\/\/\S+\.\S+/i.test(url.trim())

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add your study materials"
      className="absolute inset-0 z-20 flex items-end rounded-2xl bg-black/55 backdrop-blur-[2px]"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="anim-rise w-full rounded-2xl border border-white/10 bg-ink-800/95 p-4">
        <div className="flex items-center gap-2">
          {choice && (
            <button
              type="button"
              aria-label="Back"
              onClick={() => setChoice(null)}
              className="grid size-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/4 text-mist transition-colors hover:bg-white/8 hover:text-chalk"
            >
              <IconArrowLeft width={13} height={13} />
            </button>
          )}
          <div className="text-[13px] font-semibold tracking-tight text-chalk">
            {choice === 'link' ? 'Add a link' : choice === 'text' ? 'Paste text' : 'Add your study materials'}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="ml-auto grid size-7 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-white/8 hover:text-chalk"
          >
            <IconClose width={13} height={13} />
          </button>
        </div>

        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            if (files.length) onAdd({ kind: 'files', files })
          }}
        />

        {choice === null && (
          <div className="mt-3 flex flex-col gap-1.5">
            <Option
              icon={<IconUpload width={16} height={16} />}
              title="Upload files"
              note="PDF, PowerPoint, Word, text or photos — slides, notes, past papers, anything"
              onClick={() => input.current?.click()}
            />
            <Option
              icon={<IconLink width={16} height={16} />}
              title="Add a link"
              note="A course website, an online textbook, a shared folder"
              onClick={() => setChoice('link')}
            />
            <Option
              icon={<IconText width={16} height={16} />}
              title="Paste text"
              note="A syllabus, exam instructions, notes your professor sent"
              onClick={() => setChoice('text')}
            />
          </div>
        )}

        {choice === 'link' && (
          <div className="anim-fade mt-3">
            <input
              ref={firstField as React.RefObject<HTMLInputElement>}
              type="url"
              inputMode="url"
              aria-label="Link to your course material"
              value={url}
              maxLength={2000}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && linkReady && onAdd({ kind: 'link', url: url.trim() })}
              placeholder="https://…"
              className={cn(field, 'h-10')}
            />
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
              We look the page up rather than opening it for you, so a link behind a login still helps.
            </p>
            <Button
              variant="primary"
              className="mt-3 w-full"
              disabled={!linkReady}
              onClick={() => onAdd({ kind: 'link', url: url.trim() })}
            >
              Add link
            </Button>
          </div>
        )}

        {choice === 'text' && (
          <div className="anim-fade mt-3">
            <textarea
              ref={firstField as React.RefObject<HTMLTextAreaElement>}
              aria-label="Paste your course text"
              value={text}
              rows={6}
              maxLength={50_000}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste the syllabus, the exam instructions, or your professor's notes…"
              className={cn(field, 'resize-y py-2 leading-relaxed')}
            />
            <Button
              variant="primary"
              className="mt-3 w-full"
              disabled={text.trim().length < 20}
              onClick={() => onAdd({ kind: 'text', text: text.trim() })}
            >
              Add text
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
