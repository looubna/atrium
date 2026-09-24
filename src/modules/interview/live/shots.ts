/**
 * The meeting room is edited like a filmed interview — except that the camera never moves and
 * never cuts away, because it is the candidate's own view from their chair. What changes between
 * turns is which take of that one shot is running.
 */

/** Who is talking: the lead, a panel colleague by name, or nobody. */
export type Speaker = { kind: 'lead' } | { kind: 'colleague'; name: string } | null

/** Which take of the room is on screen: everyone listening, the lead talking, or a colleague. */
export type Take = { kind: 'listen' } | { kind: 'lead' } | { kind: 'colleague'; index: number }

/** How long a take holds after someone stops talking, so short pauses don't cut back and forth. */
export const CUT_BACK_MS = 800

/**
 * The take for whoever has the floor.
 *
 * A colleague nobody has filmed cannot be cut to, so the room keeps listening rather than putting
 * the wrong person's mouth in motion: being still while someone talks is a shot that is merely
 * quiet, while the wrong mouth moving is a shot that is wrong.
 */
export function takeFor(speaker: Speaker, colleagues: readonly string[]): Take {
  if (speaker?.kind === 'lead') return { kind: 'lead' }
  if (speaker?.kind === 'colleague') {
    const index = colleagues.indexOf(speaker.name)
    if (index >= 0) return { kind: 'colleague', index }
  }
  return { kind: 'listen' }
}
