import { describe, expect, it } from 'vitest'
import { PRACTICE_FORMATS, presentationFormatOf, presentsStanding, showsLiveFace } from '@/data/practice'

const academic = PRACTICE_FORMATS['Academic Presentation'][0]

describe('the academic presentation', () => {
  it('is a live, recorded presentation rather than the empty 3D hall', () => {
    expect(academic.kind).toBe('presentation')
    expect(academic.destination).toBe('call')
    expect(presentationFormatOf(academic)).toBe('academic')
  })

  it('asks for the whole body on camera, like any talk given standing at a lectern', () => {
    expect(presentsStanding('academic')).toBe(true)
    expect(presentsStanding('large-audience')).toBe(true)
    expect(presentsStanding('virtual')).toBe(false)
  })

  it('leaves the business formats as they were', () => {
    for (const format of PRACTICE_FORMATS.Presentation) expect(presentationFormatOf(format)).toBe(format.id)
  })

  it('wakes the face server for every presentation room: the askers are lip-synced everywhere', () => {
    expect(showsLiveFace(academic)).toBe(true)
    const [smallRoom, largeAudience, virtual] = PRACTICE_FORMATS.Presentation
    // The company auditorium's askers are three people in its front row (`theater_strip`).
    expect([showsLiveFace(smallRoom), showsLiveFace(largeAudience), showsLiveFace(virtual)]).toEqual([true, true, true])
  })
})
