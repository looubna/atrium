import { DURATION_DEFAULT, DURATION_MAX, DURATION_MIN, type SessionSetup } from '@/data/practice'
import { createInterviewSession, getBlueprint, type BlueprintRound } from '../api'

/** A round's own length, kept inside what a live session allows. */
export const roundMinutes = (round: Pick<BlueprintRound, 'durationMin'>): number =>
  Math.min(DURATION_MAX, Math.max(DURATION_MIN, round.durationMin ?? DURATION_DEFAULT))

/**
 * A fresh live session for a round of the same journey (or general practice),
 * keeping how the previous one happened: online or in person, one interviewer or
 * a panel. Returns the session to put on the call.
 */
export async function startRound(
  previous: SessionSetup,
  round: Pick<BlueprintRound, 'id' | 'title' | 'type'> | null,
  minutes: number,
): Promise<SessionSetup> {
  const interview = previous.interview
  if (!interview) throw new Error('not an interview session')
  const journey = interview.applicationId && interview.blueprintId && round
  const created = await createInterviewSession({
    ...(journey
      ? { applicationId: interview.applicationId, blueprintId: interview.blueprintId, roundId: round.id }
      : { practice: 'general_behavioral' as const }),
    mode: interview.mode === 'in-person' ? 'in_person' : 'online',
    panel: interview.panel === 'panel' ? 'panel' : 'one_to_one',
    durationMinutes: minutes,
  })
  return {
    ...previous,
    minutes,
    interview: {
      ...interview,
      sessionId: created.id,
      ...(journey ? { roundId: round.id, roundTitle: round.title, roundType: round.type } : {}),
    },
  }
}

/** The round after this one in the journey as it stands now (the user may have edited it). */
export async function nextRound(
  applicationId: string,
  blueprintId: string,
  roundId: string,
): Promise<BlueprintRound | null> {
  const rounds = [...((await getBlueprint(applicationId, blueprintId)).rounds ?? [])].sort((a, b) => a.order - b.order)
  const index = rounds.findIndex((r) => r.id === roundId)
  return index >= 0 ? (rounds[index + 1] ?? null) : null
}
