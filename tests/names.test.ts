import { describe, expect, it } from 'vitest'
import { toProperCase, withoutCourtesy, rupeesInWords } from '../src/lib/billHtml'

/**
 * The text helpers the bill screen runs on every keystroke.
 *
 * Three bugs in a row came from this corner and none of them could fail a test
 * about the books: a transform that changed a field's length ate the space in
 * "KM Traders", and `\b` treating an apostrophe as a word boundary made the
 * small s in "Louver's" impossible to type. The length rule is the important
 * one — anything that changes it while typing fights the caret.
 */
describe('toProperCase', () => {
  it('never changes the length, so the caret cannot move', () => {
    for (const s of ["louver's", 'km traders', '9.6\' 1128 - louver\'s', 'KM ', 'a', '', "don't stop"]) {
      expect(toProperCase(s)).toHaveLength(s.length)
    }
  })

  it('leaves the possessive s alone', () => {
    expect(toProperCase("louver's")).toBe("Louver's")
    expect(toProperCase("9.6' 1128 - louver's")).toBe("9.6' 1128 - Louver's")
    expect(toProperCase("louver's panel")).toBe("Louver's Panel")
  })

  it('leaves a contraction alone', () => {
    expect(toProperCase("don't")).toBe("Don't")
  })

  it('still capitalises a real word after an apostrophe', () => {
    expect(toProperCase("o'brien")).toBe("O'Brien")
  })

  it('capitalises the start of each word', () => {
    expect(toProperCase('km traders')).toBe('Km Traders')
    expect(toProperCase('santosh singh ji, purnimandap')).toBe('Santosh Singh Ji, Purnimandap')
  })

  it('does not break into a word at a digit', () => {
    expect(toProperCase('8x4 ply')).toBe('8x4 Ply')
  })

  it('keeps a trailing space, so a space can be typed', () => {
    expect(toProperCase('km ')).toBe('Km ')
  })
})

describe('withoutCourtesy', () => {
  it('takes off the courtesy however it is written', () => {
    expect(withoutCourtesy('M/s Pappu Jee, Naisarai')).toBe('Pappu Jee, Naisarai')
    expect(withoutCourtesy('M/S Pappu Jee, Naisarai')).toBe('Pappu Jee, Naisarai')
    expect(withoutCourtesy('m/s. Pappu Jee')).toBe('Pappu Jee')
  })

  it('leaves a woman\'s title alone', () => {
    expect(withoutCourtesy('Ms Priya')).toBe('Ms Priya')
  })

  it('takes off only one, so a doubled name is still visibly wrong', () => {
    expect(withoutCourtesy('M/s M/s Doubled')).toBe('M/s Doubled')
  })

  it('leaves a plain name untouched', () => {
    expect(withoutCourtesy('Pappu Jee')).toBe('Pappu Jee')
  })
})

describe('rupeesInWords', () => {
  it('writes a receipt figure the Indian way', () => {
    expect(rupeesInWords(29830)).toBe('Twenty Nine Thousand Eight Hundred Thirty Rupees Only')
    expect(rupeesInWords(100000)).toBe('One Lakh Rupees Only')
    expect(rupeesInWords(10000000)).toBe('One Crore Rupees Only')
    expect(rupeesInWords(1356921)).toBe('Thirteen Lakh Fifty Six Thousand Nine Hundred Twenty One Rupees Only')
  })

  it('handles nothing, and the teens', () => {
    expect(rupeesInWords(0)).toBe('Zero Rupees Only')
    expect(rupeesInWords(15)).toBe('Fifteen Rupees Only')
    expect(rupeesInWords(19)).toBe('Nineteen Rupees Only')
  })

  it('ignores the paise rather than inventing them', () => {
    expect(rupeesInWords(250.75)).toBe('Two Hundred Fifty Rupees Only')
  })
})
