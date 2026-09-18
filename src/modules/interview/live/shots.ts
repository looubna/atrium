/**
 * Who is talking in the meeting room. Nobody is shown on screen — the interviewer has no
 * face — so this only drives the caption naming the speaker.
 */

/** Who is talking: the lead, a panel colleague by name, or nobody. */
export type Speaker = { kind: 'lead' } | { kind: 'colleague'; name: string } | null

/** How long the speaker caption holds after someone stops, so short pauses don't flicker. */
export const CUT_BACK_MS = 800
