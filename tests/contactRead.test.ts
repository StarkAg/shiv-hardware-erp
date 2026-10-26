import { describe, expect, it } from 'vitest'
import { nameToFill, numberToFill, parseAadhaar, parseContactRead, parseMobile, verhoeffValid } from '../convex/lib/contactRead'
import { SHOP } from '../src/lib/types'

/**
 * What the photo reader's numbers may fill on the bill screen.
 *
 * A wrong mobile sends a customer's bill to a stranger on WhatsApp, so the
 * rule is: only a whole number of the right shape fills a box, only an empty
 * box is filled, and the shop's own number off its pad is never the customer's.
 */
const OWN = SHOP.phones.map((p) => p.number)

describe('parseMobile', () => {
  it('takes ten digits starting 6 to 9, however they are spaced', () => {
    expect(parseMobile('9876543210')).toBe('9876543210')
    expect(parseMobile('98765 43210')).toBe('9876543210')
    expect(parseMobile('98765-43210')).toBe('9876543210')
    expect(parseMobile(' 6201 866 831 ')).toBe('6201866831')
  })

  it('drops the dialling prefix', () => {
    expect(parseMobile('+91 98765 43210')).toBe('9876543210')
    expect(parseMobile('919876543210')).toBe('9876543210')
    expect(parseMobile('09876543210')).toBe('9876543210')
    expect(parseMobile('0 98765 43210')).toBe('9876543210')
  })

  it('refuses anything short, long, unreadable or not a mobile', () => {
    expect(parseMobile('987654321')).toBeNull()
    expect(parseMobile('98765432101')).toBeNull()
    expect(parseMobile('98765?3210')).toBeNull()
    expect(parseMobile('98765 432I0')).toBeNull()
    expect(parseMobile('5876543210')).toBeNull()
    expect(parseMobile('0651 2234567')).toBeNull()
    expect(parseMobile('06553-222333')).toBeNull()
    expect(parseMobile('(0651) 2234567')).toBeNull()
    expect(parseMobile('')).toBeNull()
  })

  it('refuses the shop’s own numbers', () => {
    for (const n of OWN) expect(parseMobile(n, OWN)).toBeNull()
  })
})

describe('parseAadhaar', () => {
  it('checks the Verhoeff digit the way the textbook does', () => {
    expect(verhoeffValid('2363')).toBe(true)
    expect(verhoeffValid('2364')).toBe(false)
  })

  it('takes twelve digits whose check digit is right, in groups or not', () => {
    expect(parseAadhaar('2345 6789 0124')).toBe('234567890124')
    expect(parseAadhaar('584639201744')).toBe('584639201744')
    expect(parseAadhaar('9999-0000-1119')).toBe('999900001119')
  })

  it('refuses a misread digit or two digits swapped', () => {
    expect(parseAadhaar('2345 6789 0125')).toBeNull()
    expect(parseAadhaar('2345 6789 1024')).toBeNull()
    expect(parseAadhaar('3245 6789 0124')).toBeNull()
  })

  it('refuses a wrong length, an unreadable digit, or a leading 0 or 1', () => {
    expect(parseAadhaar('2345 6789 012')).toBeNull()
    expect(parseAadhaar('2345 6789 01245')).toBeNull()
    expect(parseAadhaar('2345 6789 ?124')).toBeNull()
    expect(parseAadhaar('9876543210')).toBeNull()
    for (let d = 0; d < 10; d++) {
      expect(parseAadhaar(`0${'23456789012'.slice(1)}${d}`)).toBeNull()
      expect(parseAadhaar(`1${'23456789012'.slice(1)}${d}`)).toBeNull()
    }
  })
})

describe('parseContactRead', () => {
  it('gives back everything read, with the number each one fills', () => {
    const read = parseContactRead({
      phones: ['98765 43210', '9876?43210'],
      uids: ['2345 6789 0125'],
    }, OWN)
    expect(read.phones).toEqual([
      { raw: '98765 43210', number: '9876543210' },
      { raw: '9876?43210', number: null },
    ])
    expect(read.uids).toEqual([{ raw: '2345 6789 0125', number: null }])
  })

  it('leaves out the shop’s own number and repeats', () => {
    const read = parseContactRead({
      phones: ['8092850954', '+91 98765 43210', '9876543210', ''],
      uids: [],
    }, OWN)
    expect(read.phones).toEqual([{ raw: '+91 98765 43210', number: '9876543210' }])
  })

  it('copes with the reader leaving a list out', () => {
    expect(parseContactRead({}, OWN)).toEqual({ phones: [], uids: [] })
  })
})

describe('numberToFill', () => {
  const read = parseContactRead({ phones: ['98765?3210', '7004416864'] }, OWN).phones

  it('fills an empty box with the first whole number read', () => {
    expect(numberToFill('', read)).toBe('7004416864')
    expect(numberToFill(undefined, read)).toBe('7004416864')
  })

  it('never fills a box that holds something', () => {
    expect(numberToFill('9123456789', read)).toBeNull()
    expect(numberToFill('91', read)).toBeNull()
  })

  it('fills nothing when nothing read is whole', () => {
    expect(numberToFill('', parseContactRead({ phones: ['98765?3210'] }).phones)).toBeNull()
  })
})

describe('nameToFill', () => {
  const fold = (s: string) => s.toLowerCase().replace(/^m\/s\s*/, '').replace(/\s+/g, ' ').trim()
  const nutan = { name: 'M/s Nutan Jewellers, Gola', mobile: '9693991196' }
  const ravi = { name: 'Ravi Kumar', mobile: '7004416864', uid: '234123412346' }
  const accounts = [nutan, ravi]

  it('names the account that holds the mobile read off a slip with no name on it', () => {
    expect(nameToFill('', parseContactRead({ phones: ['96939 91196'] }, OWN), accounts, fold)).toBe(nutan)
  })

  it('names the account that holds the Aadhaar read', () => {
    expect(nameToFill('', parseContactRead({ uids: ['2341 2341 2346'] }, OWN), accounts, fold)).toBe(ravi)
  })

  it('takes a written name as the account spells it, or as written when there is none', () => {
    expect(nameToFill('', parseContactRead({ name: 'nutan jewellers,  gola' }, OWN), accounts, fold)).toBe(nutan)
    expect(nameToFill('', parseContactRead({ name: 'Sunil Sahu' }, OWN), accounts, fold)).toEqual({ name: 'Sunil Sahu', mobile: '' })
  })

  it('never names over a name in the box, nor by a number two accounts share', () => {
    expect(nameToFill('Someone', parseContactRead({ phones: ['9693991196'] }, OWN), accounts, fold)).toBeNull()
    const twin = { name: 'Gola Traders', mobile: '9693991196' }
    expect(nameToFill('', parseContactRead({ phones: ['9693991196'] }, OWN), [...accounts, twin], fold)).toBeNull()
  })
})
