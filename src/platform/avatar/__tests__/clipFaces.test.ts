import { describe, expect, it } from 'vitest'
import { EXAMINERS } from '@/data/examiners'
import { clipsFor } from '../clipFaces'

/**
 * The clips are the fallback for a face server that cannot be reached, so the mapping
 * has to hold on its own — there is no server to ask when it is needed.
 */
describe('clipsFor', () => {
  it('gives every examiner a face to fall back to', () => {
    for (const examiner of Object.values(EXAMINERS)) {
      const clips = clipsFor(examiner.avatarId)
      expect(clips, `${examiner.name} (${examiner.avatarId}) has no clips`).not.toBeNull()
      expect(clips!.talking).toMatch(/\.mp4$/)
      expect(clips!.listening).toMatch(/\.mp4$/)
    }
  })

  it('lends William his own footage and lends it to the men who have none', () => {
    expect(clipsFor('william')).toEqual(clipsFor('gabriel'))
    expect(clipsFor('william')!.talking).toContain('/faces/william/')
  })

  it('is null for anyone nobody was filmed for, so the room keeps the photograph', () => {
    expect(clipsFor('nobody')).toBeNull()
    expect(clipsFor(undefined)).toBeNull()
  })
})
