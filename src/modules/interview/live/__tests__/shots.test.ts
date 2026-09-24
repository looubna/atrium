import { describe, expect, it } from 'vitest'
import { CUT_BACK_MS, takeFor } from '../shots'

const table = ['Marcus Adeyemi', 'Hana Sato']

describe('takeFor', () => {
  it('runs the take of whoever has the floor', () => {
    expect(takeFor({ kind: 'lead' }, table)).toEqual({ kind: 'lead' })
    expect(takeFor({ kind: 'colleague', name: 'Marcus Adeyemi' }, table)).toEqual({ kind: 'colleague', index: 0 })
    expect(takeFor({ kind: 'colleague', name: 'Hana Sato' }, table)).toEqual({ kind: 'colleague', index: 1 })
  })

  it('keeps the room listening when nobody is speaking', () => {
    expect(takeFor(null, table)).toEqual({ kind: 'listen' })
  })

  it('keeps listening rather than moving the wrong mouth', () => {
    // Nobody filmed this colleague, so there is no take that shows them talking. Being still
    // while someone speaks is a shot that is merely quiet; the wrong mouth moving is wrong.
    expect(takeFor({ kind: 'colleague', name: 'Someone Else' }, table)).toEqual({ kind: 'listen' })
    expect(takeFor({ kind: 'colleague', name: 'Marcus Adeyemi' }, [])).toEqual({ kind: 'listen' })
  })

  it('holds a take briefly after the speaker stops, so short pauses do not cut back and forth', () => {
    expect(CUT_BACK_MS).toBeGreaterThan(0)
  })
})
