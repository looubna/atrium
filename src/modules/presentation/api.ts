import type { PresentationBriefing, PresentationFormat } from '@/data/practice'
import { api } from '@/platform/api/client'

/**
 * Presentation sessions (`backend/app/modules/presentation`): a talk with the user's own slides, in a
 * small room, to a large audience or on a video call. The audience is played live on
 * `/sessions/{id}/live`: silent while the user presents, then asking questions.
 */

/** The largest slide file read into the session (the server's limit too). */
export const MAX_SLIDES_BYTES = 20 * 1024 * 1024

const base64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

export const createPresentationSession = async (body: {
  format: PresentationFormat
  questions: 'talk' | 'slides'
  title: string
  audience: string
  durationMinutes: number
  /** The slides as picked (PDF or PowerPoint): their text shapes the audience and its questions. */
  slides?: File
}) => {
  const { slides, ...rest } = body
  const readable = slides && /\.(pdf|pptx)$/i.test(slides.name) && slides.size <= MAX_SLIDES_BYTES
  return api<{
    id: string
    maxDurationMs: number
    people: { key: string; name: string; role: string }[]
    briefing: PresentationBriefing
  }>('/presentation/sessions', {
    method: 'POST',
    body: {
      id: crypto.randomUUID(),
      ...rest,
      slides: readable ? { name: slides.name, data: await base64(slides) } : undefined,
    },
    // Writing the audience from the slides can wait out a busy model: longer than an ordinary request.
    timeoutMs: 90_000,
  })
}
