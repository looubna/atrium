/**
 * The debate hall, seen from the speaker's own lectern: the opposition bench across the floor,
 * the audience behind them, the round clock on the wall.
 *
 * Shaped like the interview room's media (`inPersonMedia.ts`) on purpose — a photograph that every
 * take starts and ends on, and one take per person who can hold the floor — so footage can be
 * dropped in later with no code change. Until a take exists the photograph is what shows, and the
 * debate reads as quiet rather than as wrong.
 */

import type { Orientation, RoomTakes } from './inPersonMedia'
import { VIDEO_BASE } from '@/platform/media/videoBase'

export const DEBATE_MEDIA_BASE = `${VIDEO_BASE}/debate/hall`

export const DEBATE_HALL: Record<Orientation, string> = {
  landscape: `${DEBATE_MEDIA_BASE}/landscape_calm.jpg`,
  portrait: `${DEBATE_MEDIA_BASE}/portrait_calm.jpg`,
}

/**
 * The hall filmed on that frame, one calm take for both states: the man in the centre chair sits
 * with his hands on the table and his mouth shut, the woman beside him writes, the audience
 * listens. His mouth moves only when the face server lip-syncs it to his voice — the take he was
 * filmed arguing in waved both hands and mouthed words of its own, so it looked like talking
 * through every silence and fought the lip-sync painted over it. `colleagues` stays empty — a
 * debate has one opponent with the floor, and the two beside them never take it.
 */
export const DEBATE_TAKES: Record<Orientation, RoomTakes> = {
  landscape: {
    listen: `${DEBATE_MEDIA_BASE}/landscape_calm.mp4`,
    lead: `${DEBATE_MEDIA_BASE}/landscape_calm.mp4`,
    colleagues: [],
  },
  portrait: {
    listen: `${DEBATE_MEDIA_BASE}/portrait_calm.mp4`,
    lead: `${DEBATE_MEDIA_BASE}/portrait_calm.mp4`,
    colleagues: [],
  },
}

/**
 * There is no close-up. `debate_opponent` on the face server is built from the wide hall clip
 * itself, so the lip-synced stream is this room with the centre chair's mouth moving — the shot
 * never changes and the candidate is never taken out of the hall to watch one man's face.
 */
