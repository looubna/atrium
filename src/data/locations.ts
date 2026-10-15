import type { Category, CategoryId, Location } from './types'

/**
 * Top-level areas of life. These mirror the four branches of the product IA;
 * the city surfaces PLACES, and the skills inside each branch are introduced
 * later, from within the relevant location.
 */
export const CATEGORIES: Record<CategoryId, Category> = {
  career: { id: 'career', name: 'Career', color: '#6aa9ff' },
  academic: { id: 'academic', name: 'Academic', color: '#c084fc' },
  social: { id: 'social', name: 'Social & Personal', color: '#fbbf6b' },
  practice: { id: 'practice', name: 'General Practice', color: '#34d399' },
}

export const CATEGORY_ORDER: CategoryId[] = ['career', 'academic', 'social', 'practice']

/**
 * The eight places of the TalkVille model (`public/models/talkville.glb`,
 * built in Blender), with the names and label colours of the Blender render.
 *
 * Positions are the model's own coordinates after the glTF Y-up conversion:
 * Blender (x, y, z) becomes (x, z, -y) here, so the bay lies to the north-east
 * (-z) and the opening shot looks across the city from the south (+z).
 * `labelHeight` is where the Blender render floated each label.
 */
export const LOCATIONS: Location[] = [
  {
    id: 'company',
    name: 'Company',
    shortName: 'Company',
    markerColor: '#4a78ff',
    icon: 'briefcase',
    tagline: 'A mid-size consultancy. Meeting rooms, stakeholders and a boardroom.',
    category: 'career',
    kind: 'tower',
    position: [-37, 0, 12],
    rotation: 0,
    footprint: [18, 14],
    labelHeight: 38,
    focus: { offset: [24, 26, 48] },
    door: [0, 0, 7.5],
    practiceAreas: ['Presentation', 'Negotiation', 'Meeting', 'Networking', 'Leadership', 'Sales', 'Interview'],
    hasInterior: true,
  },
  {
    id: 'university',
    name: 'University',
    shortName: 'University',
    markerColor: '#6b6ff0',
    icon: 'graduation',
    tagline: 'Lecture halls, seminar rooms and the thesis defence committee.',
    category: 'academic',
    kind: 'campus',
    position: [0, 0, -30],
    rotation: 0,
    footprint: [34, 22],
    labelHeight: 25,
    focus: { offset: [16, 20, 44] },
    door: [0, 0, 10],
    practiceAreas: ['Thesis Defence', 'Scholarship / Admissions Interview', 'Academic Presentation', 'Oral Exam', 'Debate'],
    hasInterior: true,
    arrival: 'theater',
  },
  {
    id: 'brain-lab',
    name: 'Brain Lab',
    shortName: 'Brain Lab',
    markerColor: '#2cb8c4',
    icon: 'brain',
    tagline: 'Understand your brain. Change how you speak, feel and act.',
    category: 'social',
    kind: 'lab',
    // Where the waterfront restaurant stood (cut out of the model: CUTOUTS in TalkVilleModel).
    position: [23.5, 0, -24.5],
    rotation: Math.PI / 2,
    footprint: [12, 11],
    labelHeight: 15,
    focus: { offset: [14, 14, 34] },
    door: [0, 0, 6],
    practiceAreas: ['Brain consultation'],
    exterior: true,
  },
  {
    id: 'park',
    name: 'Park',
    shortName: 'Park',
    markerColor: '#3fbf5f',
    icon: 'tree',
    tagline: 'Open air and no agenda. Storytelling, and the harder talks.',
    category: 'social',
    kind: 'park',
    position: [-8.25, 0, 10.5],
    rotation: 0,
    footprint: [20, 37],
    labelHeight: 10,
    focus: { offset: [10, 20, 46] },
    door: [0, 0, 19],
    practiceAreas: ['Storytelling', 'Emotional Communication', 'Group Conversations'],
  },
  {
    id: 'cafe',
    name: 'Café & Restaurant',
    shortName: 'Café',
    markerColor: '#ec5a45',
    icon: 'coffee',
    tagline: 'Coffee, dinner, and every conversation in between.',
    category: 'social',
    kind: 'cafe',
    position: [18.5, 0, 2],
    rotation: 0,
    footprint: [15, 16],
    // Just above the roof: any higher and it collides with the Shopping Mall
    // label in the overview.
    labelHeight: 10,
    // From the north-west over the terrace, the bay behind: the old south view was blocked by the tower.
    focus: { offset: [-20, 14, 20] },
    door: [0, 0, 8],
    practiceAreas: ['Starting Conversations', 'Everyday Communication'],
  },
  {
    id: 'mall',
    name: 'Language Center',
    shortName: 'Language Center',
    markerColor: '#a766f2',
    icon: 'language',
    tagline: 'Learn a language by speaking it: real scenes, tips as you talk, and a plan built around you.',
    category: 'social',
    kind: 'mall',
    position: [52, 0, 12],
    rotation: 0,
    footprint: [34, 30],
    // Raised clear of the Café label, which sits close by in the overview.
    labelHeight: 23,
    focus: { offset: [16, 17, 42] },
    // The glass rotunda on the south-west corner.
    door: [-8.5, 0, 16],
    practiceAreas: ['Conversation', 'Vocabulary', 'Pronunciation'],
    opens: 'language',
  },
  {
    id: 'practice-center',
    name: 'Practice Center',
    shortName: 'Practice Center',
    markerColor: '#2cc4cf',
    icon: 'target',
    tagline: 'Neutral ground. Short drills to warm up before anything else.',
    category: 'practice',
    kind: 'practice',
    position: [-7, 0, 53],
    rotation: 0,
    footprint: [22, 26],
    labelHeight: 13,
    focus: { offset: [14, 16, 38] },
    door: [0, 0, 12],
    practiceAreas: [
      'Random Word Story',
      'Think on Your Feet',
      'Framework Challenge',
      'Explain it Simply',
      'Take Both Sides',
      'Describe the Image',
      'Recall & Retell',
      'Pause, Don’t Fill',
      'Emphasis & Melody',
      'Clear Diction',
      'Pace Control',
      'Speak to the Lens',
      'Project to the End',
    ],
  },
  {
    id: 'bus-stop',
    name: 'Bus Stop',
    shortName: 'Bus Stop',
    markerColor: '#2aa9d6',
    icon: 'bus',
    tagline: 'Ninety seconds with a stranger. Then the bus comes.',
    category: 'social',
    kind: 'busStop',
    position: [19, 0, 40.6],
    // The shelters open onto the avenue to the north.
    rotation: Math.PI,
    footprint: [12, 3],
    labelHeight: 9,
    // From the north-west over the roundabout, looking down the avenue: the
    // bus, both shelters and the road in one shot. (Local frame: with the
    // stop rotated by PI this is world (-14, 12, -10).) The obvious framing
    // from across the road is blocked by the red-roofed house next door.
    focus: { offset: [14, 12, 10] },
    door: [0, 0, 2],
    practiceAreas: ['Small Talk', 'Help & Boundaries'],
  },
]

export const LOCATIONS_BY_ID = new Map(LOCATIONS.map((l) => [l.id, l]))

export const getLocation = (id: string | null): Location | undefined =>
  id ? LOCATIONS_BY_ID.get(id) : undefined
