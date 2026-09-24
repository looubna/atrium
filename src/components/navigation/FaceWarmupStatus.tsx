import { useEffect, useState } from 'react'
import { ThinkingLogo } from '@/components/ui/ThinkingLogo'
import { useFaceWarmup, warmProgress, warmSecondsLeft } from '@/platform/avatar/faceWarmup'

/**
 * How far the live video (the lip-synced face) has got while its server starts: the brand mark
 * turning and filling, with the time left. Shown from the moment a setup with a face is opened,
 * over the setup, the walk in and the room alike, and gone once the face is ready. Nothing waits
 * on it: the candidate carries on setting up, and a session that starts first runs on the voice
 * until the face joins.
 */
export function FaceWarmupStatus() {
  const warmup = useFaceWarmup()
  const [now, setNow] = useState(() => Date.now())
  const [shown, setShown] = useState(false)

  const warming = warmup.holding && warmup.checkedAt >= warmup.heldAt && (warmup.state === 'starting' || warmup.state === 'loading')
  const ready = warmup.state === 'ready'

  // Only a start actually under way is shown: a server that was already up never flashes a bar.
  useEffect(() => {
    if (warming) setShown(true)
    else if (!ready) setShown(false)
  }, [warming, ready])

  useEffect(() => {
    if (!shown || ready) return
    const tick = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(tick)
  }, [shown, ready])

  if (!shown) return null

  const left = warmSecondsLeft(warmup, now)
  const hint = ready
    ? 'The live video will join as soon as your session starts.'
    : left > 0
      ? `About ${left} s left. Keep setting up; it runs in the background.`
      : 'Almost there. You can start; the video joins when it is ready.'

  return (
    <div className="pointer-events-none fixed inset-x-4 top-16 z-40 flex justify-center">
      <div className="anim-fade flex max-w-full items-center gap-3 rounded-2xl border border-white/10 bg-ink-900/85 px-3.5 py-2.5 shadow-lg backdrop-blur-md">
        <ThinkingLogo
          turning
          size={30}
          progress={warmProgress(warmup, now)}
          done={ready}
          label="Preparing the live video"
          doneLabel="Live video ready"
          onComplete={() => setShown(false)}
        />
        <p className="hidden min-w-0 text-[11px] leading-snug text-faint sm:block sm:max-w-56">{hint}</p>
      </div>
    </div>
  )
}
