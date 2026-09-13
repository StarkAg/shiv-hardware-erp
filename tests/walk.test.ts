import { describe, expect, it } from 'vitest'
import { nextStep } from '../src/features/ledger/lib/walk.js'

// The voucher's fields, in the order the form draws them.
const stops = ['date', 'ref', 'party', 'account', 'amount', 'narration']

describe('Enter on a voucher', () => {
  it('walks field by field', () => {
    expect(nextStep({ stops, from: 'ref', dateAsked: true })).toEqual({ do: 'focus', stop: 'party' })
    expect(nextStep({ stops, from: 'account', dateAsked: true })).toEqual({ do: 'focus', stop: 'amount' })
  })

  it('asks the date once the party is named, so it cannot be walked past', () => {
    expect(nextStep({ stops, from: 'party', dateAsked: false })).toEqual({ do: 'ask-date' })
  })

  it('having been asked, carries on to the account', () => {
    expect(nextStep({ stops, from: 'party', dateAsked: true })).toEqual({ do: 'focus', stop: 'account' })
  })

  it('opens the date when Enter lands on it', () => {
    expect(nextStep({ stops, from: 'date', dateAsked: true })).toEqual({ do: 'ask-date' })
  })

  it('accepts the voucher off the end', () => {
    expect(nextStep({ stops, from: 'narration', dateAsked: true })).toEqual({ do: 'submit' })
  })

  it('asks the date before writing a voucher that never passed the party', () => {
    // Opened from a party's own page: the cursor starts at the amount.
    expect(nextStep({ stops, from: 'narration', dateAsked: false }))
      .toEqual({ do: 'ask-date', then: 'submit' })
  })

  it('leaves keys pressed outside the walk alone', () => {
    expect(nextStep({ stops, from: 'photo', dateAsked: true })).toEqual({ do: 'nothing' })
  })
})
