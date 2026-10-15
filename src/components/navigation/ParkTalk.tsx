import { isTrialUsed, TRIAL_USED_MESSAGE } from '@/platform/api/client'
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { EMOTIONAL_SCENARIOS, type EmotionalPartner, type EmotionalScenario } from '@/data/practice'
import { clock, useCountdown } from '@/lib/useCountdown'
import { cn } from '@/lib/utils'
import { useVoiceActivity } from '@/lib/useVoiceActivity'
import { createEmotionalSession, getEmotionalBrief, sendFaceDiagnostics, type EmotionalBrief } from '@/modules/emotional/api'
import { useInterviewRoom } from '@/modules/interview/live/useInterviewRoom'
import type { LiveFailure } from '@/modules/interview/live/useLiveInterview'
import { holdFaces } from '@/platform/avatar/faceWarmup'
import { useAppStore } from '@/state/useAppStore'
import { Button } from '../ui/Button'
import { IconArrowLeft, IconMic, IconMicOff } from '../ui/Icon'
import { AvatarTile } from './AvatarTile'
import { useConversationLoading } from '@/platform/live/conversationLoading'
import { VIDEO_BASE } from '@/platform/media/videoBase'

/**
 * Footage per person and orientation: `<partner>_<land|port>` with .jpg, .mp4 (listening loop) and
 * _hi.mp4 (greeting), for when there is no live conversation; and `_face.mp4`, the listening loop the
 * live face is painted on: mouth shut throughout, facing the user (see infra/livetalking/recordings/park).
 */
const PARK_MEDIA_BASE = `${VIDEO_BASE}/park`
/** How long the greeting takes to dissolve into the listening loop. */
const GREETING_FADE_MS = 500
/** After "End", how long to wait for the server to close the conversation before showing feedback anyway. */
const END_WAIT_MS = 4000
/**
 * How long the face streams before the friend says hello. A new face stream renders below 25 fps for its
 * first seconds (17 fps measured), so a greeting spoken straight away is out of sync with the lips.
 */
const FACE_SETTLE_MS = 2500
/**
 * A face picture frozen this long while the call runs is reconnected (a fresh stream, ~2 s). Chrome
 * can freeze the video of a stream whose sound plays on, and without this the friend would talk on
 * with a still mouth until the end of the conversation.
 */
const FACE_STALL_RECOVER_MS = 1500
/**
 * The face's picture and voice are held this long in the browser before playing. The face server
 * is far away (~180 ms round trip from the user) and loses packets in the burst of each keyframe
 * (every 10 s); with Chrome's default buffer the resent packets arrive too late and the picture
 * freezes while the voice plays on. Measured: 6 freezes in 90 s.
 */
const FACE_PLAYOUT_BUFFER_MS = 400
/** How often the page reports what it saw of the face (see sendFaceDiagnostics). */
const FACE_REPORT_MS = 5000

/**
 * The photos are 3:2 (sideways) and 2:3 (upright), but the generated video is 16:9 or 9:16
 * with the photo centred between black bands. Width : height of each.
 */
const PHOTO_ASPECT = { land: 3 / 2, port: 2 / 3 }
const VIDEO_ASPECT = { land: 16 / 9, port: 9 / 16 }

