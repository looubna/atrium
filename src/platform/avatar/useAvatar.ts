import { useEffect, useState } from 'react'
import { getAvatarSession, type FaceModule } from '@/modules/interview/api'
import { LiveTalkingRenderer } from './liveTalkingRenderer'
import type { AvatarRenderer } from './types'

export interface Avatar {
  renderer: AvatarRenderer
  name: string
  role: string
  /** Panel colleagues' own faces, by name. A colleague missing here stays on the footage. */
  panel: Record<string, AvatarRenderer>
}

export interface AvatarLoad {
  /** The face, once the server has handed out a session for it. */
  avatar: Avatar | null
  /** True when there will be no face this call: not configured, over quota or provider down. */
  unavailable: boolean
}

/**
 * Asks the server for a face for this session and builds its renderer.
 *
 * While loading, both fields are empty and the call shows the person as joining.
 * If there is no face the call shows a plain tile and the session itself is
 * unaffected. `module` decides who shows up: an interviewer, or an examiner.
 */
export function useAvatar(
  sessionId: string | null,
  enabled: boolean,
  generation = 0,
  module: FaceModule = 'interview',
): AvatarLoad {
  const [load, setLoad] = useState<AvatarLoad>({ avatar: null, unavailable: false })

  useEffect(() => {
    if (!sessionId || !enabled) {
      setLoad({ avatar: null, unavailable: false })
      return
    }
    let live = true
    const renderers: AvatarRenderer[] = []

    void getAvatarSession(sessionId, module)
      .then((session) => {
        if (!live) return
        const panel: Record<string, AvatarRenderer> = {}
        const renderer = new LiveTalkingRenderer(session)
        for (const colleague of session.panel ?? []) panel[colleague.name] = new LiveTalkingRenderer(colleague)
        renderers.push(renderer, ...Object.values(panel))
        setLoad({ avatar: { renderer, name: session.name, role: session.role, panel }, unavailable: false })
      })
      .catch(() => {
        // No face today: the interview runs on audio alone.
        if (live) setLoad({ avatar: null, unavailable: true })
      })

    return () => {
      live = false
      renderers.forEach((r) => r.dispose())
      setLoad({ avatar: null, unavailable: false })
    }
    // A new generation asks for fresh sessions: the provider ended the previous faces.
  }, [sessionId, enabled, generation, module])

  return load
}
