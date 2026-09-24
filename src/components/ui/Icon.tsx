import type { SVGProps } from 'react'

/** Hand-rolled icon set — a whole icon library would be a lot of weight for six glyphs. */
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

export const IconUser = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
  </svg>
)

export const IconCode = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5M13.4 5l-2.8 14" />
  </svg>
)

export const IconSettings = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2.1" />
    <circle cx="8" cy="17" r="2.1" />
  </svg>
)

export const IconArrowLeft = (p: P) => (
  <svg {...base} {...p}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </svg>
)

export const IconEnter = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 12h12M12.5 7.5 17 12l-4.5 4.5" />
    <path d="M20 4v16" />
  </svg>
)

export const IconOrbit = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <ellipse cx="12" cy="12" rx="9.2" ry="4.2" transform="rotate(-28 12 12)" />
  </svg>
)

export const IconScroll = (p: P) => (
  <svg {...base} {...p}>
    <rect x="8" y="3.2" width="8" height="17.6" rx="4" />
    <path d="M12 7v3" />
  </svg>
)

export const IconPin = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 21s6.5-6.2 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 14.8 12 21 12 21Z" />
    <circle cx="12" cy="10.3" r="2.2" />
  </svg>
)

export const IconLayers = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3.5 21 8l-9 4.5L3 8l9-4.5Z" />
    <path d="M21 13.2 12 17.7 3 13.2" />
  </svg>
)

export const IconChevronRight = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </svg>
)

export const IconCheck = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 12.5 10 17.5 19 7" />
  </svg>
)

/** Contactless waves — scanning a pass. */
export const IconScan = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8.5 8.5a5 5 0 0 1 0 7M12 6a8.5 8.5 0 0 1 0 12M15.5 3.5a12 12 0 0 1 0 17" />
    <circle cx="5" cy="12" r="1" fill="currentColor" />
  </svg>
)

export const IconChair = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7 3.5v9h10M7 12.5 6 20.5M17 12.5l1 8M7 16.5h10" />
  </svg>
)

export const IconStanding = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="4.8" r="2" />
    <path d="M12 7.5v7.5M12 15l-2.8 5.5M12 15l2.8 5.5M8 10.5h8" />
  </svg>
)

export const IconTimer = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="13.5" r="7.5" />
    <path d="M12 9.5v4l2.5 2M9.5 2.5h5" />
  </svg>
)

/** A raised hand — asking a question. */
export const IconHand = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0v8" />
    <path d="M8 12.5 6.6 11a1.6 1.6 0 0 0-2.4 2.1l3 4.4A6 6 0 0 0 12.2 20h.3A4.5 4.5 0 0 0 17 15.5v-2" />
  </svg>
)

export const IconClose = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

/* --- Video call controls --- */

export const IconMic = (p: P) => (
  <svg {...base} {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </svg>
)

export const IconMicOff = (p: P) => (
  <svg {...base} {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M4 4l16 16" />
  </svg>
)

export const IconVideo = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3" y="6.5" width="12.5" height="11" rx="2.5" />
    <path d="M15.5 10.5 21 7.5v9l-5.5-3" />
  </svg>
)

export const IconVideoOff = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3" y="6.5" width="12.5" height="11" rx="2.5" />
    <path d="M15.5 10.5 21 7.5v9l-5.5-3M3 3l18 18" />
  </svg>
)

export const IconShareScreen = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M8.5 20.5h7M12 13V8M9.5 10.5 12 8l2.5 2.5" />
  </svg>
)

export const IconPhoneOff = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3.5 14.5c4.7-4.2 12.3-4.2 17 0l-1.7 2.7-3.6-1.3v-2.4a11 11 0 0 0-6.4 0v2.4l-3.6 1.3z" />
  </svg>
)

/* --- Place glyphs, after the TalkVille map art --- */

export const IconBriefcase = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3" y="7.5" width="18" height="12" rx="2" />
    <path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" />
    <path d="M3 12.5h18" />
  </svg>
)

export const IconGraduationCap = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 5 2.5 9.5 12 14l9.5-4.5L12 5Z" />
    <path d="M6.5 11.8v3.7c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-3.7" />
    <path d="M21.5 9.5v5" />
  </svg>
)

export const IconDining = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 3v6.5a3 3 0 0 0 3 3V21M12 3v6.5a3 3 0 0 1-3 3M9 3v5" />
    <path d="M18 21V3c-2.2 1.6-3.4 4.2-3.4 7.4V14H18" />
  </svg>
)

