/**
 * The small-room presentation, seen from the presenter's seat as footage rather
 * than as the 3D room: a still image and short video loops dropped into
 * `public/video/meeting/<orientation>/`. See docs/meeting-video.md.
 */

/** Seat ids of the three attendees, shared by the 3D room and the video view. */
export const MEETING_ATTENDEE_IDS = [900, 901, 902] as const
/**
 * Stand-in seat ids for an audience. Nobody is modelled in the rooms any more, so these name
 * no one: they only let a few hands be up at once, and the footage shows whose hand it is.
 */
export const AUDIENCE_ATTENDEE_IDS = [910, 911, 912, 913, 914, 915] as const

export const MEETING_MEDIA_BASE = '/video/meeting'
/** The auditorium from the lectern, same layout: `<orientation>/poster.jpg` plus clips. */
export const THEATER_MEDIA_BASE = '/video/theater'
/** The university lecture hall, from the lectern of a thesis defence. */
export const DEFENSE_MEDIA_BASE = '/video/defense'
/** A one-to-one interview in person: the interviewer across the table. */
export const INTERVIEW_MEDIA_BASE = '/video/interview'
/** An academic presentation: a university classroom of students, from the lectern laptop. */
export const ACADEMIC_MEDIA_BASE = '/video/academic'
/** A debate: the opposition team at their table and an audience, from the speaker's lectern. */
export const DEBATE_MEDIA_BASE = '/video/debate'

/** Sessions (by format id) with a room of their own, used in place of the location's stage. */
export const FORMAT_MEDIA: Record<string, string> = {
  'academic-presentation': ACADEMIC_MEDIA_BASE,
  debate: DEBATE_MEDIA_BASE,
}

/** Which footage stands in for a room, per location. */
export const ROOM_MEDIA: Record<string, Partial<Record<'meeting' | 'theater', string>>> = {
  company: { meeting: MEETING_MEDIA_BASE, theater: THEATER_MEDIA_BASE },
  university: { theater: DEFENSE_MEDIA_BASE },
}

export type MeetingOrientation = 'landscape' | 'portrait'

type Point = [number, number]
export type Quad = [Point, Point, Point, Point]

/**
 * The presenter's own laptop in a footage set, in the footage's pixels (corners
 * top-left, top-right, bottom-right, bottom-left). The generated video may draw
 * anything on that screen, so the still frame is always shown over the lid, and
 * a shared screen is drawn onto the display.
 */
export interface ScreenSurface {
  lid: Quad
  display: Quad
  /** Width : height of the display; a laptop is 16:10, a projector 16:9. */
  aspect?: [number, number]
  /** An image of the room with this screen cleaned (e.g. blanked), shown over it instead of the still frame. */
  cover?: string
  /** Whether slides and shared screens are drawn on it (default true). */
  slides?: boolean
}

