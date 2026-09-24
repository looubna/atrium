/**
 * Saying a word out loud and checking it: the device's own speech recognition, in the language
 * being learned. Absent on some browsers, where the coach falls back to reading and revealing.
 */

interface Recognition {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  abort: () => void
}

type RecognitionCtor = new () => Recognition

const ctor = (): RecognitionCtor | null => {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const canListen = () => ctor() !== null

/** Lower case, no punctuation or accents: what is compared is the words. */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** 0..1: how close what was heard is to the word, by edit distance. */
export function similarity(said: string, expected: string): number {
  const a = normalise(said)
  const b = normalise(expected)
  if (!a || !b) return 0
  if (a === b) return 1
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return 1 - row[b.length] / Math.max(a.length, b.length)
}

export type Verdict = 'right' | 'close' | 'wrong'

export const verdictOf = (score: number): Verdict => (score >= 0.85 ? 'right' : score >= 0.6 ? 'close' : 'wrong')

/** Listen for one utterance; resolves with what was heard (the alternative closest to `expected`). */
export function listenOnce(lang: string, expected: string): { done: Promise<string>; cancel: () => void } {
  const Ctor = ctor()
  if (!Ctor) return { done: Promise.reject(new Error('unsupported')), cancel: () => {} }
  const rec = new Ctor()
  rec.lang = lang
  rec.interimResults = false
  rec.maxAlternatives = 5
  const done = new Promise<string>((resolve, reject) => {
    let heard = ''
    rec.onresult = (e) => {
      const alternatives = Array.from(e.results[0] ?? [], (r) => r.transcript)
      heard = alternatives.sort((x, y) => similarity(y, expected) - similarity(x, expected))[0] ?? ''
    }
    rec.onerror = (e) => reject(new Error(e.error))
    rec.onend = () => resolve(heard)
  })
  rec.start()
  return { done, cancel: () => rec.abort() }
}
