import type { ClipFace } from './clipRenderer'

/**
 * The people who were filmed, and who borrows whose footage.
 *
 * This mirrors the server's own `LIVETALKING_FACES` mapping ("person=recording, ..."):
 * only a few people have been filmed, and the rest of the catalogue borrows the nearest
 * one. Kept here rather than fetched because the whole point of these clips is to work
 * when the face server cannot be reached at all.
 */

/** Filmed at one desk, one camera: talking, and listening while they write. */
const FILMED: Record<string, ClipFace> = {
  william: { talking: '/faces/william/talking.mp4', listening: '/faces/william/listening.mp4' },
}

/** Who plays whom, for people with no footage of their own. */
const BORROWS: Record<string, string> = {
  gabriel: 'william',
  pablo: 'william',
  leo: 'william',
  richard: 'william',
  kevin: 'william',
}

/** The clips that play `avatarId`, or null when nobody has been filmed for them. */
export function clipsFor(avatarId: string | undefined): ClipFace | null {
  if (!avatarId) return null
  return FILMED[avatarId] ?? FILMED[BORROWS[avatarId] ?? ''] ?? null
}
