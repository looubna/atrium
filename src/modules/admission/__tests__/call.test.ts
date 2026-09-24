import { describe, expect, it } from 'vitest'
import { admissionHere } from '@/components/navigation/AdmissionCall'
import { PRACTICE_FORMATS, showsLiveFace, type SessionSetup } from '@/data/practice'
import { kindLabel } from '@/modules/admission/api'
import { opensOwnScreen } from '@/state/useAppStore'

const FORMAT = Object.values(PRACTICE_FORMATS)
  .flat()
  .find((f) => f.kind === 'admission')!

const session = (sessionId?: string): SessionSetup => ({
  locationId: 'uni',
  area: 'Scholarship / Admissions Interview',
  format: FORMAT,
  minutes: 20,
  admission: { prepId: 'p1', opportunity: 'Chevening Scholarship', sessionId },
})

describe('the scholarship interview is a video call', () => {
  it('goes to its own call screen, not the lecture hall', () => {
    expect(FORMAT.destination).toBe('admission')
    // Its setup opens the face server, since the professor has a live face.
    expect(showsLiveFace(FORMAT)).toBe(true)
  })

  it('has nothing to join until the preparation has made a session', () => {
    expect(opensOwnScreen(session())).toBe(false)
    expect(opensOwnScreen(session('s1'))).toBe(true)
  })

  it('shows the call only for this location, on the call view', () => {
    const state = { view: 'admission', session: session('s1'), selectedId: 'uni' }
    expect(admissionHere(state)?.sessionId).toBe('s1')
    expect(admissionHere({ ...state, selectedId: 'elsewhere' })).toBeNull()
    expect(admissionHere({ ...state, view: 'exam' })).toBeNull()
    expect(admissionHere({ ...state, session: session() })).toBeNull()
  })
})

describe('kinds as the server names them', () => {
  it('labels a university place the way the picker does', () => {
    expect(kindLabel('university')).toBe('University admission')
    expect(kindLabel('scholarship')).toBe('Scholarship')
  })
})
