/**
 * The Language Center's languages, levels and scene icons. Mirrors
 * `backend/app/modules/language/catalog.py` (ids, names, flags), kept in step by a backend test.
 */

export interface LanguageInfo {
  id: string
  name: string
  /** What speakers call it. */
  native: string
  flag: string
  /** BCP-47 code for replaying a line with the device's own voice. */
  speech: string
}

export const LANGUAGES: LanguageInfo[] = [
  { id: 'en', name: 'English', native: 'English', flag: '🇬🇧', speech: 'en-GB' },
  { id: 'fr', name: 'French', native: 'Français', flag: '🇫🇷', speech: 'fr-FR' },
  { id: 'es', name: 'Spanish', native: 'Español', flag: '🇪🇸', speech: 'es-ES' },
  { id: 'de', name: 'German', native: 'Deutsch', flag: '🇩🇪', speech: 'de-DE' },
  { id: 'it', name: 'Italian', native: 'Italiano', flag: '🇮🇹', speech: 'it-IT' },
  { id: 'pt', name: 'Portuguese', native: 'Português', flag: '🇧🇷', speech: 'pt-BR' },
  { id: 'ar', name: 'Arabic', native: 'العربية', flag: '🇸🇦', speech: 'ar-SA' },
  { id: 'zh', name: 'Chinese', native: '中文', flag: '🇨🇳', speech: 'zh-CN' },
  { id: 'ja', name: 'Japanese', native: '日本語', flag: '🇯🇵', speech: 'ja-JP' },
  { id: 'ko', name: 'Korean', native: '한국어', flag: '🇰🇷', speech: 'ko-KR' },
  { id: 'ru', name: 'Russian', native: 'Русский', flag: '🇷🇺', speech: 'ru-RU' },
  { id: 'tr', name: 'Turkish', native: 'Türkçe', flag: '🇹🇷', speech: 'tr-TR' },
  { id: 'nl', name: 'Dutch', native: 'Nederlands', flag: '🇳🇱', speech: 'nl-NL' },
  { id: 'hi', name: 'Hindi', native: 'हिन्दी', flag: '🇮🇳', speech: 'hi-IN' },
]

export const languageById = (id: string | null | undefined): LanguageInfo =>
  LANGUAGES.find((l) => l.id === id) ?? LANGUAGES[0]

export type LanguageLevel = 'beginner' | 'elementary' | 'intermediate' | 'advanced'

export const LEVELS: { id: LanguageLevel; name: string; hint: string }[] = [
  { id: 'beginner', name: 'Beginner', hint: 'A few words, or none yet' },
  { id: 'elementary', name: 'Elementary', hint: 'Simple everyday sentences' },
  { id: 'intermediate', name: 'Intermediate', hint: 'Conversations on familiar topics' },
  { id: 'advanced', name: 'Advanced', hint: 'Fluent, polishing the details' },
]

/** Ready-made goals to pick from; free text is accepted too. */
export const GOALS = ['Travel', 'Work', 'Studies', 'Family & friends', 'Moving abroad', 'Just for fun']

/** Who each ready-made scene is with, in a word or two (the tile's second line). */
export const SCENE_WHO: Record<string, string> = {
  'airport': 'Information desk',
  'cafe': 'Barista',
  'street-food': 'Food vendor',
  'market': 'Stallholder',
  'directions': 'A local',
  'hotel': 'Receptionist',
  'friends': 'Language exchange',
  'family': 'Dinner host',
  'doctor': 'Doctor',
  'work': 'New colleague',
}
