import type { NetworkingTag } from './practice'

/**
 * The networking reception: a hall of guests, some wearing a floating name tag.
 * Tapping a tag joins that person's conversation, face to face.
 */

export const NETWORKING_MEDIA_BASE = '/video/networking'
/** Each guest face to face, `<id>_land` and `<id>_port` (.mp4 loop, .jpg first frame). */
export const NETWORKING_CLOSEUP_BASE = '/video/networking/close'
/**
 * Guests filmed for a live, lip-synced face: on their own and close, facing the user, listening with
 * a closed mouth, the people behind them standing still (`<id>_face.mp4` / `.jpg`, one landscape clip
 * for both orientations). It is the same clip the face server paints the lips on, looped forward, so
 * the footage and the live face line up exactly.
 */
export const NETWORKING_FACES: ReadonlySet<string> = new Set([
  'marketing',
  'product',
  'analyst',
  'director',
  'founder',
  'engineer',
  'recruiter',
])
/** Pixel size of the footage the positions below are measured in. */
export const NETWORKING_FRAME: [number, number] = [1672, 940]
/** Listening loops, shuffled; any that are missing are skipped. */
// listen_1 was dropped: the generated video drew an extra, unreadable name tag.
export const NETWORKING_CLIPS = ['idle', 'listen_2'] as const

export interface NetworkingPerson {
  id: string
  name: string
  role: string
  department: string
  kind: NetworkingTag
  /**
   * Centre and size of the tag in the footage. The first four cover a tag drawn into the
   * image; the others float just beside the guest's head, clear of the drawn ones.
   */
  tag: { x: number; y: number; w: number; h: number }
  accent: string
}

export const NETWORKING_PEOPLE: NetworkingPerson[] = [
  {
    id: 'marketing',
    name: 'Sara Benali',
    role: 'Marketing Manager',
    department: 'Marketing',
    kind: 'peer',
    tag: { x: 570, y: 341, w: 146, h: 54 },
    accent: '#6d63f2',
  },
  {
    id: 'product',
    name: 'Omar Haddad',
    role: 'Senior Manager',
    department: 'Product',
    kind: 'senior',
    tag: { x: 865, y: 329, w: 182, h: 56 },
    accent: '#2f8f6b',
  },
  {
    id: 'analyst',
    name: 'Lina Chen',
    role: 'Analyst',
    department: 'Finance',
    kind: 'peer',
    tag: { x: 1139, y: 360, w: 124, h: 50 },
    accent: '#5b5fd6',
  },
  {
    id: 'director',
    name: 'James Carter',
    role: 'Director',
    department: 'Operations',
    kind: 'executive',
    tag: { x: 1475, y: 300, w: 136, h: 52 },
    accent: '#5b5fd6',
  },
  {
    id: 'founder',
    name: 'Yusuf Rahman',
    role: 'Founder',
    department: 'FinTech startup',
    kind: 'client',
    tag: { x: 380, y: 300, w: 130, h: 46 },
    accent: '#b8436b',
  },
  {
    id: 'engineer',
    name: 'Daniel Kim',
    role: 'Junior Developer',
    department: 'Engineering',
    kind: 'junior',
    tag: { x: 680, y: 430, w: 130, h: 46 },
    accent: '#2b7fb8',
  },
  {
    id: 'recruiter',
    name: 'Amira Khalil',
    role: 'Talent Lead',
    department: 'Human Resources',
    kind: 'senior',
    tag: { x: 1590, y: 368, w: 120, h: 46 },
    accent: '#2f8f6b',
  },
]
