import { describe, expect, it } from 'vitest'
import { recentLines } from '../src/features/ledger/lib/recent'

const entry = (n: number) => ({ kind: 'entry', key: `e${n}`, r: { balance: n * 100 } })

describe('the latest lines of a long account', () => {
  it('leaves a short account alone', () => {
    const stream = Array.from({ length: 39 }, (_, i) => entry(i))
    expect(recentLines(stream)).toEqual({ shown: stream, older: [], before: null })
  })

  it('keeps the newest and says what the balance was before them', () => {
    const stream = Array.from({ length: 421 }, (_, i) => entry(i))
    const { shown, older, before } = recentLines(stream)
    expect(shown).toHaveLength(30)
    expect(shown.at(-1)).toBe(stream[420])
    expect(older).toHaveLength(391)
    expect(before).toEqual({ balance: 39000 })
  })

  it('never hides something still waiting, however old', () => {
    const pending = { kind: 'pending', key: 'p' }
    const open = { kind: 'received', key: 'g1', g: { open: true } }
    const billed = { kind: 'received', key: 'g2', g: { open: false } }
    const stream = [pending, open, billed, ...Array.from({ length: 100 }, (_, i) => entry(i))]
    const { shown, older } = recentLines(stream)
    expect(shown.slice(0, 2)).toEqual([pending, open])
    expect(shown).toHaveLength(32)
    expect(older).toContain(billed)
  })
})
