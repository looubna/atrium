/**
 * Media for in-person interviews: the arrival, the reception, and the meeting room photo shown
 * behind the interviewers while their faces join.
 */

export const INPERSON_MEDIA_BASE = '/video/inperson'

export type Orientation = 'landscape' | 'portrait'
export type Layout = 'one' | 'panel'

export const ROOM_PHOTO: Record<Layout, Record<Orientation, string>> = {
  one: {
    landscape: `${INPERSON_MEDIA_BASE}/room/one/landscape.jpg`,
    portrait: `${INPERSON_MEDIA_BASE}/room/one/portrait.jpg`,
  },
  panel: {
    landscape: `${INPERSON_MEDIA_BASE}/room/panel/landscape.jpg`,
    portrait: `${INPERSON_MEDIA_BASE}/room/panel/portrait.jpg`,
  },
}

/**
 * The one-to-one room when the interviewer's live face is on: Evelyn at her office desk, the very
 * clip the face server lip-syncs (`evelyn` on the LiveTalking server, from
 * `infra/livetalking/recordings/evelyn/calm_base.mp4`), so the face lands exactly on it when it
 * joins. One landscape clip serves both orientations. Without a face the room falls back to
 * `ROOM_TAKES.one`.
 */
export const ONE_FACE_ROOM = {
  still: `${INPERSON_MEDIA_BASE}/room/one_face/base.jpg`,
  loop: `${INPERSON_MEDIA_BASE}/room/one_face/base.mp4`,
}

/**
 * The panel room when its live face is on: Evelyn, Daniel and Grace seated at the table, the clip
 * the face server's `panel_room` is made from (`infra/livetalking/recordings/panel_room/loop.mp4`).
 * One face for the three of them, lip-synced for whoever is speaking. Without a face the room falls
 * back to `ROOM_TAKES.panel`.
 */
export const PANEL_FACE_ROOM = {
  still: `${INPERSON_MEDIA_BASE}/room/panel_face/base.jpg`,
  loop: `${INPERSON_MEDIA_BASE}/room/panel_face/base.mp4`,
}

/**
 * The room, filmed once per speaker: everyone listening, and each person who can take the floor
 * talking while the other two listen.
 *
 * The camera never moves and never cuts away — it is the candidate's own view from their chair —
 * so the only thing that changes between turns is which take is running. Every take starts and
 * ends on the room photograph, so changing take lands on the frame already on screen and there is
 * nothing to see in it.
 *
 * This is what makes it a room rather than a picture of one. Interviews are voice only, so
 * without it three people sit still through every question; with it, the person who is speaking
 * is the person whose mouth is moving. It is not lip-sync and does not pretend to be: at this
 * distance a head is about 77 px across, and what reads at that size is who is talking, not which
 * syllable they are on.
 *
 * Every take is optional. A missing one falls back to the listening take, and that to the
 * photograph, so a room with no footage at all still works.
 */
export interface RoomTakes {
  /** Nobody from the panel has the floor: the candidate is answering and the room listens. */
  listen: string
  /** The lead interviewer is speaking. */
  lead: string
  /** A colleague is speaking, in the order they appear in `PANEL_IN_PERSON`. */
  colleagues: string[]
}

const takes = (base: string): RoomTakes => ({
  listen: `${base}.mp4`,
  lead: `${base}_lead.mp4`,
  colleagues: [`${base}_colleague.mp4`],
})

export const ROOM_TAKES: Record<Layout, Record<Orientation, RoomTakes>> = {
  one: {
    landscape: takes(`${INPERSON_MEDIA_BASE}/room/one/landscape`),
    portrait: takes(`${INPERSON_MEDIA_BASE}/room/one/portrait`),
  },
  panel: {
    landscape: takes(`${INPERSON_MEDIA_BASE}/room/panel/landscape`),
    portrait: takes(`${INPERSON_MEDIA_BASE}/room/panel/portrait`),
  },
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
