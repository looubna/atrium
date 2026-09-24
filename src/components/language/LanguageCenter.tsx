import { useCallback, useEffect, useRef, useState } from 'react'
import { languageById } from '@/data/language'
import { createLanguageSession, getLanguageState, removeLanguage, switchLanguage, type LanguageState, type PracticeMode, type Scene } from '@/modules/language/api'
import { useAppStore } from '@/state/useAppStore'
import { Button } from '../ui/Button'
import { Conversation } from './Conversation'
import { Home, PlanView, ProgressView, type StartTalk } from './Home'
import { WordLists } from './Phrases'
import { Setup } from './Setup'
import { Spinner, problem } from './shared'
import { VocabCoach } from './VocabCoach'

type Screen = 'home' | 'setup' | 'plan' | 'vocab' | 'progress' | 'words'

/** The practice style and speed, remembered on this device. */
const PREFS_KEY = 'atrium.language.prefs'
function readPrefs(): { mode: PracticeMode; slow: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    return { mode: p.mode === 'lesson' ? 'lesson' : 'roleplay', slow: Boolean(p.slow) }
  } catch {
    return { mode: 'roleplay', slow: false }
  }
}

/**
 * The Language Center, inside the city's former shopping mall: learn a language by speaking it.
 * A plan written around the learner's goals, scenes to play out loud with a partner who speaks
 * the language, tips as they speak, a vocab coach for the words they meet, and their progress.
 */
export function LanguageCenter() {
  const view = useAppStore((s) => s.view)
  if (view !== 'language') return null
  return <Center />
}

function Center() {
  const leave = useAppStore((s) => s.leaveDrill)
  const openFeedback = useAppStore((s) => s.openFeedback)
  const setSceneCovered = useAppStore((s) => s.setSceneCovered)
  const [state, setState] = useState<LanguageState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen>('home')
  const [talk, setTalk] = useState<{ id: string; scene: Scene; mode: PracticeMode } | null>(null)
  const [prefs, setPrefs] = useState(readPrefs)
  const updatePrefs = (next: Partial<typeof prefs>) =>
    setPrefs((p) => {
      const merged = { ...p, ...next }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(merged))
      } catch {
        /* private mode: remembered for this visit only */
      }
      return merged
    })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Each page opens at its top, not where the last one was scrolled to.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [screen, talk])

  useEffect(() => {
    setSceneCovered(true)
    return () => setSceneCovered(false)
  }, [setSceneCovered])

  const load = useCallback(() => {
    setLoadError(null)
    getLanguageState()
      .then((s) => {
        setState(s)
        if (!s.profile) setScreen('setup')
      })
      .catch((e) => setLoadError(problem(e)))
  }, [])
  useEffect(load, [load])

  const start: StartTalk = async (pick) => {
    setBusy(true)
    setError(null)
    try {
      const session = await createLanguageSession({ ...pick, durationMinutes: 10, mode: prefs.mode, slow: prefs.slow })
      setTalk({ id: session.id, scene: session.scene, mode: prefs.mode })
    } catch (e) {
      setError(problem(e))
      setScreen('home')
    } finally {
      setBusy(false)
    }
  }

  const home = () => setScreen('home')
  const remove = async (target: string) => {
    setBusy(true)
    setError(null)
    try {
      const next = await removeLanguage(target)
      setState(next)
      // The last language gone: set one up again.
      if (!next.profile) setScreen('setup')
    } catch (e) {
      setError(problem(e))
    } finally {
      setBusy(false)
    }
  }
  const switchTo = async (target: string) => {
    setBusy(true)
    setError(null)
    try {
      setState(await switchLanguage(target))
    } catch (e) {
      setError(problem(e))
    } finally {
      setBusy(false)
    }
  }
  const target = languageById(state?.profile?.target)

  let body
  if (talk) {
    body = (
      <Conversation
        key={talk.id}
        sessionId={talk.id}
        scene={talk.scene}
        mode={talk.mode}
        target={target}
        onFeedback={() => openFeedback(talk.id)}
        onDone={() => {
          setTalk(null)
          setScreen('home')
          load()
        }}
      />
    )
  } else if (loadError) {
    body = (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <p className="text-[13px] text-[#fca5a5]">{loadError}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="primary" onClick={load}>Try again</Button>
            <Button onClick={leave}>Back to the city</Button>
          </div>
        </div>
      </div>
    )
  } else if (!state) {
    body = <Spinner label="Opening the Language Center…" />
  } else if (screen === 'setup') {
    body = (
      <Setup
        profile={state.profile}
        learning={state.languages.map((l) => l.id)}
        onBack={state.profile ? home : leave}
        onDone={(s) => {
          setState(s)
          setScreen('home')
        }}
      />
    )
  } else if (screen === 'plan') {
    body = <PlanView state={state} busy={busy} onStart={start} onBack={home} />
  } else if (screen === 'vocab') {
    body = (
      <VocabCoach
        target={target}
        onBack={() => {
          home()
          load()
        }}
      />
    )
  } else if (screen === 'words') {
    body = (
      <WordLists
        target={target}
        onBack={() => {
          home()
          load()
        }}
      />
    )
  } else if (screen === 'progress') {
    body = <ProgressView state={state} onFeedback={openFeedback} onBack={home} />
  } else {
    body = (
      <Home
        state={state}
        busy={busy}
        error={error}
        mode={prefs.mode}
        slow={prefs.slow}
        onMode={(mode) => updatePrefs({ mode })}
        onSlow={(slow) => updatePrefs({ slow })}
        onStart={start}
        onOpen={setScreen}
        onSwitch={(target) => void switchTo(target)}
        onAddLanguage={() => setScreen('setup')}
        onRemove={(target) => void remove(target)}
        onLeave={leave}
      />
    )
  }

  return (
    <div
      ref={scroller}
      className="anim-fade absolute inset-0 z-[45] overflow-y-auto"
      // The feedback screen's background: the app's night with a jade glow at the top.
      style={{ background: 'radial-gradient(80% 50% at 50% 0%, rgba(52,211,153,0.08), transparent 70%), #070b14' }}
      role="region"
      aria-label="Language Center"
    >
      <div className={talk ? 'mx-auto h-full max-w-3xl' : 'mx-auto flex min-h-full max-w-3xl flex-col'}>{body}</div>
    </div>
  )
}