export const PRESENTER_SCREENS: Record<string, { frame: Point; focusX?: number; focusY?: number; surfaces: ScreenSurface[] }> = {
  [`${THEATER_MEDIA_BASE}/landscape`]: {
    frame: [1920, 1080],
    surfaces: [{ lid: [[92, 620], [617, 616], [621, 898], [78, 902]], display: [[112, 634], [608, 626], [612, 872], [100, 891]] }],
  },
  [`${THEATER_MEDIA_BASE}/portrait`]: {
    frame: [1080, 1920],
    // An upright phone is narrower than the footage: keep the laptop's edge in view.
    focusX: 0.05,
    surfaces: [{ lid: [[0, 1106], [644, 1098], [650, 1500], [0, 1504]], display: [[14, 1144], [628, 1132], [632, 1470], [12, 1480]] }],
  },
  // Thesis defence: slides show on the lectern laptop; the projector is kept blank.
  [`${DEFENSE_MEDIA_BASE}/landscape`]: {
    frame: [1920, 1080],
    surfaces: [
      { lid: [[175, 656], [665, 644], [689, 910], [161, 930]], display: [[189, 668], [661, 663], [679, 904], [174, 921]] },
      { lid: [[686, 42], [1190, 41], [1190, 276], [686, 277]], display: [[700, 53], [1180, 52], [1180, 266], [700, 267]], cover: `${DEFENSE_MEDIA_BASE}/landscape/screen_blank.jpg`, slides: false },
    ],
  },
  [`${DEFENSE_MEDIA_BASE}/portrait`]: {
    frame: [1080, 1920],
    focusX: 0.1,
    surfaces: [
      { lid: [[39, 1123], [595, 1114], [623, 1470], [34, 1482]], display: [[51, 1132], [592, 1123], [611, 1454], [45, 1464]] },
      { lid: [[370, 92], [1008, 90], [1008, 448], [370, 450]], display: [[380, 102], [999, 99], [999, 436], [380, 441]], cover: `${DEFENSE_MEDIA_BASE}/portrait/screen_blank.jpg`, slides: false },
    ],
  },
  // Academic presentation: the laptop in the images shows someone else's slides, so it is
  // blanked until the user uploads theirs, which then appear on it.
  [`${ACADEMIC_MEDIA_BASE}/landscape`]: {
    frame: [1920, 1080],
    // A wide phone crops top and bottom: keep the laptop, low in the frame, in view.
    focusY: 0.75,
    surfaces: [
      { lid: [[226, 587], [927, 568], [967, 981], [214, 1046]], display: [[246, 616], [916, 593], [949, 964], [233, 1010]], cover: `${ACADEMIC_MEDIA_BASE}/landscape/screen_blank.jpg` },
    ],
  },
  [`${ACADEMIC_MEDIA_BASE}/portrait`]: {
    frame: [1080, 1920],
    focusX: 0.05,
    surfaces: [
      { lid: [[47, 1134], [750, 1091], [814, 1550], [54, 1629]], display: [[66, 1168], [740, 1125], [791, 1528], [72, 1604]], cover: `${ACADEMIC_MEDIA_BASE}/portrait/screen_blank.jpg` },
    ],
  },
  // Debate: slides show on the lectern laptop; the round timer on the wall screen is cleared.
  // The upright image has no laptop, so it has no surfaces.
  [`${DEBATE_MEDIA_BASE}/landscape`]: {
    frame: [1920, 1080],
    // A wide phone crops top and bottom: favour the laptop and the opposition table.
    focusY: 0.85,
    surfaces: [
      { lid: [[39, 654], [679, 607], [736, 948], [61, 1063]], display: [[63, 682], [660, 635], [711, 919], [85, 1014]], cover: `${DEBATE_MEDIA_BASE}/landscape/screen_blank.jpg` },
      { lid: [[780, 0], [1152, 0], [1152, 170], [780, 170]], display: [[790, 6], [1142, 6], [1142, 162], [790, 162]], aspect: [16, 9], cover: `${DEBATE_MEDIA_BASE}/landscape/screen_blank.jpg`, slides: false },
      // The "OPPOSITION" name card: the generated video blurs its letters, so the still frame is kept over it.
      { lid: [[788, 490], [925, 490], [925, 536], [788, 536]], display: [[788, 490], [925, 490], [925, 536], [788, 536]], slides: false },
    ],
  },
  // Upright: no laptop, only the name card to keep sharp.
  [`${DEBATE_MEDIA_BASE}/portrait`]: {
    frame: [1080, 1920],
    surfaces: [{ lid: [[374, 893], [577, 893], [577, 956], [374, 956]], display: [[374, 893], [577, 893], [577, 956], [374, 956]], slides: false }],
  },
}

/**
 * - `intro`: optional, plays once on arrival (a welcome), ending on the poster frame.
 * - `idle`: the room listening; loops.
 * - `listen_1`, `listen_2`: optional variations (a nod, a glance) mixed into idle.
 * - `hand_raise` → `hand_wait` (loops while a question waits) → `hand_lower`.
 * Every clip is optional except `idle`; without it the still image is shown.
 */
export type MeetingClip = 'intro' | 'idle' | 'listen_1' | 'listen_2' | 'hand_raise' | 'hand_wait' | 'hand_lower'

export const MEETING_CLIPS: MeetingClip[] = ['intro', 'idle', 'listen_1', 'listen_2', 'hand_raise', 'hand_wait', 'hand_lower']

/** Tried in order for each clip. */
export const MEETING_VIDEO_EXTENSIONS = ['mp4', 'webm'] as const
