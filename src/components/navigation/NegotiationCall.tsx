import { useAppStore } from '@/state/useAppStore'
import { LiveDealRoom } from './SalesCall'

/**
 * Negotiation practice: the other side is Claire on her own, or Robert, Priya and Kevin as a group —
 * the sales cast in the roles each negotiation needs (backend `modules/negotiation`) — on a video
 * call online or across the table in person. The screen is the sales one (`LiveDealRoom`).
 */

/** The negotiation on screen now, if any. */
export function negotiationHere(state: {
  view: string
  session: ReturnType<typeof useAppStore.getState>['session']
  selectedId: string | null
}) {
  const { view, session, selectedId } = state
  if (view !== 'call' || !session || session.locationId !== selectedId) return null
  const negotiation = session.negotiation
  return negotiation?.sessionId ? { negotiation, sessionId: negotiation.sessionId } : null
}

export function NegotiationCall() {
  const view = useAppStore((s) => s.view)
  const session = useAppStore((s) => s.session)
  const selectedId = useAppStore((s) => s.selectedId)
  const here = negotiationHere({ view, session, selectedId })
  if (!here) return null
  const { negotiation } = here
  // A new session is a new screen: rebuilt rather than reused.
  return (
    <LiveDealRoom
      key={here.sessionId}
      sessionId={here.sessionId}
      module="negotiation"
      mode={negotiation.mode}
      people={negotiation.people ?? []}
      briefing={negotiation.briefing}
      label="Negotiation"
      after="How did you negotiate?"
    />
  )
}
