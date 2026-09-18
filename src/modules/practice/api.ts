import { create } from 'zustand'
import { api } from '@/platform/api/client'

/**
 * The Practice Center's progress and round analysis. The server owns every rule
 * (bests, challenges, XP, streak); the app only shows what it sends.
 */

export type MetricSource = 'measured' | 'ai'

export interface PracticeMetric {
  key: string
  label: string
  unit: string
  better: 'higher' | 'lower'
  source: MetricSource
  /** Range a gauge spans, and the value that counts as good. */
  scale: [number, number]
  goal: number | null
  /** A comfortable range, for metrics where both too low and too high are off. */
  band: [number, number] | null
  value: number | null
  /** The best before this round, for metrics that count as personal bests. */
  best: number | null
  isBestMetric: boolean
  newBest: boolean
}

export interface CoachPoint {
  point: string
  quote: string
}

export interface RoundFeedback {
  headline: string
  strengths: CoachPoint[]
  improvements: CoachPoint[]
  nextTry: string
}

export interface RoundAwards {
  counted: boolean
  xp: number
  xpParts: { reason: string; xp: number }[]
  newBests: { key: string; label: string; value: number; previous: number }[]
  firstResults: string[]
  challenge: {
    level: number
    label: string
    passed: boolean
    /** Consecutive passing rounds this level needs, and how many are done. */
    repeat: number
    passes: number
    completed?: boolean
    unlocked?: number
    mastered?: boolean
  } | null
  todayDone: boolean
  streakExtended: boolean
  achievements: { id: string; title: string; description: string }[]
}

export interface DrillProgress {
  title: string
  skills: { id: string; label: string }[]
  rounds: number
  level: number
  mastered: boolean
  challenge: { level: number; label: string; repeat: number; passes: number }
  challenges: { level: number; label: string; repeat: number; done: boolean }[]
  bests: {
    key: string
    label: string
    unit: string
    better: 'higher' | 'lower'
    source: MetricSource
    value: number | null
    previous: number | null
  }[]
}

export interface PracticeProgress {
  xp: number
  level: number
  levelXp: number
  levelSpan: number
  streak: { current: number; best: number; practicedToday: boolean }
  today: { drillId: string; title: string; level: number; label: string; done: boolean }
  achievements: { id: string; title: string; description: string; earnedOn: string | null }[]
  skills: { id: string; label: string; rounds: number }[]
  drills: Record<string, DrillProgress>
}

export interface RoundResult {
  attemptId: string
  drillId: string
  minSpeechSeconds: number
  transcript: string
  /** Words on the round's clock (ms), fillers flagged. */
  timeline: { w: string; s: number; e: number; f: boolean }[]
  speechMs: number
  metrics: PracticeMetric[]
  feedback: RoundFeedback | null
  awards: RoundAwards
  progress: PracticeProgress
}

/** The user's calendar day (YYYY-MM-DD), for the streak. */
export const localDay = (now = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export const getPracticeProgress = () => api<PracticeProgress>(`/practice/progress?day=${localDay()}`)

export interface RoundSubmission {
  drillId: string
  recording: Blob
  prompt: unknown
  prepUsedMs: number
  speakSeconds: number
  eyeContactPct?: number | null
}

export function submitPracticeRound(round: RoundSubmission): Promise<RoundResult> {
  const form = new FormData()
  const extension = round.recording.type.includes('mp4') ? 'm4a' : round.recording.type.includes('ogg') ? 'ogg' : 'webm'
  form.append('audio', round.recording, `round.${extension}`)
  form.append('drillId', round.drillId)
  form.append('prompt', JSON.stringify(round.prompt))
  form.append('localDate', localDay())
  form.append('prepUsedMs', String(Math.max(0, Math.round(round.prepUsedMs))))
  form.append('speakSeconds', String(round.speakSeconds))
  if (round.eyeContactPct !== null && round.eyeContactPct !== undefined) form.append('eyeContactPct', String(round.eyeContactPct))
  return api<RoundResult>('/practice/rounds', { method: 'POST', body: form })
}

/** One shared copy of the progress, refreshed on demand and after each round. */
export const usePracticeProgress = create<{
  progress: PracticeProgress | null
  loading: boolean
  refresh: () => Promise<void>
  set: (progress: PracticeProgress) => void
}>((set, get) => ({
  progress: null,
  loading: false,
  refresh: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      set({ progress: await getPracticeProgress() })
    } catch {
      // Signed out or offline: the Practice Center still works, just without progress.
    } finally {
      set({ loading: false })
    }
  },
  set: (progress) => set({ progress }),
}))

/** How a measured or rated value reads, with its unit. */
export function formatMetric(value: number | null, unit: string): string {
  if (value === null || value === undefined) return '—'
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1)
  if (!unit) return rounded
  if (unit === '%' || unit === '/5') return `${rounded}${unit}`
  if (unit === 's') return `${rounded} s`
  return `${rounded} ${unit}`
}

/** Prep time for Think on Your Feet at each challenge level. */
export const THINK_PREP_SECONDS: Record<number, number> = { 1: 15, 2: 10, 3: 7 }
