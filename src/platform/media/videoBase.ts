/**
 * Where the room videos (~400 MB) come from. On the web they sit next to the app (`/video/...`). The phone
 * app does not carry them (it would be a 400 MB download): it streams each room's footage from the web
 * app's own copy when the room opens, set by `VITE_MEDIA_ORIGIN` (https://app.atriumcoach.com).
 */
export const VIDEO_BASE = `${(import.meta.env.VITE_MEDIA_ORIGIN ?? '').replace(/\/$/, '')}/video`
