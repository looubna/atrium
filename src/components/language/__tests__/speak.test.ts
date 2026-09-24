import { describe, expect, it } from 'vitest'
import { normalise, similarity, verdictOf } from '../Speak'

describe('checking a word said out loud', () => {
  it('compares the words, not accents, case or punctuation', () => {
    expect(normalise('¿Qué tipo de música?')).toBe('que tipo de musica')
    expect(verdictOf(similarity('mucho gusto', 'Mucho gusto.'))).toBe('right')
  })

  it('does not wave a different word through', () => {
    expect(verdictOf(similarity('de nada', 'gracias'))).toBe('wrong')
    expect(verdictOf(similarity('la tecnologia es util', 'La tecnología es muy útil'))).toBe('close')
  })
})