export const IconTree = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3a5.5 5.5 0 0 0-4.6 8.5A4.2 4.2 0 0 0 10 18h4a4.2 4.2 0 0 0 2.6-6.5A5.5 5.5 0 0 0 12 3Z" />
    <path d="M12 21v-8" />
  </svg>
)

export const IconCoffee = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4.5 9h12v5.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V9Z" />
    <path d="M16.5 10.5h1.3a2.6 2.6 0 0 1 0 5.2h-1.6" />
    <path d="M8.5 3.5v2.5M12.5 3.5v2.5" />
  </svg>
)

export const IconShoppingBag = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5.5 8h13l-1 12.5h-11L5.5 8Z" />
    <path d="M9 10.5v-4a3 3 0 0 1 6 0v4" />
  </svg>
)

/** Two speech bubbles: a conversation, in another language. */
export const IconChat = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h7a2.5 2.5 0 0 1 2.5 2.5v4A2.5 2.5 0 0 1 13 13H8.5L5 15.8V13a2.5 2.5 0 0 1-1.5-2.3Z" />
    <path d="M18 9h.5A2 2 0 0 1 20.5 11v3.8a2 2 0 0 1-1.5 1.9V19l-2.9-2.3H12a2 2 0 0 1-2-1.9" />
  </svg>
)

export const IconTarget = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </svg>
)

export const IconBus = (p: P) => (
  <svg {...base} {...p}>
    <rect x="5" y="3.5" width="14" height="14.5" rx="2.5" />
    <path d="M5 11h14M8 6.5h8M8.5 21v-3M15.5 21v-3" />
    <circle cx="8.5" cy="14.5" r="0.8" fill="currentColor" />
    <circle cx="15.5" cy="14.5" r="0.8" fill="currentColor" />
  </svg>
)

export const IconUpload = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
    <path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15" />
  </svg>
)

export const IconFile = (p: P) => (
  <svg {...base} {...p}>
    <path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8L14 3.5Z" />
    <path d="M14 3.5V8h4.5M8.5 13h7M8.5 16.5h5" />
  </svg>
)

export const IconChevronLeft = (p: P) => (
  <svg {...base} {...p}>
    <path d="m14.5 6-6 6 6 6" />
  </svg>
)

export const IconFlame = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 21c3.6 0 6-2.4 6-5.8 0-3.6-2.6-5.6-3.6-8.7-.3 1.9-1.3 3-2.3 3.5C12.6 7.2 11 4.6 8.8 3c.3 3.3-2.8 5.6-2.8 10.2C6 18.6 8.4 21 12 21Z" />
    <path d="M12 21c-1.6 0-2.7-1.1-2.7-2.7 0-1.9 1.6-2.6 2.1-4.3 1.4 1 3.3 2.3 3.3 4.3 0 1.6-1.1 2.7-2.7 2.7Z" />
  </svg>
)

export const IconMedal = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8 3h8l-2.2 5.2M8 3l2.2 5.2" />
    <circle cx="12" cy="14.5" r="5.5" />
    <path d="m12 12 .9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 14.1l2-.3Z" />
  </svg>
)

export const IconLink = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5" />
    <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5" />
  </svg>
)

export const IconText = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 5h12M6 5v2M18 5v2M12 5v14M9.5 19h5" />
  </svg>
)

export const IconBoard = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="4.5" width="17" height="11.5" rx="1.5" />
    <path d="M12 16v3.5M9 20h6M7.5 8.5h6M7.5 12h3.5" />
  </svg>
)

export const IconBooks = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4.5 5.5A1.5 1.5 0 0 1 6 4h4.5v16H6a1.5 1.5 0 0 1-1.5-1.5Z" />
    <path d="M10.5 4H15a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 15 20h-4.5" />
    <path d="M18 6.5 20 7l-2.2 11.5" />
  </svg>
)

export const IconEye = (p: P) => (
  <svg {...base} {...p}>
    <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.9" />
  </svg>
)

export const IconEyeOff = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9.9 6.1A8.7 8.7 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-3.3 3.9M6.4 7.9A17 17 0 0 0 2.5 12S6 18.2 12 18.2c1.1 0 2.1-.2 3-.5" />
    <path d="M10 10a2.9 2.9 0 0 0 4 4M4 4l16 16" />
  </svg>
)

export const IconWrite = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 20.5 8.2 19.4 19.6 8a2.3 2.3 0 0 0-3.2-3.2L5 16.2 4 20.5Z" />
    <path d="M15.4 5.8 18.6 9" />
  </svg>
)

export const IconUndo = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 9h9.5a5.5 5.5 0 0 1 0 11H8" />
    <path d="M7.5 5.5 4 9l3.5 3.5" />
  </svg>
)
