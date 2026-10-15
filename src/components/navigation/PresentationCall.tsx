import { useEffect, useMemo, useRef, useState } from 'react'
import { ACADEMIC_MEDIA_BASE, DEFENSE_MEDIA_BASE, PRESENTER_SCREENS, THEATER_MEDIA_BASE } from '@/data/meeting'
import { presentsStanding, type PresentationBriefing, type PresentationSetup } from '@/data/practice'
import { useCamera } from '@/lib/useCamera'
import { quadTransform } from '@/lib/perspective'
import { cn } from '@/lib/utils'
import { useInterviewRoom } from '@/modules/interview/live/useInterviewRoom'
import { useAppStore } from '@/state/useAppStore'
import { Button } from '../ui/Button'
import { IconMic, IconMicOff, IconPhoneOff } from '../ui/Icon'
import { AvatarTile } from './AvatarTile'
import { FramingHint } from './FramingHint'
import { RotateHint } from './RotateHint'
import { SlideControls, SlideReader } from './SlideControls'
import { CameraCheck } from './CameraCheck'
import { VIDEO_BASE } from '@/platform/media/videoBase'

/**
 * Presentation practice: the user's slides, large, and the audience beside them — Robert, Priya and
 * Kevin at the boardroom table (small room) or on a video call (virtual), or the auditorium with a
 * chair and questions from the floor (large audience: three people in its front row, lip-synced).
 *
 * The audience is live (backend `modules/presentation`) but holds its tongue while the user presents:
 * the server discards anything it says until the user takes questions, with the button or by asking
 * "any questions?". Then it asks, one question at a time, about the talk and the slides.
 */

const shot = (base: string) => ({ loop: `${base}.mp4`, still: `${base}.jpg` })
const ROOMS = {
  'small-room': shot(`${VIDEO_BASE}/sales/room_investors`),
  virtual: shot(`${VIDEO_BASE}/sales/call_investors`),
  'large-audience': { loop: `${VIDEO_BASE}/theater/landscape/idle.mp4`, still: `${VIDEO_BASE}/theater/landscape/poster.jpg` },
  // The university classroom, from the lectern: the academic presentation's own footage.
  academic: { loop: `${ACADEMIC_MEDIA_BASE}/landscape/idle.mp4`, still: `${ACADEMIC_MEDIA_BASE}/landscape/poster.jpg` },
  // The university lecture hall from the lectern: the thesis committee at the front table.
  defence: { loop: `${DEFENSE_MEDIA_BASE}/landscape/idle.mp4`, still: `${DEFENSE_MEDIA_BASE}/landscape/poster.jpg` },
} as const

/** The presentation on screen now, if any. */
export function presentationHere(state: {
  view: string
  session: ReturnType<typeof useAppStore.getState>['session']
  selectedId: string | null
}) {
  const { view, session, selectedId } = state
  if (view !== 'call' || !session || session.locationId !== selectedId) return null
  const presentation = session.presentation
  return presentation?.sessionId ? { presentation, sessionId: presentation.sessionId } : null
}

export function PresentationCall() {
  const view = useAppStore((s) => s.view)
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  const here = presentationHere({ view, session, selectedId })
  if (!here) return null
  // A new session is a new screen: rebuilt rather than reused.
  return <Stage key={here.sessionId} sessionId={here.sessionId} setup={here.presentation} />
}

