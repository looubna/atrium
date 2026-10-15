import { VIDEO_BASE } from '@/platform/media/videoBase'
/**
 * Media for in-person interviews: the arrival, the reception, and the meeting room photo shown
 * behind the interviewers while their faces join.
 */

export const INPERSON_MEDIA_BASE = `${VIDEO_BASE}/inperson`

export type Orientation = 'landscape' | 'portrait'
export type Layout = 'one' | 'panel'

/** The oral exam's room (the one-to-one office photograph). */
export const ROOM_PHOTO: Record<'one', Record<Orientation, string>> = {
  one: {
    landscape: `${INPERSON_MEDIA_BASE}/room/one/landscape.jpg`,
    portrait: `${INPERSON_MEDIA_BASE}/room/one/portrait.jpg`,
  },
}

/**
 * The one-to-one room when the interviewer's live face is on: Evelyn at her office desk, the very
 * clip the face server lip-syncs (`evelyn` on the LiveTalking server, from
 * `infra/livetalking/recordings/evelyn/calm_base.mp4`), so the face lands exactly on it when it
 * joins. One landscape clip serves both orientations, with or without the live face.
 */
export const ONE_FACE_ROOM = {
  still: `${INPERSON_MEDIA_BASE}/room/one_face/base.jpg`,
  loop: `${INPERSON_MEDIA_BASE}/room/one_face/base.mp4`,
}

/**
 * The panel room when its live face is on: Evelyn, Daniel and Grace seated at the table, the clip
 * the face server's `panel_room` is made from (`infra/livetalking/recordings/panel_room/loop.mp4`).
 * One face for the three of them, lip-synced for whoever is speaking. Shown with or without the face.
 */
export const PANEL_FACE_ROOM = {
  still: `${INPERSON_MEDIA_BASE}/room/panel_face/base.jpg`,
  loop: `${INPERSON_MEDIA_BASE}/room/panel_face/base.mp4`,
}

/** A room filmed once per speaker (the debate hall uses this shape). */
export interface RoomTakes {
  /** Nobody has the floor: the room listens. */
  listen: string
  /** The lead is speaking. */
  lead: string
  /** A colleague is speaking. */
  colleagues: string[]
}

/**
 * Arriving: the firm's glass doors (the pass reader beside them), the walk in when the pass is
 * scanned (a clip that ends on the reception photo), and the receptionist's welcome, with her voice.
 */
export interface Arrival {
  door: string
  walkIn: string
  greeting: string
}

export const ARRIVAL: Record<Orientation, Arrival> = {
  landscape: {
    door: `${INPERSON_MEDIA_BASE}/arrival/landscape/door.jpg`,
    walkIn: `${INPERSON_MEDIA_BASE}/arrival/landscape/walkin.mp4`,
    greeting: `${INPERSON_MEDIA_BASE}/arrival/landscape/greet.mp4`,
  },
  portrait: {
    door: `${INPERSON_MEDIA_BASE}/arrival/portrait/door.jpg`,
    walkIn: `${INPERSON_MEDIA_BASE}/arrival/portrait/walkin.mp4`,
    greeting: `${INPERSON_MEDIA_BASE}/arrival/portrait/greet.mp4`,
  },
}

/** The reception, where the candidate waits for the interviewer. */
export const RECEPTION_STILL: Record<Orientation, string> = {
  landscape: `${INPERSON_MEDIA_BASE}/reception/landscape/poster.jpg`,
  portrait: `${INPERSON_MEDIA_BASE}/reception/portrait/poster.jpg`,
}
