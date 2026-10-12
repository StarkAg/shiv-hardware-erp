import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as ots from '../convex/lib/ots'

const hash: ots.Hash = (name, data) => new Uint8Array(createHash(name).update(data).digest())
const enc = (s: string) => new TextEncoder().encode(s)
const varbytes = (b: Uint8Array) => Uint8Array.from([b.length, ...b])

/** A calendar's answer as the calendars write it: steps, then "pending at <url>". */
const answer = (salt: string, url: string) => Uint8Array.from([
  0xf0, ...varbytes(enc(salt)), 0x08,
  0x00, ...ots.PENDING, ...varbytes(varbytes(enc(url))),
])

/**
 * The OpenTimestamps proof format (convex/lib/ots.ts). The same code was
 * checked by hand against the reference library and a real proof in Bitcoin
 * block 358,391; these keep it from drifting.
 */
describe('OpenTimestamps proofs', () => {
  const head = '15ef3cad00cd2d059fcd386c3c48ded661d20b7ae0e7229dff7c9db750aef126'
  const digest = hash('sha256', enc(head))

  it('writes a proof from calendar answers and reads it back the same', () => {
    const answers = [answer('a1', 'https://alice.example'), answer('b2', 'https://bob.example')].map((a) => ots.readTimestamp(a, digest, hash))
    const proof = ots.writeProof(digest, ots.merge(digest, answers))
    expect(Array.from(proof.slice(0, ots.MAGIC.length))).toEqual(Array.from(ots.MAGIC))
    const back = ots.readProof(proof, hash)
    expect(ots.hex(back.digest)).toBe(ots.hex(digest))
    expect(ots.writeProof(back.digest, back.root)).toEqual(proof)
    const pending = ots.leaves(back.root).filter((l) => ots.isPending(l.attestation))
    expect(pending.map((l) => ots.pendingUrl(l.attestation))).toEqual(['https://alice.example', 'https://bob.example'])
    // Each leaf's message is the fingerprint with the calendar's steps applied.
    expect(ots.hex(pending[0].node.msg)).toBe(ots.hex(hash('sha256', Uint8Array.from([...digest, ...enc('a1')]))))
  })

  it('reads the block a Bitcoin attestation names', () => {
    const height = 917_431
    const bytes = [] as number[]
    for (let n = height; ; ) { const b = n % 128; n = Math.floor(n / 128); bytes.push(n ? b | 0x80 : b); if (!n) break }
    const node = ots.readTimestamp(Uint8Array.from([0x00, ...ots.BITCOIN, ...varbytes(Uint8Array.from(bytes))]), digest, hash)
    expect(ots.isBitcoin(node.attestations[0])).toBe(true)
    expect(ots.blockHeight(node.attestations[0])).toBe(height)
  })

  it('refuses what is not a proof', () => {
    expect(() => ots.readProof(enc('not a proof at all, just some text here'), hash)).toThrow('Not an OpenTimestamps proof')
    const cut = ots.writeProof(digest, ots.merge(digest, [ots.readTimestamp(answer('x', 'https://c.example'), digest, hash)])).slice(0, -3)
    expect(() => ots.readProof(cut, hash)).toThrow('ends too early')
  })
})
