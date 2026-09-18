/**
 * Turns a presentation the user picked into slide images the app can show: a PDF
 * (PowerPoint, Keynote and Google Slides all export one) is rendered page by page;
 * images are used as they are. Everything stays on the device.
 */

export interface Deck {
  name: string
  /** Object URLs, one per slide, in order. */
  slides: string[]
}

// PowerPoint and Keynote files are selectable so the app can explain how to present them.
export const DECK_ACCEPT = '.pdf,application/pdf,image/png,image/jpeg,image/webp,.ppt,.pptx,.key,.odp'
const MAX_SLIDES = 80
/**
 * Wide enough for small text to stay readable when a slide is opened full screen on a
 * large display, and still crisp when drawn small on the laptop in the footage.
 */
const RENDER_WIDTH = 2560

export class DeckError extends Error {}

export function releaseDeck(deck: Deck | null) {
  deck?.slides.forEach((url) => URL.revokeObjectURL(url))
}

export async function loadDeck(files: File[], onProgress?: (done: number, total: number) => void): Promise<Deck> {
  if (files.length === 0) throw new DeckError('No file chosen.')
  let first = files[0]

  if (/\.(pptx?|key|odp)$/i.test(first.name)) {
    // Browsers can't render PowerPoint or Keynote: the app's server converts to PDF when it can.
    onProgress?.(0, 0)
    let converted: Blob | null = null
    try {
      const res = await fetch('/api/convert-to-pdf', {
        method: 'POST',
        headers: { 'x-filename': encodeURIComponent(first.name) },
        body: first,
      })
      if (res.ok && (res.headers.get('content-type') ?? '').includes('pdf')) converted = await res.blob()
    } catch {
      // No converter reachable: fall through to the message.
    }
    if (!converted) {
      throw new DeckError('This PowerPoint couldn’t be converted here. Save it as a PDF (File → Save As → PDF) and upload that.')
    }
    first = new File([converted], first.name.replace(/\.\w+$/, '.pdf'), { type: 'application/pdf' })
  }
  const isPdf = first.type === 'application/pdf' || /\.pdf$/i.test(first.name)

  if (!isPdf) {
    const images = files.filter((f) => f.type.startsWith('image/')).slice(0, MAX_SLIDES)
    if (images.length === 0) throw new DeckError('Upload a PDF, or one or more slide images.')
    images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return { name: images.length === 1 ? images[0].name : `${images.length} images`, slides: images.map((f) => URL.createObjectURL(f)) }
  }

  // Loaded only when someone uploads a PDF: it is a large library.
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  let doc
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await first.arrayBuffer()) }).promise
  } catch {
    throw new DeckError('This PDF couldn’t be opened. Try exporting it again.')
  }
  const total = Math.min(doc.numPages, MAX_SLIDES)
  const slides: string[] = []
  try {
    for (let n = 1; n <= total; n++) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      // Lossless: JPEG smears thin text, and slides are mostly flat colour that PNG compresses well.
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new DeckError('A slide couldn’t be rendered.')
      slides.push(URL.createObjectURL(blob))
      page.cleanup()
      onProgress?.(n, total)
    }
  } catch (e) {
    slides.forEach((url) => URL.revokeObjectURL(url))
    throw e instanceof DeckError ? e : new DeckError('This PDF couldn’t be rendered.')
  } finally {
    void doc.destroy()
  }
  return { name: first.name, slides }
}
