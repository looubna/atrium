/**
 * The meeting room is edited like a filmed interview: whoever is speaking, full screen, and the
 * lead between turns.
 */

/** Who is talking: the lead, a panel colleague by name, or nobody. */
export type Speaker = { kind: 'lead' } | { kind: 'colleague'; name: string } | null

export type Shot = { kind: 'closeup'; who: 'lead' | string } | { kind: 'plate' }

/** How long the close-up holds after someone stops talking, so short pauses don't cut back and forth. */
export const CUT_BACK_MS = 800

export function shotFor(speaker: Speaker, faces: { lead: boolean; colleagues: Record<string, boolean> }): Shot {
  if (speaker?.kind === 'lead' && faces.lead) return { kind: 'closeup', who: 'lead' }
  if (speaker?.kind === 'colleague' && faces.colleagues[speaker.name]) return { kind: 'closeup', who: speaker.name }
  // Otherwise the lead's live face; with no face at all, a name plate.
  return faces.lead ? { kind: 'closeup', who: 'lead' } : { kind: 'plate' }
}