/** The pre-read: who is in the room, what they expect, tips, and how the questions will work. */
function Briefing({ briefing, standing }: { briefing: PresentationBriefing; standing: boolean }) {
  return (
    <div className="text-left">
      <div className="eyebrow">Briefing · {briefing.title}</div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-mist">{briefing.audience}</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-chalk">
        <span className="font-semibold">They expect: </span>
        {briefing.expects}
      </p>
      {briefing.tips.length > 0 && (
        <section className="mt-3">
          <h3 className="text-[13px] font-semibold text-chalk">Tips for this talk</h3>
          <ol className="mt-1 list-decimal space-y-1 pl-4 text-[12.5px] leading-relaxed text-mist">
            {briefing.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ol>
        </section>
      )}
      <section className="mt-3">
        <h3 className="text-[13px] font-semibold text-chalk">In the room</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-mist">
          {briefing.people.map((p) => `${p.name}, ${p.role}`).join(' · ')}
        </p>
      </section>
      <p className="mt-3 text-[11.5px] text-faint">
        {briefing.format}
        {!briefing.slides && ' Your slides could not be read, so the questions come from your talk.'} The session is
        recorded for your feedback.
      </p>
      <p className="mt-2 rounded-lg border border-[#fcd34d]/30 bg-[#fcd34d]/10 px-2.5 py-2 text-[11.5px] leading-relaxed text-[#fde68a]">
        {standing
          ? 'Stand back so your whole body is on camera, head to feet if you can. Your posture and gestures are part of the analysis, and it is only accurate for what the camera sees.'
          : 'Sit so your head, shoulders and hands are on camera. Body language is only judged on what the camera sees.'}
      </p>
    </div>
  )
}

/** A looping filmed shot of the audience, under the live face (or on its own, when there is none). */
function Loop({ loop, still }: { loop: string; still: string }) {
  return (
    <>
      <img src={still} alt="" className="absolute inset-0 size-full object-cover" />
      <video src={loop} poster={still} autoPlay loop muted playsInline disablePictureInPicture className="absolute inset-0 size-full object-cover" />
    </>
  )
}

/** The auditorium footage's lectern laptop, from the presenter's side (see `PRESENTER_SCREENS`). */
const LECTERN = PRESENTER_SCREENS[`${THEATER_MEDIA_BASE}/landscape`]
/** The classroom footage's lectern laptop, for the academic presentation. */
const ACADEMIC_LECTERN = PRESENTER_SCREENS[`${ACADEMIC_MEDIA_BASE}/landscape`]
/** The lecture hall's lectern laptop (the projector behind the committee stays blank). */
const DEFENCE_LECTERN = PRESENTER_SCREENS[`${DEFENSE_MEDIA_BASE}/landscape`]

type Strip = { x: number; y: number; w: number; h: number; frame: readonly [number, number] }

/**
 * The part of a 1920x1080 room its audience's face stream covers: the band holding the three askers,
 * their repaint boxes plus a margin. Streaming this strip rather than the whole room is 8-10x less
 * video to lose on the way; it is laid over the same spot in the filmed room, edges feathered.
 * The classroom: `infra/livetalking/recordings/academic/make_strip.sh` (face `academic_strip`).
 * The company auditorium: `recordings/theater/make_strip.sh` (face `theater_strip`), the front row.
 */
const STRIPS: Partial<Record<PresentationSetup['format'], Strip>> = {
  academic: { x: 416, y: 288, w: 1040, h: 240, frame: [1920, 1080] },
  // The committee table: `infra/livetalking/recordings/defense/make_strip.sh` (face `defense_strip`).
  defence: { x: 192, y: 352, w: 832, h: 272, frame: [1920, 1080] },
  'large-audience': { x: 608, y: 384, w: 1152, h: 176, frame: [1920, 1080] },
}

/** Places a face stream that covers only part of the room exactly over that part, edges feathered. */
function StripFace({ box, strip, children }: { box: { w: number; h: number }; strip: Strip; children: React.ReactNode }) {
  if (!box.w || !box.h) return null
  const [fw, fh] = strip.frame
  const scale = Math.max(box.w / fw, box.h / fh)
  const ox = (box.w - fw * scale) / 2
  const oy = (box.h - fh * scale) / 2
  const feather =
    'linear-gradient(to right, transparent, #000 3%, #000 97%, transparent), linear-gradient(to bottom, transparent, #000 13%, #000 87%, transparent)'
  return (
    <div
      className="absolute overflow-hidden"
      style={{
        left: ox + strip.x * scale,
        top: oy + strip.y * scale,
        width: strip.w * scale,
        height: strip.h * scale,
        maskImage: feather,
        WebkitMaskImage: feather,
        maskComposite: 'intersect',
        WebkitMaskComposite: 'source-in',
      }}
    >
      {children}
    </div>
  )
}

function useBox(ref: React.RefObject<HTMLElement>) {
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return box
}

/**
 * In the auditorium the speaker's slides are on the lectern laptop in the footage, drawn onto its
 * display at its angle; the still frame covers the lid, since the filmed screen shows something else.
 */
function LecternLaptop({
  box,
  poster,
  slide,
  lectern = LECTERN,
}: {
  box: { w: number; h: number }
  poster: string
  slide: string | null
  lectern?: typeof LECTERN
}) {
  if (!box.w || !box.h) return null
  const [fw, fh] = lectern.frame
  const scale = Math.max(box.w / fw, box.h / fh)
  const dw = fw * scale
  const dh = fh * scale
  const ox = (box.w - dw) / 2
  const oy = (box.h - dh) / 2
  const at = ([x, y]: [number, number]): [number, number] => [ox + (x * dw) / fw, oy + (y * dh) / fh]
  return (
    <>
      {lectern.surfaces.map((surface, i) => {
        const lid = surface.lid.map(at)
        const display = surface.display.map(at)
        const [aw, ah] = surface.aspect ?? [16, 10]
        const SW = 1600
        const SH = Math.round((SW * ah) / aw)
        return (
          <div key={i}>
            <img
              src={surface.cover ?? poster}
              alt=""
              aria-hidden
              className="absolute max-w-none"
              style={{ left: ox, top: oy, width: dw, height: dh, clipPath: `polygon(${lid.map(([x, y]) => `${x}px ${y}px`).join(', ')})` }}
            />
            <div
              className="absolute left-0 top-0 grid place-items-center overflow-hidden bg-[#0b0d10]"
              style={{ width: SW, height: SH, transformOrigin: '0 0', transform: quadTransform(SW, SH, display) }}
            >
              {slide ? (
                <img src={slide} alt="" draggable={false} className="h-full w-full select-none object-contain" />
              ) : (
                <span className="text-[64px] text-white/40">No slides</span>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}

/**
 * The laptop the speaker presents from, cut out of the auditorium photograph (`public/video/presentation/
 * laptop.png`): where it sits in that 1920x1080 frame, so it lands in the small room exactly as in the hall.
 */
const LAPTOP = { src: `${VIDEO_BASE}/presentation/laptop.png`, x: 30, y: 590, w: 660, h: 490 }

/**
 * In the small room the footage has no laptop, so the speaker's own — the real one from the
 * auditorium photograph — is set on the table in the same place, size and angle as at the lectern
 * (`LECTERN`), with the current slide on its screen. Tapping the screen opens the slide to read.
 */
function TableLaptop({ box, slide }: { box: { w: number; h: number }; slide: string | null }) {
  const openSlide = useAppStore((s) => s.setSlideZoom)
  if (!box.w || !box.h) return null
  const [fw, fh] = LECTERN.frame
  const scale = Math.max(box.w / fw, box.h / fh)
  const dw = fw * scale
  const dh = fh * scale
  const ox = (box.w - dw) / 2
  const oy = (box.h - dh) / 2
  const surface = LECTERN.surfaces[0]
  const display = surface.display.map(([x, y]): [number, number] => [ox + (x * dw) / fw, oy + (y * dh) / fh])
  const SW = 1600
  const SH = 1000
  return (
    <>
      {/* The laptop itself: the lectern laptop, cut out of the auditorium photograph, set down in the
          same place and at the same size on the boardroom table. */}
      <img
        src={LAPTOP.src}
        alt=""
        aria-hidden
        draggable={false}
        className="pointer-events-none absolute max-w-none select-none"
        style={{
          left: ox + (LAPTOP.x * dw) / fw,
          top: oy + (LAPTOP.y * dh) / fh,
          width: (LAPTOP.w * dw) / fw,
          height: (LAPTOP.h * dh) / fh,
          filter: 'drop-shadow(0 14px 18px rgba(0,0,0,0.45))',
        }}
      />
      <button
        type="button"
        onClick={() => slide && openSlide(true)}
        aria-label={slide ? 'Your laptop: open the slide to read' : 'Your laptop'}
        className="absolute left-0 top-0 grid place-items-center overflow-hidden bg-[#0b0d10]"
        style={{ width: SW, height: SH, transformOrigin: '0 0', transform: quadTransform(SW, SH, display) }}
      >
        {slide ? (
          <img src={slide} alt="Current slide" draggable={false} className="h-full w-full select-none object-contain" />
        ) : (
          <span className="text-[64px] text-white/40">No slides</span>
        )}
      </button>
    </>
  )
}

function SelfView({ stream }: { stream: MediaStream | null }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (video.current) video.current.srcObject = stream
  }, [stream])
  return stream ? <video ref={video} autoPlay muted playsInline className="size-full -scale-x-100 object-cover" /> : null
}

function Stage({ sessionId, setup }: { sessionId: string; setup: PresentationSetup }) {
  const leave = useAppStore((s) => s.leaveCall)
  const openFeedback = useAppStore((s) => s.openFeedback)
  const setSceneCovered = useAppStore((s) => s.setSceneCovered)
  const deck = useAppStore((s) => s.deck)
  const slideIndex = useAppStore((s) => s.slideIndex)
  const [started, setStarted] = useState(false)
  const [muted, setMuted] = useState(false)
  const [released, setReleased] = useState(false)
  const camera = useCamera(started)
  // Standing at a lectern, posture and gestures are judged too: the camera check asks for the whole
  // body. In person the audience is on the screen, so looking at it counts; on a call, the lens.
  const standing = presentsStanding(setup.format)
  const tracker = useMemo(
    () => ({ setting: setup.format === 'virtual' ? ('camera' as const) : ('screen' as const), fullBody: standing }),
    [setup.format, standing],
  )
  const room = useInterviewRoom({ sessionId, camera: camera.stream, module: 'presentation', tracker })
  const { live, liveActive, avatar, avatarFailed, leadFaceLive, colleagueLive } = room
  const { phase, panelSpeaker, interviewerSpeaking, timeLeftMs } = live.state
  const people = setup.people ?? []
  const briefing = setup.briefing
  const media = ROOMS[setup.format]

  // Everyone in the room is one face stream: their questions go through it too, named as theirs.
  useEffect(() => {
    if (!leadFaceLive || !avatar) return
    for (const [name, renderer] of Object.entries(avatar.panel)) colleagueLive(name, renderer)
  }, [leadFaceLive, avatar, colleagueLive])
  useEffect(() => {
    setSceneCovered(true)
    return () => setSceneCovered(false)
  }, [setSceneCovered])
  const setSlideZoom = useAppStore((s) => s.setSlideZoom)
  useEffect(() => () => setSlideZoom(false), [setSlideZoom])

  // The chair's welcome is the audience's first turn; anything it says after that is the Q&A (the
  // server keeps it silent until then), so a question heard means the floor has been handed over,
  // whether by the button or by asking "any questions?".
  const turns = useRef(0)
  const wasSpeaking = useRef(false)
  useEffect(() => {
    const speaking = interviewerSpeaking || Boolean(panelSpeaker)
    if (speaking && !wasSpeaking.current) {
      turns.current++
      if (turns.current > 1) setReleased(true)
    }
    wasSpeaking.current = speaking
  }, [interviewerSpeaking, panelSpeaker])

  const start = () => {
    setStarted(true)
    void live.start()
  }
  const takeQuestions = () => {
    live.release()
    setReleased(true)
  }
  const toggleMute = () => {
    live.setMuted(!muted)
    setMuted(!muted)
  }
  const hangUp = () => (liveActive ? live.end() : leave())

  // Every audience has lip-synced faces: the room, the call, and three people in the front row of the
  // auditorium or the classroom.
  const renderer = avatar && !avatarFailed ? avatar.renderer : undefined
  // The live faces arrive as one full-size video from far away; when its frames stall, the browser
  // holds a frozen picture while the voices carry on. The filmed room underneath is the same shot,
  // so it stands in until frames flow again (the debate hall does the same).
  const [faceStalled, setFaceStalled] = useState(false)
  const speakingName = panelSpeaker ?? (interviewerSpeaking ? people[0]?.name : null)
  const speaking = people.find((p) => p.name === speakingName)
  const left = timeLeftMs !== null ? Math.max(0, Math.round(timeLeftMs / 1000)) : null
  const clock = left !== null ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : null
  const status = !started ? '' : released ? 'Questions' : 'Presenting — the audience is listening'
  // In the room or the auditorium the speaker stands in front of people; only `virtual` is a call.
  const inPerson = setup.format !== 'virtual'
  // In the auditorium the slides are on the lectern laptop in the footage rather than a corner screen.
  const auditorium = setup.format === 'large-audience' || setup.format === 'academic' || setup.format === 'defence'
  const roomBox = useRef<HTMLDivElement>(null)
  const box = useBox(roomBox)

  // The people in front of the speaker: the filmed room, and over it their live face when there is one.
  const faceTile = (r: NonNullable<typeof renderer>) => (
    <AvatarTile
      variant="closeup"
      renderer={r}
      name={people[0]?.name ?? ''}
      role={people[0]?.role ?? ''}
      speaking={interviewerSpeaking || Boolean(panelSpeaker)}
      shown={!faceStalled}
      onStall={setFaceStalled}
      onLive={room.setFaceOnScreen}
      onFailed={room.onAvatarFailed}
      onEnded={room.onFaceEnded}
    />
  )
  const audienceView = (
    <>
      <Loop {...media} />
      {renderer &&
        (STRIPS[setup.format] ? (
          <StripFace box={box} strip={STRIPS[setup.format]!}>
            {faceTile(renderer)}
          </StripFace>
        ) : (
          faceTile(renderer)
        ))}
    </>
  )
  const hint = released
    ? 'Take each question, answer it, then wait for the next.'
    : started
      ? 'The audience is listening. When you finish, press Take questions or ask "any questions?".'
      : null
  const slide = deck ? (
    <img src={deck.slides[slideIndex]} alt={`Slide ${slideIndex + 1}`} className="max-h-full max-w-full object-contain" />
  ) : null

  return (
    <div className="anim-fade absolute inset-0 z-[46] flex flex-col bg-[#0f1115]" role="region" aria-label="Presentation">
      {inPerson ? (
        // In person: the room from where the speaker stands, the whole screen. Their slides are on the
        // small presenter screen in the corner, as on a laptop at the lectern; nobody is on a call.
        <div className="absolute inset-0 overflow-hidden">
          <img src={media.still} alt="" className="absolute inset-0 size-full scale-110 object-cover blur-xl" />
          <div
            ref={roomBox}
            className="absolute inset-0"
          >
            {audienceView}
            {auditorium ? (
              <LecternLaptop
                box={box}
                poster={media.still}
                slide={deck ? deck.slides[slideIndex] : null}
                lectern={setup.format === 'academic' ? ACADEMIC_LECTERN : setup.format === 'defence' ? DEFENCE_LECTERN : LECTERN}
              />
            ) : (
              <TableLaptop box={box} slide={deck ? deck.slides[slideIndex] : null} />
            )}
          </div>
          {/* The room fills the screen; upright, its sides are cut off. */}
          <RotateHint who="the whole room" />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/55 to-transparent px-4 pb-8 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] text-[12.5px] text-white/85">
            <span className="min-w-0 truncate font-medium">
              {briefing?.title ?? 'Presentation'}
              {status && <span className="text-white/60"> · {status}</span>}
            </span>
            {clock && <span className="shrink-0 tabular-nums">{clock} left</span>}
          </div>

          {(speaking || hint) && (
            <div className="pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+4.75rem)] flex justify-center px-4 [@media(orientation:landscape)]:px-40 sm:px-72">
              <span className="rounded-full bg-black/55 px-3 py-1 text-center text-[12px] text-white">
                {speaking ? (
                  <>
                    <span className="font-semibold">{speaking.name}</span>
                    <span className="text-white/65"> · {speaking.role}</span>
                  </>
                ) : (
                  hint
                )}
              </span>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-4 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] text-[12.5px] text-white/80">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn('size-2 shrink-0 rounded-full', started ? 'animate-pulse bg-[#e5484d]' : 'bg-white/30')} aria-hidden />
              <span className="truncate font-medium text-white">{briefing?.title ?? 'Presentation'}</span>
              {status && <span className="hidden text-white/50 sm:inline">· {status}</span>}
            </div>
            {clock && <span className="tabular-nums">{clock} left</span>}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 sm:flex-row">
            {/* The shared screen: the slides, as everyone on the call sees them. */}
            <div className="relative grid min-h-0 flex-[3] place-items-center overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
              {slide ?? <p className="px-6 text-center text-[13px] text-white/60">No slides — present without them, or upload them below.</p>}
            </div>

            {/* The call. */}
            <div className="flex min-h-0 flex-[2] flex-col gap-2">
              <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-[#1b1f27] ring-1 ring-white/10">
                {audienceView}
                {/* The call's fourth tile is the speaker's own camera. */}
                <div className="absolute bottom-0 right-0 h-1/2 w-1/2 overflow-hidden bg-[#1b1f27]">
                  <SelfView stream={camera.stream} />
                  <span className="absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10.5px] text-white">You</span>
                </div>
              </div>
              <div className="min-h-[2.5rem] rounded-xl bg-white/5 px-3 py-2 text-[12px] leading-snug text-white/80">
                {speaking ? (
                  <>
                    <span className="font-semibold text-white">{speaking.name}</span>
                    <span className="text-white/60"> · {speaking.role}</span>
                  </>
                ) : (
                  hint
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* The current slide, opened large from the laptop to read. */}
      <SlideReader />

      {/* How the speaker sits in the camera's frame, while it can still be fixed. */}
      {inPerson ? (
        // In person: your own camera only until you are in frame and talking.
        started && <CameraCheck stream={camera.stream} framing={room.framingStatus} standing={standing} micLevel={live.state.micLevel} />
      ) : (
        <FramingHint framing={room.framing} />
      )}

      {/* Before starting: the briefing. */}
      {!started && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="glass flex max-h-[88%] w-full max-w-lg flex-col rounded-2xl p-5">
            <div className="min-h-0 overflow-y-auto pr-1">
              {briefing ? <Briefing briefing={briefing} standing={standing} /> : <div className="eyebrow">Presentation</div>}
            </div>
            <Button variant="primary" className="mt-4 w-full shrink-0" onClick={start}>
              Start presenting
            </Button>
          </div>
        </div>
      )}

      {phase === 'failed' && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 p-4">
          <div className="glass w-full max-w-sm rounded-2xl p-5 text-center">
            <h2 className="text-[15px] font-semibold text-chalk">The session dropped</h2>
            <p className="mt-2 text-[12.5px] text-mist">
              {live.state.failure === 'mic_denied' ? 'Allow the microphone to present.' : 'The audience could not be reached. Try again in a moment.'}
            </p>
            <Button variant="ghost" className="mt-4 w-full" onClick={leave}>
              Back
            </Button>
          </div>
        </div>
      )}

      {phase === 'ended' && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/55 p-4">
          <div className="glass w-full max-w-sm rounded-2xl p-5 text-center">
            <div className="eyebrow">Session over</div>
            <h2 className="mt-1 text-[16px] font-semibold text-chalk">How did your talk go?</h2>
            <p className="mt-2 text-[12.5px] text-mist">Your talk and Q&A are being analysed. Feedback will be ready shortly.</p>
            <Button variant="primary" className="mt-4 w-full" onClick={() => openFeedback(sessionId)}>
              View feedback
            </Button>
            <Button variant="ghost" className="mt-2 w-full" onClick={leave}>
              Back to the city
            </Button>
          </div>
        </div>
      )}

      {/* The presenter's controls: the microphone, the slides, questions, and a way out. */}
      <div
        className={cn(
          'flex flex-wrap items-center justify-center gap-2 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.9rem)] pt-3 sm:gap-2.5 sm:px-4',
          inPerson && 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent pt-10',
        )}
      >
        <button
          type="button"
          aria-label={muted ? 'Unmute' : 'Mute'}
          onClick={toggleMute}
          className={cn('grid size-10 place-items-center rounded-full text-white transition-colors', muted ? 'bg-[#e5484d]/90' : 'bg-white/10 hover:bg-white/20')}
        >
          {muted ? <IconMicOff width={17} height={17} /> : <IconMic width={17} height={17} />}
        </button>
        <SlideControls inline />
        {started && !released && phase !== 'ended' && (
          <Button variant="primary" onClick={takeQuestions}>
            Take questions
          </Button>
        )}
        <button
          type="button"
          aria-label={liveActive ? 'End session' : 'Leave'}
          onClick={hangUp}
          className="grid h-10 w-14 place-items-center rounded-full bg-[#e5484d] text-white transition-colors hover:bg-[#d13438]"
        >
          <IconPhoneOff width={17} height={17} />
        </button>
      </div>
    </div>
  )
}
