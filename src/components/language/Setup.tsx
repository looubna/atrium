import { useState } from 'react'
import { GOALS, LANGUAGES, LEVELS, languageById, type LanguageLevel } from '@/data/language'
import { cn } from '@/lib/utils'
import { saveLanguageProfile, type LanguageProfile, type LanguageState } from '@/modules/language/api'
import { Button } from '../ui/Button'
import { IconCheck } from '../ui/Icon'
import { ACCENT, ScreenHeader, Spinner, problem } from './shared'

type Step = 'target' | 'native' | 'level' | 'goals'
const ALL_STEPS: Step[] = ['target', 'native', 'level', 'goals']
/** The app's selected state (as in its Speaker / Headphones choice). */
const SELECTED = 'border-jade-400/40 bg-jade-500/12'

/**
 * First visit (or changing language): what to learn, from which language, how well already, and
 * why. The answers write the learner's plan.
 */
export function Setup({ profile, learning, onDone, onBack }: {
  profile: LanguageProfile | null
  /** Languages already being learned: marked, and one tap away from the home row instead. */
  learning: string[]
  onDone: (state: LanguageState) => void
  onBack: () => void
}) {
  // Every language has its own: Korean may be learned from Arabic, French from English.
  const STEPS = ALL_STEPS
  const adding = Boolean(profile)
  const [step, setStep] = useState<Step>('target')
  const [target, setTarget] = useState('')
  const [native, setNative] = useState(profile?.native ?? 'en')
  const [level, setLevel] = useState<LanguageLevel>('beginner')
  const [goals, setGoals] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const index = STEPS.indexOf(step)
  const back = () => (index === 0 ? onBack() : setStep(STEPS[index - 1]))
  const next = () => setStep(STEPS[index + 1])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      onDone(await saveLanguageProfile({ target, native, level, goals: goals.join(', ') }))
    } catch (e) {
      setError(problem(e))
      setSaving(false)
    }
  }

  if (saving) return <Spinner label={`Writing your ${languageById(target).name} plan…`} />

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader
        eyebrow={`Step ${index + 1} of ${STEPS.length}`}
        title={
          step === 'target'
            ? 'What do you want to learn?'
            : step === 'native'
              ? adding
                ? `Learn ${languageById(target).name} in which language?`
                : 'What language do you speak?'
              : step === 'level'
                ? `How much ${languageById(target).name} do you know?`
                : 'What is it for?'
        }
        onBack={back}
      />
      <div className="mx-4 flex gap-1.5 sm:mx-6">
        {STEPS.map((s, i) => (
          <div key={s} className="h-1 flex-1 rounded-full" style={{ background: i <= index ? ACCENT : 'rgba(255,255,255,0.08)' }} />
        ))}
      </div>

      <div className="flex-1 px-4 py-5 sm:px-6">
        {step === 'native' && (
          <p className="mb-4 text-[13px] leading-relaxed text-mist">
            Explanations, tips and translations for {languageById(target).name} come in this language.
          </p>
        )}
        {(step === 'target' || step === 'native') && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {LANGUAGES.filter((l) => step === 'target' || l.id !== target).map((l) => {
              const chosen = (step === 'target' ? target : native) === l.id
              const already = step === 'target' && learning.includes(l.id)
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    if (step === 'target') {
                      setTarget(l.id)
                      if (native === l.id) setNative(l.id === 'en' ? 'fr' : 'en')
                    } else setNative(l.id)
                  }}
                  aria-pressed={chosen}
                  className={cn(
                    'flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all',
                    chosen ? SELECTED : 'border-white/8 bg-white/[0.03] hover:bg-white/[0.07]',
                  )}
                >
                  <span className="text-[26px] leading-none" aria-hidden>{l.flag}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold text-chalk">{l.name}</span>
                    <span className="block truncate text-[11.5px] text-faint">{already ? 'Learning' : l.native}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {step === 'level' && (
          <div className="grid gap-2">
            {LEVELS.map((l, i) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLevel(l.id)}
                aria-pressed={level === l.id}
                className={cn(
                  'flex items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-all',
                  level === l.id ? SELECTED : 'border-white/8 bg-white/[0.03] hover:bg-white/[0.07]',
                )}
              >
                <span className="flex h-6 items-end gap-0.5" aria-hidden>
                  {[0, 1, 2, 3].map((b) => (
                    <span
                      key={b}
                      className="w-1.5 rounded-sm"
                      style={{ height: 6 + b * 5, background: b <= i ? ACCENT : 'rgba(255,255,255,0.12)' }}
                    />
                  ))}
                </span>
                <span>
                  <span className="block text-[14px] font-semibold text-chalk">{l.name}</span>
                  <span className="block text-[12px] text-mist">{l.hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {step === 'goals' && (
          <>
            <p className="text-[13px] text-mist">Pick what matters to you. Your plan is written around it.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {GOALS.map((g) => {
                const on = goals.includes(g)
                return (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setGoals((all) => (on ? all.filter((x) => x !== g) : [...all, g]))}
                    className={cn(
                      'inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium transition-all',
                      on ? SELECTED : 'border-white/10 bg-white/[0.03] text-mist hover:text-chalk',
                    )}
                  >
                    {on && <IconCheck width={14} height={14} />}
                    {g}
                  </button>
                )
              })}
            </div>
            {error && <p className="mt-4 text-[12.5px] text-[#fca5a5]">{error}</p>}
          </>
        )}
      </div>

      <div className="sticky bottom-0 bg-gradient-to-t from-[#070b14] via-[#070b14] to-transparent px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-6 sm:px-6">
        {step === 'goals' ? (
          <Button variant="primary" className="h-12 w-full text-[14px]" onClick={() => void save()}>
            Build my plan
          </Button>
        ) : (
          <Button variant="primary" className="h-12 w-full text-[14px]" disabled={step === 'target' && !target} onClick={next}>
            Continue
          </Button>
        )}
      </div>
    </div>
  )
}
