import type { ComponentType, SVGProps } from 'react'
import {
  IconBooks,
  IconBriefcase,
  IconCheck,
  IconChevronRight,
  IconCoffee,
  IconDining,
  IconFlame,
  IconGraduationCap,
  IconHand,
  IconMic,
  IconShoppingBag,
  IconTarget,
} from '../ui/Icon'

/**
 * The Language Center's line icons, drawn like the app's own set (24 px grid, 1.7 stroke, round
 * caps) and designed alongside it in Figma ("Atrium — Language Center"). They replace the
 * emoticons the screens used to carry.
 */
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

type P = SVGProps<SVGSVGElement>

export const IconSpeaker = (p: P) => (
  <svg {...base} {...p}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
)

/** A gauge turned down: speak slowly. */
export const IconSlow = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    <path d="m12 14-4.5-3.5" />
    <circle cx="12" cy="14" r="1.3" />
  </svg>
)

export const IconPeople = (p: P) => (
  <svg {...base} {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)

export const IconPlane = (p: P) => (
  <svg {...base} {...p}>
    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
  </svg>
)

export const IconMap = (p: P) => (
  <svg {...base} {...p}>
    <path d="M14.1 5.55a2 2 0 0 0 1.8 0l3.66-1.83A1 1 0 0 1 21 4.62v12.76a1 1 0 0 1-.55.9l-4.55 2.27a2 2 0 0 1-1.8 0l-4.2-2.1a2 2 0 0 0-1.8 0l-3.66 1.83A1 1 0 0 1 3 19.38V6.62a1 1 0 0 1 .55-.9L8.1 3.45a2 2 0 0 1 1.8 0z" />
    <path d="M15 5.76v15" />
    <path d="M9 3.24v15" />
  </svg>
)

export const IconBed = (p: P) => (
  <svg {...base} {...p}>
    <path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8" />
    <path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4" />
    <path d="M12 4v6" />
    <path d="M2 18h20" />
  </svg>
)

export const IconHome = (p: P) => (
  <svg {...base} {...p}>
    <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
    <path d="M3 10a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
)

export const IconHealth = (p: P) => (
  <svg {...base} {...p}>
    <path d="M11 2v2" />
    <path d="M5 2v2" />
    <path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1" />
    <path d="M8 15a6 6 0 0 0 12 0v-3" />
    <circle cx="20" cy="10" r="2" />
  </svg>
)

export const IconLightbulb = (p: P) => (
  <svg {...base} {...p}>
    <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
    <path d="M9 18h6" />
    <path d="M10 22h4" />
  </svg>
)

export const IconTranslate = (p: P) => (
  <svg {...base} {...p}>
    <path d="m5 8 6 6" />
    <path d="m4 14 6-6 2-3" />
    <path d="M2 5h12" />
    <path d="M7 2h1" />
    <path d="m22 22-5-10-5 10" />
    <path d="M14 18h6" />
  </svg>
)

export const IconPlus = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
)

/** Two speech bubbles: words for a topic. */
export const IconChatBubbles = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h7a2.5 2.5 0 0 1 2.5 2.5v4A2.5 2.5 0 0 1 13 13H8.5L5 15.8V13a2.5 2.5 0 0 1-1.5-2.3Z" />
    <path d="M18 9h.5A2 2 0 0 1 20.5 11v3.8a2 2 0 0 1-1.5 1.9V19l-2.9-2.3H12a2 2 0 0 1-2-1.9" />
  </svg>
)

export {
  IconBooks,
  IconCheck,
  IconChevronRight,
  IconFlame,
  IconGraduationCap,
  IconHand,
  IconMic,
  IconTarget,
}

/** A scenario's icon, by the name the backend gives it. */
export const SCENE_ICONS: Record<string, ComponentType<P>> = {
  plane: IconPlane,
  coffee: IconCoffee,
  food: IconDining,
  bag: IconShoppingBag,
  map: IconMap,
  hotel: IconBed,
  people: IconPeople,
  home: IconHome,
  health: IconHealth,
  briefcase: IconBriefcase,
}
