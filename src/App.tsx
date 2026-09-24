import { useEffect } from 'react'
import { Boot } from './components/navigation/Boot'
import { ContextPanel } from './components/navigation/ContextPanel'
import { DrillStage } from './components/navigation/DrillStage'
import { FaceWarmupStatus } from './components/navigation/FaceWarmupStatus'
import { Grade } from './components/navigation/Grade'
import { InteriorHud } from './components/navigation/InteriorHud'
import { MeetingVideo } from './components/navigation/MeetingVideo'
import { NetworkingHall } from './components/navigation/NetworkingHall'
import { ParkTalk } from './components/navigation/ParkTalk'
import { SceneError } from './components/navigation/SceneError'
import { TopBar } from './components/navigation/TopBar'
import { Veil } from './components/navigation/Veil'
import { InPersonInterview } from './components/navigation/InPersonInterview'
import { DebateRoom } from './components/navigation/DebateRoom'
import { OralExam } from './components/navigation/OralExam'
import { AdmissionCall } from './components/navigation/AdmissionCall'
import { VirtualCall } from './components/navigation/VirtualCall'
import { LeadershipCall } from './components/navigation/LeadershipCall'
import { MeetingCall } from './components/navigation/MeetingCall'
import { NegotiationCall } from './components/navigation/NegotiationCall'
import { PresentationCall } from './components/navigation/PresentationCall'
import { SalesCall } from './components/navigation/SalesCall'
import { LanguageCenter } from './components/language/LanguageCenter'
import { getLocation } from './data/locations'
import { FeedbackDashboard } from './modules/interview/feedback/FeedbackDashboard'
import { AccountSheet } from './platform/auth/AccountSheet'
import { opensOwnScreen, useAppStore } from './state/useAppStore'
import { Experience } from './three/Experience'

/** Escape steps back out; Enter goes in. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useAppStore.getState()

      if (e.key === 'Escape') {
        if (s.accountOpen) return
        if (s.view === 'feedback') s.closeFeedback()
        else if (s.view === 'call') s.leaveCall()
        else if (s.view === 'drill' || s.view === 'talk' || s.view === 'exam' || s.view === 'debate' || s.view === 'admission' || s.view === 'language')
          s.leaveDrill()
        else if (s.view === 'interior') s.leaveInterior()
        else if (s.selectedId) s.goToCity()
        return
      }
      if (e.key === 'Enter' && s.view === 'location') {
        const loc = getLocation(s.selectedId)
        const ownScreen = s.session?.locationId === loc?.id && opensOwnScreen(s.session)
        if (loc?.hasInterior || ownScreen || loc?.opens) s.enter()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function App() {
  useShortcuts()

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-900">
      <SceneError>
        <Experience />
      </SceneError>
      <MeetingVideo />
      <NetworkingHall />
      <Grade />
      <TopBar />
      <ContextPanel />
      <InteriorHud />
      <VirtualCall />
      <LeadershipCall />
      <SalesCall />
      <NegotiationCall />
      <MeetingCall />
      <PresentationCall />
      <InPersonInterview />
      <DrillStage />
      <ParkTalk />
      <OralExam />
      <DebateRoom />
      <AdmissionCall />
      <LanguageCenter />
      <FaceWarmupStatus />
      <FeedbackDashboard />
      <AccountSheet />
      <Veil />
      <Boot />
    </div>
  )
}
