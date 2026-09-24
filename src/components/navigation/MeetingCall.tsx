import { useAppStore } from '@/state/useAppStore'
import { LiveDealRoom } from './SalesCall'

/**
 * Meeting practice: a work meeting with Claire, or with Robert, Priya and Kevin, on the user's own topic —
 * the sales cast in the roles the meeting needs (backend `modules/meeting`) — on a video
 * call online or around the table in person. The screen is the sales one (`LiveDealRoom`).
 */

/** The meeting on screen now, if any. */
export function meetingHere(state: {
  view: string
  session: ReturnType<typeof useAppStore.getState>['session']
  selectedId: string | null
}) {
  const { view, session, selectedId } = state
  if (view !== 'call' || !session || session.locationId !== selectedId) return null
  const meeting = session.meeting
  return meeting?.sessionId ? { meeting, sessionId: meeting.sessionId } : null
}

export function MeetingCall() {
  const view = useAppStore((s) => s.view)
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  const here = meetingHere({ view, session, selectedId })
  if (!here) return null
  const { meeting } = here
  // A new session is a new screen: rebuilt rather than reused.
  return (
    <LiveDealRoom
      key={here.sessionId}
      sessionId={here.sessionId}
      module="meeting"
      mode={meeting.mode}
      people={meeting.people ?? []}
      briefing={meeting.briefing}
      label="Meeting"
      after="How did the meeting go?"
    />
  )
}
