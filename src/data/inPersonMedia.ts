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
