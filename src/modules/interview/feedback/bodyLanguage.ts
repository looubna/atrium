import type { BodyCheck, BodyFinding } from '../api'

/** What each check looks at, in the words the feedback uses. */
export const CHECK_LABEL: Record<BodyCheck, string> = {
  posture_tilt: 'Shoulder tilt',
  turned_away: 'Facing the camera',
  head_lower: 'Head height',
  repeated_gesture: 'Repeated gestures',
  gesture_timing: 'Hands while listening',
  look_away: 'Looking away mid-answer',
  sway: 'Swaying',
}

/**
 * Session numbers that can be compared from one session to the next, all "share of the time" figures
 * where less is the change the exercises aim for. Gesturing while speaking is left out on purpose:
 * more or less of it is not better or worse in itself.
 */
export const COMPARED_METRICS: { key: string; label: string }[] = [
  { key: 'lookAwaySpeakingPct', label: 'Looking away mid-answer' },
  { key: 'repeatedGesturePct', label: 'Repeating one gesture' },
  { key: 'gestureListeningPct', label: 'Hands moving while listening' },
  { key: 'swayPct', label: 'Swaying' },
  { key: 'tiltPct', label: 'Shoulders tilted' },
  { key: 'turnedAwayPct', label: 'Turned away while speaking' },
  { key: 'headLowerPct', label: 'Head lowered' },
]

export interface ComparisonRow {
  key: string
  label: string
  before: number
  after: number
  /** True when the time spent on it went down, false when it went up, null when unchanged. */
  improved: boolean | null
}

/** Rows for a before/after comparison: only numbers both sessions measured, and only ones that ever showed up. */
export function compareMetrics(before: Record<string, number>, after: Record<string, number>): ComparisonRow[] {
  return COMPARED_METRICS.flatMap(({ key, label }) => {
    const a = before[key]
    const b = after[key]
    if (typeof a !== 'number' || typeof b !== 'number' || (a === 0 && b === 0)) return []
    return [{ key, label, before: a, after: b, improved: a === b ? null : b < a }]
  })
}

/** The findings to show, most trustworthy first: confirmed by the AI, then by measurement confidence. */
export function orderFindings(findings: BodyFinding[]): BodyFinding[] {
  const rank = (f: BodyFinding) =>
    (f.review?.verdict === 'confirmed' ? 0 : 3) + { high: 0, medium: 1, low: 2 }[f.confidence]
  return [...findings].sort((a, b) => rank(a) - rank(b) || a.startMs - b.startMs)
}
