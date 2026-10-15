import { useEffect, useState } from 'react'
import { ThinkingLogo } from '@/components/ui/ThinkingLogo'
import { useFaceWarmup, warmProgress, warmSecondsLeft } from '@/platform/avatar/faceWarmup'
import { useConversationLoading } from '@/platform/live/conversationLoading'
import { useAppStore } from '@/state/useAppStore'

/**
 * The whole screen while a conversation gets ready, until the other side's first words: the brand
 * mark filling, never the room with someone silently staring at the user. While the live video's
 * server is starting, the mark shows its real progress and the time left.
 */
export function ConversationLoading() {
  const loading = useConversationLoading((s) => s.loading)
  const warmup = useFaceWarmup()
  const [now, setNow] = useState(() => Date.now())
  const warming = warmup.state === 'starting' || warmup.state === 'loading'

  useEffect(() => {
    if (!loading || !warming) return
    const tick = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(tick)
  }, [loading, warming])

  if (!loading) return null
  const left = warming ? warmSecondsLeft(warmup, now) : 0
  const leave = () => {
    const { view, leaveCall, leaveInterior, leaveDrill } = useAppStore.getState()
    if (view === 'call') leaveCall()
    else if (view === 'interior') leaveInterior()
    else leaveDrill()
  }

  return (
    <div role="status" aria-live="polite" className="anim-fade fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-ink-900 px-6">
      <ThinkingLogo
        turning
        size={56}
        layout="stack"
        expected={12}
        progress={warming ? warmProgress(warmup, now) : undefined}
        label="Getting your conversation ready"
      />
      {warming && (
        <p className="max-w-xs text-center text-[12px] leading-snug text-faint">
          {left > 0 ? `Starting the live video: about ${left} s left.` : 'Almost there.'}
        </p>
      )}
      <button
        type="button"
        onClick={leave}
        className="absolute bottom-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] h-9 rounded-full border border-white/15 px-4 text-[12px] text-mist hover:bg-white/10"
      >
        Leave
      </button>
    </div>
  )
}
