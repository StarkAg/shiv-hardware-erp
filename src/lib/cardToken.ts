/**
 * The secret printed into a guarantee card's QR.
 *
 * The page behind that QR answers the public internet — the customer scanning
 * it has no account and never will — and card numbers run in a sequence, so
 * the number alone would let anyone walk the file from GC-2026-0001 and read
 * every customer's name, mobile, Aadhaar and prices. The number says which
 * card; this says you are holding it.
 *
 * The alphabet has no look-alikes in it (no O/0, no I/1/l): the thing is
 * printed small and occasionally read back over the phone.
 */
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function mintCardToken(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join('')
}
