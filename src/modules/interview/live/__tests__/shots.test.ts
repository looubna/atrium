import { describe, expect, it } from 'vitest'
import { shotFor } from '../shots'

const faces = { lead: true, colleagues: { 'Daniel Brooks': true, 'Grace Lin': false } }

describe('shotFor', () => {
  it('cuts to whoever speaks, while their face is live', () => {
    expect(shotFor({ kind: 'lead' }, faces)).toEqual({ kind: 'closeup', who: 'lead' })
    expect(shotFor({ kind: 'colleague', name: 'Daniel Brooks' }, faces)).toEqual({ kind: 'closeup', who: 'Daniel Brooks' })
  })

  it('otherwise keeps to the lead, then a name plate', () => {
    expect(shotFor(null, faces)).toEqual({ kind: 'closeup', who: 'lead' })
    expect(shotFor({ kind: 'colleague', name: 'Grace Lin' }, faces)).toEqual({ kind: 'closeup', who: 'lead' })
    expect(shotFor(null, { lead: false, colleagues: {} })).toEqual({ kind: 'plate' })
  })
})
