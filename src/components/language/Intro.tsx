import { LANGUAGES } from '@/data/language'
import { IconBooks, IconLightbulb, IconMic, IconTarget } from './icons'

const FEATURES = [
  { Icon: IconMic, text: 'Talk out loud in real scenes' },
  { Icon: IconLightbulb, text: 'Tips on what you say, as you say it' },
  { Icon: IconTarget, text: 'A plan built around your goals' },
  { Icon: IconBooks, text: 'A vocab coach for the words you meet' },
]

/** What the Language Center offers, in the location panel before going in. */
export function LanguageCenterIntro() {
  return (
    <div className="mt-4">
      <ul className="grid gap-1.5">
        {FEATURES.map((f) => (
          <li key={f.text} className="flex items-center gap-2.5 text-[12.5px] text-mist">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-jade-500/12 text-jade-400" aria-hidden>
              <f.Icon width={15} height={15} />
            </span>
            {f.text}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-1 text-[16px]" aria-label={`${LANGUAGES.length} languages`}>
        {LANGUAGES.map((l) => (
          <span key={l.id} title={l.name}>{l.flag}</span>
        ))}
      </div>
    </div>
  )
}
