/**
 * The seal on the books' history.
 *
 * Every line of the history carries a fingerprint made from what the line
 * says and from the fingerprint of the line before it. Change an old line,
 * take one out or slip one in, and its fingerprint no longer fits, nor does
 * any after it: the chain says where it was broken. A line about a voucher
 * also carries a fingerprint of the voucher as it stood then, so a voucher
 * altered some way other than through the app no longer matches its last line.
 *
 * Nothing leaves the shop's own books for this. It is the idea a blockchain
 * is built on, kept in the same database, with nothing published. What it
 * cannot do alone is stop someone who can rewrite the whole table from
 * writing a new chain: that takes a copy of the latest fingerprint kept
 * somewhere else (the nightly check writes it down; see convex/chain.ts).
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

// ── SHA-256 ──────────────────────────────────────────────────────────────────
// Written out here so a seal is made the same way in a mutation, in an action
// and in a test, and in step with the mutation that writes the line it seals.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** The text as UTF-8 bytes, without leaning on anything the runtime may lack. */
function utf8(text: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1)
      if (low >= 0xdc00 && low <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00); i++ }
    }
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return Uint8Array.from(out)
}

/** SHA-256 of a text, as 64 hex characters. */
export function sha256(text: string): string {
  const bytes = utf8(text)
  const bits = bytes.length * 8
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000))
  view.setUint32(padded.length - 4, bits >>> 0)

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let at = 0; at < padded.length; at += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(at + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      hh = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}

// ── What is sealed ───────────────────────────────────────────────────────────
/** What the first line of the chain stands on: there is no line before it. */
export const GENESIS = 'shiv-hardware-books'

/** A line of the history as its seal reads it. */
export type Sealed = {
  seq: number
  at: number
  action: string
  summary: string
  entity?: string | null
  entityId?: string | null
  detail?: string | null
  state?: string | null
  prev: string
}

/**
 * The fingerprint of one line: every field that says something, in a fixed
 * order, with the fingerprint of the line before it at the end.
 */
export function sealOf(line: Sealed): string {
  return sha256(JSON.stringify([
    line.seq, line.at, line.action, line.summary,
    line.entity ?? null, line.entityId ?? null, line.detail ?? null, line.state ?? null,
    line.prev,
  ]))
}

/** The last sealed line: where the next one joins on. Null before the first. */
export async function chainHead(ctx: QueryCtx | MutationCtx): Promise<Doc<'history'> | null> {
  const last = await ctx.db.query('history').withIndex('by_seq').order('desc').first()
  return last?.seq === undefined ? null : last
}

/**
 * A voucher as its fingerprint reads it: what it posts, and nothing that may
 * change without the books changing (its photos, its commission tick, when it
 * was last saved). Null when there is no such voucher.
 */
export async function voucherState(ctx: QueryCtx | MutationCtx, id: Id<'vouchers'>): Promise<string | null> {
  const voucher = await ctx.db.get(id)
  if (!voucher) return null
  const lines = await ctx.db
    .query('voucherEntries')
    .withIndex('by_voucher', (q) => q.eq('voucherId', id))
    .collect()
  const posted = lines
    .map((l) => `${l.ledgerId}|${l.side}|${Math.round(l.amount * 100)}|${l.date}`)
    .sort()
  return sha256(JSON.stringify([
    voucher.typeId, voucher.voucherNo, voucher.fy, voucher.date, voucher.partyLedgerId,
    voucher.status ?? null, voucher.amount === undefined ? null : Math.round(voucher.amount * 100),
    posted,
  ]))
}

/** The fields a new line takes to join the chain. */
export async function nextSeal(
  ctx: MutationCtx,
  line: Omit<Sealed, 'seq' | 'prev'>,
): Promise<{ seq: number; prev: string; hash: string }> {
  const head = await chainHead(ctx)
  const seq = (head?.seq ?? 0) + 1
  const prev = head?.hash ?? GENESIS
  return { seq, prev, hash: sealOf({ ...line, seq, prev }) }
}
