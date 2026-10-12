/**
 * OpenTimestamps proofs: the format, read and written.
 *
 * OpenTimestamps (opentimestamps.org) writes a fingerprint into Bitcoin for
 * nothing: public "calendar" servers gather the fingerprints sent to them,
 * fold them into one, and put that into a Bitcoin transaction a few times a
 * day. What comes back is a proof (an .ots file): the steps that lead from
 * our fingerprint to a number written in a Bitcoin block. Anyone can check it
 * with the free `ots verify` tool, without asking us or the calendars.
 *
 * A proof is a tree. Each node is a message (bytes); its branches are steps
 * (append bytes, prepend bytes, hash) leading to the next message, and its
 * leaves are attestations: "pending at this calendar" while waiting, then
 * "in Bitcoin block N" once written. The binary layout follows the reference
 * client (python-opentimestamps, core/timestamp.py, core/op.py).
 *
 * The hashing is handed in (`Hash`), so this file runs in a Node action and in
 * a test alike.
 */

export type Hash = (name: 'sha256' | 'sha1' | 'ripemd160', data: Uint8Array) => Uint8Array

export type Attestation = { tag: Uint8Array; payload: Uint8Array }
export type Op = { tag: number; arg?: Uint8Array }
export type Node = { msg: Uint8Array; attestations: Attestation[]; ops: { op: Op; child: Node }[] }

export const MAGIC = Uint8Array.from([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
])
export const PENDING = Uint8Array.from([0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e])
export const BITCOIN = Uint8Array.from([0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01])
const SHA256 = 0x08
const APPEND = 0xf0
const PREPEND = 0xf1
const BINARY = new Set([APPEND, PREPEND])
const UNARY: Record<number, 'sha256' | 'sha1' | 'ripemd160' | 'reverse' | 'hexlify'> = {
  0x08: 'sha256', 0x02: 'sha1', 0x03: 'ripemd160', 0xf2: 'reverse', 0xf3: 'hexlify',
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
export const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
export const fromHex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (h) => parseInt(h, 16))
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0))
const text = (bytes: Uint8Array) => String.fromCharCode(...bytes)

/** What a step makes of a message. */
export function apply(op: Op, msg: Uint8Array, hash: Hash): Uint8Array {
  if (op.tag === APPEND) return join(msg, op.arg!)
  if (op.tag === PREPEND) return join(op.arg!, msg)
  const name = UNARY[op.tag]
  if (name === 'reverse') return Uint8Array.from(msg).reverse()
  if (name === 'hexlify') return ascii(hex(msg))
  if (name) return hash(name, msg)
  throw new Error(`Unknown step ${op.tag} in the proof`)
}

// ── Reading ─────────────────────────────────────────────────────────────────
class Reader {
  at = 0
  constructor(readonly bytes: Uint8Array) {}
  byte() {
    if (this.at >= this.bytes.length) throw new Error('The proof ends too early')
    return this.bytes[this.at++]
  }
  take(n: number) {
    if (this.at + n > this.bytes.length) throw new Error('The proof ends too early')
    const out = this.bytes.slice(this.at, this.at + n)
    this.at += n
    return out
  }
  varuint() {
    let value = 0
    let shift = 0
    for (;;) {
      const b = this.byte()
      value += (b & 0x7f) * 2 ** shift
      if (!(b & 0x80)) return value
      shift += 7
    }
  }
  varbytes() { return this.take(this.varuint()) }
}

function readNode(r: Reader, msg: Uint8Array, hash: Hash, depth = 0): Node {
  if (depth > 256) throw new Error('The proof is nested too deep')
  const node: Node = { msg, attestations: [], ops: [] }
  const item = (tag: number) => {
    if (tag === 0x00) {
      node.attestations.push({ tag: r.take(8), payload: r.varbytes() })
    } else {
      const op: Op = BINARY.has(tag) ? { tag, arg: r.varbytes() } : { tag }
      if (!BINARY.has(tag) && !UNARY[tag]) throw new Error(`Unknown step ${tag} in the proof`)
      node.ops.push({ op, child: readNode(r, apply(op, msg, hash), hash, depth + 1) })
    }
  }
  let tag = r.byte()
  while (tag === 0xff) { item(r.byte()); tag = r.byte() }
  item(tag)
  return node
}

/** A calendar's answer: the steps from `msg` onwards. */
export const readTimestamp = (bytes: Uint8Array, msg: Uint8Array, hash: Hash) => readNode(new Reader(bytes), msg, hash)

/** A whole .ots file: the fingerprint it is for, and the tree from it. */
export function readProof(bytes: Uint8Array, hash: Hash): { digest: Uint8Array; root: Node } {
  const r = new Reader(bytes)
  if (!same(r.take(MAGIC.length), MAGIC)) throw new Error('Not an OpenTimestamps proof')
  if (r.varuint() !== 1) throw new Error('An OpenTimestamps proof of another version')
  if (r.byte() !== SHA256) throw new Error('Only SHA-256 proofs are read here')
  const digest = r.take(32)
  return { digest, root: readNode(r, digest, hash) }
}

// ── Writing ─────────────────────────────────────────────────────────────────
const varuint = (n: number) => {
  const out: number[] = []
  do {
    let b = n % 128
    n = Math.floor(n / 128)
    if (n) b |= 0x80
    out.push(b)
  } while (n)
  return Uint8Array.from(out)
}
const varbytes = (bytes: Uint8Array) => join(varuint(bytes.length), bytes)

function writeNode(node: Node): Uint8Array {
  const items = [
    ...node.attestations.map((a) => join(Uint8Array.of(0x00), a.tag, varbytes(a.payload))),
    ...node.ops.map(({ op, child }) => join(Uint8Array.of(op.tag), op.arg ? varbytes(op.arg) : new Uint8Array(), writeNode(child))),
  ]
  if (!items.length) throw new Error('A step in the proof leads nowhere')
  return join(...items.map((item, i) => (i < items.length - 1 ? join(Uint8Array.of(0xff), item) : item)))
}

export const writeProof = (digest: Uint8Array, root: Node) =>
  join(MAGIC, varuint(1), Uint8Array.of(SHA256), digest, writeNode(root))

// ── What a proof says ───────────────────────────────────────────────────────
export type Leaf = { node: Node; attestation: Attestation }
export function leaves(node: Node, out: Leaf[] = []): Leaf[] {
  for (const attestation of node.attestations) out.push({ node, attestation })
  for (const { child } of node.ops) leaves(child, out)
  return out
}
/** The calendar a pending attestation waits at. */
export const pendingUrl = (a: Attestation) => text(new Reader(a.payload).varbytes())
/** The Bitcoin block a Bitcoin attestation names. */
export const blockHeight = (a: Attestation) => new Reader(a.payload).varuint()
export const isPending = (a: Attestation) => same(a.tag, PENDING)
export const isBitcoin = (a: Attestation) => same(a.tag, BITCOIN)

/** Several calendars' answers for one fingerprint, as one tree. */
export function merge(msg: Uint8Array, answers: Node[]): Node {
  return { msg, attestations: answers.flatMap((n) => n.attestations), ops: answers.flatMap((n) => n.ops) }
}
