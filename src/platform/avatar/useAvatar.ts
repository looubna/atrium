import { useEffect, useState } from 'react'
import { getAvatarSession, type FaceModule } from '@/modules/interview/api'
import { ClipRenderer } from './clipRenderer'
import { clipsFor } from './clipFaces'
import { faceServerReady } from './faceWarmup'
import { LiveTalkingRenderer } from './liveTalkingRenderer'
import type { AvatarRenderer } from './types'

export interface Avatar {
  renderer: AvatarRenderer
  name: string
  role: string
  /** The recording playing, which says how it frames its person. */
  avatar?: string
  /** Each colleague's recording, by name, for the same reason. */
  panelAvatars: Record<string, string | undefined>
  /** Panel colleagues' own faces, by name. A colleague missing here stays on the footage. */
  panel: Record<string, AvatarRenderer>
}

/** Who to fall back to filmed clips for, when the lip-sync server cannot be reached. */
export interface FilmedFace {
  avatarId: string
  name: string
  role: string
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
  filmed: FilmedFace | null = null,
): AvatarLoad {
  const [load, setLoad] = useState<AvatarLoad>({ avatar: null, unavailable: false })

  useEffect(() => {
    if (!sessionId || !enabled) {
      setLoad({ avatar: null, unavailable: false })
      return
    }
    let live = true
    const renderers: AvatarRenderer[] = []
    const leaving = new AbortController()

    // The face server may still be starting (it starts when the setup is opened): the session runs
    // on its voice meanwhile, and the face joins mid-call once the server is up.
    void faceServerReady(undefined, leaving.signal)
      .then(() => {
        if (!live) throw new Error('left')
        return getAvatarSession(sessionId, module)
      })
      .then((session) => {
        if (!live) return
        const panel: Record<string, AvatarRenderer> = {}
        const panelAvatars: Record<string, string | undefined> = {}
        const face = new LiveTalkingRenderer(session)
        // One face for a whole table: each person speaks through it under their own name.
        const shared = (session.speakers?.length ?? 0) > 1
        const renderer = shared ? face.forSpeaker(0) : face
        if (shared) {
          session.speakers!.slice(1).forEach((name, i) => {
            panel[name] = face.forSpeaker(i + 1)
            panelAvatars[name] = session.avatar
          })
        }
        for (const colleague of session.panel ?? []) {
          panel[colleague.name] = new LiveTalkingRenderer(colleague)
          panelAvatars[colleague.name] = colleague.avatar
        }
        renderers.push(face, ...(shared ? [] : Object.values(panel)))
        setLoad({
          avatar: { renderer, name: session.name, role: session.role, avatar: session.avatar, panel, panelAvatars },
          unavailable: false,
        })
      })
      .catch(() => {
        if (!live) return
        // No lip-sync server today. If this person was filmed, they still talk and move
        // from their own footage; only then does the room fall back to the photograph.
        const clips = clipsFor(filmed?.avatarId)
        if (clips) {
          const renderer = new ClipRenderer(clips)
          renderers.push(renderer)
          setLoad({
            avatar: {
              renderer,
              name: filmed!.name,
              role: filmed!.role,
              avatar: filmed!.avatarId,
              panel: {},
              panelAvatars: {},
            },
            unavailable: false,
          })
          return
        }
        // Nobody filmed: the interview runs on audio alone.
        setLoad({ avatar: null, unavailable: true })
      })

    return () => {
      live = false
      leaving.abort()
      renderers.forEach((r) => r.dispose())
      setLoad({ avatar: null, unavailable: false })
    }
    // A new generation asks for fresh sessions: the provider ended the previous faces.
    // Spread rather than the object: a fresh literal each render would restart the face.
  }, [sessionId, enabled, generation, module, filmed?.avatarId, filmed?.name, filmed?.role])

  return load
}
