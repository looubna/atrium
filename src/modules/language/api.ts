import type { LanguageLevel } from '@/data/language'
import { api } from '@/platform/api/client'

/**
 * The Language Center (`backend/app/modules/language`): a plan, voice conversations in scenes,
 * tips as you speak, the vocab coach and progress. The conversation itself runs on
 * `/sessions/{id}/live`; its report comes from the feedback pipeline like every session.
 */

export interface LanguageProfile {
  target: string
  native: string
  level: LanguageLevel
  goals: string
}

export interface Objective {
  id: string
  title: string
  role: string
  situation: string
  goal: string
  done: boolean
}

export interface Chapter {
  title: string
  objectives: Objective[]
}

export interface HistoryEntry {
  sessionId: string
  title: string
  at: string
  score?: number
  newWords?: number
  objectiveMet?: boolean
  summary?: string
}

export interface LanguageState {
  profile: LanguageProfile | null
  plan: Chapter[]
  progress: { xp: number; level: number; into: number; of: number; streak: number; history: HistoryEntry[] }
  vocab: { total: number; due: number }
  /** Every language being learned; `profile.target` is the one on screen. */
  languages: { id: string; level: LanguageLevel | null; native: string | null }[]
  scenarios: { id: string; title: string; icon: string }[]
}

export interface Scene {
  title: string
  role: string
  situation: string
  goal: string
}

export interface VocabCard {
  id: string
  term: string
  translation: string
  example: string
  box: number
  due: string | null
}

export type Tip = { kind: 'good' } | { kind: 'tip'; better: string; why: string }

export const getLanguageState = () => api<LanguageState>('/language/state')

export const saveLanguageProfile = (profile: LanguageProfile) =>
  // Writing the plan waits on a model.
  api<LanguageState>('/language/profile', { method: 'PUT', body: profile, timeoutMs: 90_000 })

/** Back to another language already being learned (its own plan, words and history). */
export const switchLanguage = (target: string) =>
  api<LanguageState>('/language/switch', { method: 'POST', body: { target } })

/** A role-play in the scene, or a tutor lesson on it that checks every answer. */
export type PracticeMode = 'roleplay' | 'lesson'

/** Stop learning a language: its plan, words and history are deleted; XP and the streak stay. */
export const removeLanguage = (id: string) => api<LanguageState>(`/language/languages/${id}`, { method: 'DELETE' })

export const createLanguageSession = (body: {
  objectiveId?: string
  scenarioId?: string
  durationMinutes: number
  mode: PracticeMode
  /** The partner speaks slowly. */
  slow: boolean
}) =>
  api<{ id: string; liveUrl: string; scene: Scene }>('/language/sessions', {
    method: 'POST',
    body: { id: crypto.randomUUID(), ...body },
  })

export const getTip = (heard: string, said: string, signal?: AbortSignal) =>
  api<Tip>('/language/tip', { method: 'POST', body: { heard, said }, signal })

export const translateLine = (text: string) =>
  api<{ text: string }>('/language/translate', { method: 'POST', body: { text } })

export const getVocab = (all = false) => api<{ cards: VocabCard[] }>(`/language/vocab${all ? '?all=true' : ''}`)

export const reviewCard = (id: string, grade: 'again' | 'good' | 'easy') =>
  api<{ id: string; box: number; due: string | null }>(`/language/vocab/${id}/review`, {
    method: 'POST',
    body: { grade },
  })

/** "I'm stuck": what the partner said, in your language, and three things you could say next. */
export const getHelp = (heard: string, scene: Scene) =>
  api<{ translation: string; replies: { text: string; translation: string }[] }>('/language/help', {
    method: 'POST',
    body: { heard, scene: { title: scene.title, role: scene.role, goal: scene.goal } },
  })

export interface Phrase {
  term: string
  translation: string
  example: string
}

/** A word bank for a scene, or a word list for any topic. */
export const getPhrases = (topic: string, count = 12) =>
  api<{ items: Phrase[] }>('/language/phrases', { method: 'POST', body: { topic, count }, timeoutMs: 60_000 })

/** Save a word or phrase to the vocab coach. */
export const saveCard = (card: Phrase) => api<{ id: string; term: string }>('/language/vocab', { method: 'POST', body: card })

/** A word or line in a native voice (MP3, base64); `audio` is null where the server has no AI. */
export const sayNative = (text: string, slow: boolean) =>
  api<{ audio: string | null; mime: string }>('/language/say', { method: 'POST', body: { text, slow } })

/** Of the phrases a lesson line quotes, the ones in the language taught that are models to copy. */
export const pickPhrases = (line: string, quoted: string[]) =>
  api<{ phrases: string[] }>('/language/pick', { method: 'POST', body: { line, quoted } })