function useViewport() {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight })
  const [size, setSize] = useState(read)
  useEffect(() => {
    const on = () => setSize(read())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

type Box = { left: number; top: number; width: number; height: number }

/**
 * Where the photo and the videos go so the photo covers the screen and each video's
 * picture lands exactly on it, its black bands pushed off-screen.
 */
function layout(vw: number, vh: number, landscape: boolean): { photo: Box; video: Box } {
  const photoAspect = landscape ? PHOTO_ASPECT.land : PHOTO_ASPECT.port
  const videoAspect = landscape ? VIDEO_ASPECT.land : VIDEO_ASPECT.port
  const pw = Math.max(vw, vh * photoAspect)
  const ph = pw / photoAspect
  const photo = { left: (vw - pw) / 2, top: (vh - ph) / 2, width: pw, height: ph }
  // The photo sits inside the video frame touching two sides ("contain"); the frame extends past the other two.
  const wide = videoAspect > photoAspect
  const width = wide ? ph * videoAspect : pw
  const height = wide ? ph : pw / videoAspect
  const video = { left: photo.left + (pw - width) / 2, top: photo.top + (ph - height) / 2, width, height }
  return { photo, video }
}

/**
 * The park's emotional conversation: the person the user chose sits facing them on a bench and
 * talks with them live, their lips synced to their voice. Only a slim bar sits over the footage,
 * low on the screen, so the face stays clear. Without a live conversation (no network, no AI) the
 * filmed greeting and listening loop play as before.
 */
export function ParkTalk() {
  const view = useAppStore((s) => s.view)
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  const leave = useAppStore((s) => s.leaveDrill)
  const openFeedback = useAppStore((s) => s.openFeedback)
  const mine = session && session.locationId === selectedId && session.emotional ? session : null

  if (view !== 'talk' || !mine?.emotional) return null
  const scenario = EMOTIONAL_SCENARIOS.find((c) => c.id === mine.emotional!.scenario)
  return (
    <Conversation
      partner={mine.emotional.partner}
      scenario={mine.emotional.scenario}
      topic={scenario?.label ?? ''}
      minutes={mine.minutes}
      onLeave={leave}
      onFeedback={openFeedback}
    />
  )
}

const FAILURE: Partial<Record<LiveFailure, string>> = {
  mic_denied: 'Allow the microphone to talk.',
  forbidden: 'Accept recording and AI processing in your account first.',
  email_unverified: 'Verify your email address first.',
  quota: "You've used this month's live minutes.",
  conflict: 'Another live session is open.',
}

function Conversation({ partner, scenario, topic, minutes, onLeave, onFeedback }: {
  partner: EmotionalPartner
  scenario: EmotionalScenario
  topic: string
  minutes: number
  onLeave: () => void
  onFeedback: (sessionId: string) => void
}) {
  const viewport = useViewport()
  const landscape = viewport.w > viewport.h
  const base = `${PARK_MEDIA_BASE}/${partner}_${landscape ? 'land' : 'port'}`
  const boxes = layout(viewport.w, viewport.h, landscape)
  const timer = useCountdown(minutes * 60)
  const voice = useVoiceActivity(true)
  // Before the conversation: the situation's brief, and whether the user has started talking.
  const [brief, setBrief] = useState<EmotionalBrief | null>(null)
  const [started, setStarted] = useState(false)
  // The live conversation: its session once created, why there is none, and how it is ending.
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [ending, setEnding] = useState(false)
  const [ended, setEnded] = useState(false)
  const offline = note !== null

  // The lip-sync server stays up while the user is on the bench, reading the brief included.
  useEffect(() => holdFaces(), [])

  // The park covers the whole screen: the 3D city behind it stops rendering, as it does under every
  // other room. Left running, it took the GPU from the face and Chrome painted ~15 of its 25 fps.
  const setSceneCovered = useAppStore((s) => s.setSceneCovered)
  useEffect(() => {
    setSceneCovered(true)
    return () => setSceneCovered(false)
  }, [setSceneCovered])

  useEffect(() => {
    let dropped = false
    getEmotionalBrief(scenario)
      .then((b) => !dropped && setBrief(b))
      .catch(() => {})
    return () => {
      dropped = true
    }
  }, [scenario])

  // Starting opens the conversation, in the orientation the page has then: that picks which cut of
  // the footage the face is painted on. The clock starts with it.
  // Set on every mount, not only initialised: strict mode unmounts and remounts once, and a flag
  // left true by that would drop the session this conversation creates.
  const unmounted = useRef(false)
  useEffect(() => {
    unmounted.current = false
    return () => {
      unmounted.current = true
      useConversationLoading.getState().set(false)
    }
  }, [])
  const start = (ownSituation: string) => {
    setStarted(true)
    timer.toggle()
    // The loading screen from now until the first words: never the room with someone silently waiting.
    useConversationLoading.getState().set(true)
    createEmotionalSession(partner, scenario, minutes, landscape, ownSituation)
      .then(({ id }) => !unmounted.current && setSessionId(id))
      .catch((error: unknown) => {
        useConversationLoading.getState().set(false)
        if (!unmounted.current) setNote(isTrialUsed(error) ? TRIAL_USED_MESSAGE : 'The conversation could not start. Check your connection.')
      })
  }

  // "End": the server closes the conversation (so it is recorded and scored), then the feedback opens.
  useEffect(() => {
    if (!ending || !sessionId) return
    if (ended) {
      onFeedback(sessionId)
      return
    }
    const id = window.setTimeout(() => onFeedback(sessionId), END_WAIT_MS)
    return () => window.clearTimeout(id)
  }, [ending, ended, sessionId, onFeedback])

  const live = Boolean(sessionId) && !offline
  return (
    <div className="anim-fade absolute inset-0 z-[45] overflow-hidden bg-black" role="region" aria-label="Park conversation">
      <Footage base={base} photo={boxes.photo} video={boxes.video} live={!offline} greet={offline && !sessionId} />
      {sessionId && !offline && (
        <LiveFriend
          sessionId={sessionId}
          ending={ending}
          onEnded={() => setEnded(true)}
          onFailed={(why) => setNote(why)}
        />
      )}

      {!started && <StartCard topic={topic} brief={brief} onStart={start} onLeave={onLeave} />}

      {started && (
        <div
          className="pointer-events-auto absolute inset-x-0 z-10 mx-auto flex w-fit max-w-[94vw] items-center gap-2 rounded-full py-1 pl-3 pr-1 glass hud-inset"
          style={{ bottom: '1.25rem' }}
        >
          {voice.denied ? (
            <IconMicOff width={14} height={14} className="shrink-0 text-[#fca5a5]" aria-label="Microphone unavailable" />
          ) : (
            <IconMic width={14} height={14} className={cn('shrink-0', voice.speaking ? 'text-jade-400' : 'text-faint')} aria-label={voice.speaking ? 'You are speaking' : 'Listening'} />
          )}
          <span className={cn('text-[12px] tabular-nums', timer.done ? 'text-[#fca5a5]' : 'text-mist')} aria-label="Time left">
            {clock(timer.left)}
          </span>
          <span className="min-w-0 truncate text-[13px] font-medium text-chalk">{note ?? topic}</span>
          {ended && sessionId && !ending && (
            <button
              type="button"
              onClick={() => onFeedback(sessionId)}
              className="flex h-8 shrink-0 items-center rounded-full bg-white/12 px-2.5 text-[12px] font-medium text-chalk hover:bg-white/16"
            >
              Feedback
            </button>
          )}
          <button
            type="button"
            onClick={() => (live && !ended ? setEnding(true) : onLeave())}
            disabled={ending}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-white/8 px-2.5 text-[12px] font-medium text-mist hover:text-chalk disabled:opacity-60"
          >
            <IconArrowLeft width={13} height={13} />
            {live && !ended ? (ending ? 'Ending…' : 'End') : 'Leave'}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Before the conversation, over the calm clip: what the user is practising and three techniques for
 * it, and the choice between the example situation and one of their own. Once they start there is
 * only the clip and the slim bar.
 */
function StartCard({ topic, brief, onStart, onLeave }: {
  topic: string
  brief: EmotionalBrief | null
  onStart: (ownSituation: string) => void
  onLeave: () => void
}) {
  const [mine, setMine] = useState(false)
  const [own, setOwn] = useState('')
  const ownReady = own.trim().length >= 15
  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/35 p-4 sm:items-center">
      <div className="glass hud-inset anim-rise pointer-events-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl p-4">
        <p className="text-[15px] font-semibold text-chalk">{topic}</p>

        <div role="radiogroup" aria-label="What to practise" className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-white/4 p-1">
          {[
            { id: false, label: 'Example situation' },
            { id: true, label: 'My own situation' },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={mine === o.id}
              onClick={() => setMine(o.id)}
              className={cn(
                'rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors',
                mine === o.id ? 'bg-white/12 text-chalk' : 'text-mist hover:text-chalk',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        {mine ? (
          <label className="mt-3 block">
            <span className="text-[12px] text-mist">Who is it with, and what happened?</span>
            <textarea
              value={own}
              onChange={(e) => setOwn(e.target.value)}
              placeholder="e.g. My flatmate Leo keeps eating my food and says it's no big deal."
              rows={3}
              maxLength={1500}
              autoFocus
              className="mt-1.5 block w-full resize-none rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-[12.5px] leading-relaxed text-chalk outline-none placeholder:text-faint focus:border-jade-400/40"
            />
          </label>
        ) : (
          brief && <p className="mt-3 text-[12.5px] leading-relaxed text-mist">{brief.example}</p>
        )}

        {brief && (
          <>
            <p className="mt-3 text-[13px] font-medium leading-snug text-chalk">{mine ? brief.ownGoal : brief.goal}</p>
            <ul className="mt-2 space-y-1.5">
              {brief.tips.map((tip) => (
                <li key={tip} className="flex gap-2 text-[12px] leading-snug text-mist">
                  <span aria-hidden className="mt-[0.4em] size-1 shrink-0 rounded-full bg-jade-400" />
                  {tip}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={onLeave} className="rounded-full px-3 py-2 text-[12px] font-medium text-mist hover:text-chalk">
            Leave
          </button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={mine && !ownReady}
            onClick={() => onStart(mine ? own.trim() : '')}
          >
            <IconMic width={15} height={15} />
            Start talking
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * The friend, played live: their voice, and their lip-synced face over the footage once it
 * joins (the voice starts either way). Starts on arrival; the friend says hello first.
 */
function LiveFriend({ sessionId, ending, onEnded, onFailed }: {
  sessionId: string
  /** The user tapped End: the conversation closes on the server now. */
  ending: boolean
  onEnded: () => void
  onFailed: (why: string) => void
}) {
  // The call connects at once, but the friend only says hello once their face has settled (or
  // there is none: failed, unavailable or overdue, when the voice goes ahead on its own).
  const [mayOpen, setMayOpen] = useState(false)
  const room = useInterviewRoom({ sessionId, camera: null, module: 'emotional', openWhen: mayOpen })
  const { live, avatar, avatarFailed, leadFaceLive, faceSettled } = room
  useEffect(() => {
    if (mayOpen) return
    if (leadFaceLive) {
      const id = window.setTimeout(() => setMayOpen(true), FACE_SETTLE_MS)
      return () => window.clearTimeout(id)
    }
    if (faceSettled) setMayOpen(true)
  }, [mayOpen, leadFaceLive, faceSettled])
  const { start, end } = live
  const { phase, failure } = live.state
  // A tick later, so a mount that is immediately undone (strict mode) never begins.
  useEffect(() => {
    const id = window.setTimeout(() => void start(), 0)
    return () => window.clearTimeout(id)
  }, [start])
  const told = useRef({ onEnded, onFailed })
  told.current = { onEnded, onFailed }
  useEffect(() => {
    if (phase === 'ended') told.current.onEnded()
    if (phase === 'failed') told.current.onFailed(FAILURE[failure ?? 'unavailable'] ?? "They can't talk right now.")
  }, [phase, failure])
  useEffect(() => {
    if (ending) end()
  }, [ending, end])

  useEffect(() => {
    avatar?.renderer.setPlayoutBuffer?.(FACE_PLAYOUT_BUFFER_MS)
  }, [avatar])

  // A frozen picture reconnects the face rather than leaving a still mouth for the rest of the talk.
  const [stalled, setStalled] = useState(false)
  const recoveries = useRef(0)
  const { onFaceEnded } = room
  useEffect(() => {
    if (!stalled || !leadFaceLive || phase !== 'live') return
    const id = window.setTimeout(() => {
      recoveries.current += 1
      onFaceEnded()
    }, FACE_STALL_RECOVER_MS)
    return () => window.clearTimeout(id)
  }, [stalled, leadFaceLive, phase, onFaceEnded])

  useFaceReports(sessionId, leadFaceLive, stalled, live.state.interviewerSpeaking, recoveries)

  if (!avatar || avatarFailed) return null
  return (
    <AvatarTile
      variant="closeup"
      renderer={avatar.renderer}
      name={avatar.name}
      role={avatar.role}
      speaking={live.state.interviewerSpeaking}
      shown
      onLive={room.setFaceOnScreen}
      onFailed={room.onAvatarFailed}
      onEnded={room.onFaceEnded}
      onStall={setStalled}
    />
  )
}

/**
 * Every few seconds while the face is on screen, what the page saw of it: whether its video still
 * decodes and plays, and whether the page itself was blocked. Logged by the server, so a picture
 * that froze in the user's browser can be traced afterwards.
 */
function useFaceReports(
  sessionId: string,
  faceLive: boolean,
  stalled: boolean,
  speaking: boolean,
  recoveries: MutableRefObject<number>,
) {
  const now = useRef({ stalled, speaking })
  now.current = { stalled, speaking }
  useEffect(() => {
    if (!faceLive) return
    const since = performance.now()
    let longest = 0
    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longest = Math.max(longest, entry.duration)
      })
      observer.observe({ type: 'longtask', buffered: false })
    } catch {
      observer = null
    }
    let lastTime = -1
    const id = window.setInterval(() => {
      const video = [...document.querySelectorAll<HTMLVideoElement>('[aria-label="Park conversation"] video')].find(
        (v) => v.srcObject instanceof MediaStream,
      )
      const track = (video?.srcObject as MediaStream | undefined)?.getVideoTracks()[0]
      const quality = video?.getVideoPlaybackQuality?.()
      const time = video?.currentTime ?? -1
      void sendFaceDiagnostics(sessionId, {
        atS: Math.round((performance.now() - since) / 100) / 10,
        decoded: quality?.totalVideoFrames ?? 0,
        dropped: quality?.droppedVideoFrames ?? 0,
        stalled: now.current.stalled,
        playedS: lastTime < 0 || time < 0 ? -1 : Math.round((time - lastTime) * 10) / 10,
        trackState: track?.readyState ?? 'none',
        trackMuted: Boolean(track?.muted),
        longestTaskMs: Math.round(longest),
        speaking: now.current.speaking,
        recoveries: recoveries.current,
      }).catch(() => {})
      lastTime = time
      longest = 0
    }, FACE_REPORT_MS)
    return () => {
      window.clearInterval(id)
      observer?.disconnect()
    }
  }, [sessionId, faceLive, recoveries])
}

/**
 * Greeting once, with sound, dissolving into the silent listening loop underneath. Missing
 * clips fall back: no greeting → straight to listening; no loop → the still photo.
 *
 * In a live conversation (`live`) the friend greets out loud themselves, so the filmed greeting
 * never plays, and the loop is the `_face` cut: only the frames where their mouth is shut, the
 * very frames the lip-synced face is painted on, so it lands exactly over them and nobody seems to
 * talk while the voice is silent. `greet`: there is no live conversation, play the filmed hello.
 */
function Footage({ base, photo, video, live, greet }: { base: string; photo: Box; video: Box; live: boolean; greet: boolean }) {
  const [phase, setPhase] = useState<'greeting' | 'fading' | 'listening'>('listening')
  const [loopMissing, setLoopMissing] = useState(false)
  const [faceMissing, setFaceMissing] = useState(false)
  const hi = useRef<HTMLVideoElement>(null)
  const listen = useRef<HTMLVideoElement>(null)
  // Turning the phone swaps footage; the greeting is not repeated.
  const greeted = useRef(false)

  useEffect(() => {
    setLoopMissing(false)
    setFaceMissing(false)
    setPhase(greet && !greeted.current ? 'greeting' : 'listening')
  }, [base, greet])

  useEffect(() => {
    const v = hi.current
    if (!v || phase !== 'greeting') return
    // Starting the conversation was a tap, which allows sound; where the browser refuses, greet silently.
    v.muted = false
    v.play().catch(() => {
      v.muted = true
      v.play().catch(() => setPhase('listening'))
    })
  }, [phase, base])

  useEffect(() => {
    if (phase === 'greeting') return
    if (greet) greeted.current = true
    listen.current?.play().catch(() => {})
    if (phase !== 'fading') return
    const id = window.setTimeout(() => setPhase('listening'), GREETING_FADE_MS)
    return () => window.clearTimeout(id)
  }, [phase])

  // Positioned boxes, not object-cover: see layout(). No poster on the videos — it would be
  // drawn over the whole frame, bands included; the photo underneath shows until they play.
  const fill = 'absolute max-w-none'
  return (
    <>
      <img src={`${base}.jpg`} alt="" className={fill} style={photo} draggable={false} />
      {live && !faceMissing && (
        // The `_face` cut is framed like the lip-synced stream (which fills the screen, cropped to
        // cover), so it is laid out the same way and the stream lands exactly on it.
        <video
          key={`${base}-face`}
          src={`${base}_face.mp4`}
          poster={`${base}_face.jpg`}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          onError={() => setFaceMissing(true)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {(!live || faceMissing) && !loopMissing && (
        <video
          key={`${base}-listen`}
          ref={listen}
          src={`${base}.mp4`}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          onError={() => setLoopMissing(true)}
          className={fill}
          style={video}
        />
      )}
      {phase !== 'listening' && (
        <video
          key={`${base}-hi`}
          ref={hi}
          src={`${base}_hi.mp4`}
          playsInline
          disablePictureInPicture
          onEnded={() => setPhase('fading')}
          onError={() => setPhase('listening')}
          className={cn(fill, 'transition-opacity', phase === 'fading' ? 'opacity-0' : 'opacity-100')}
          style={{ ...video, transitionDuration: `${GREETING_FADE_MS}ms` }}
        />
      )}
    </>
  )
}
