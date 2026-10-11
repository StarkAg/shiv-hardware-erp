// What a payment QR says, and the links that open a UPI app on it.
//
// Two kinds of QR carry a UPI payee:
//   - the UPI one, a link:  upi://pay?pa=name@bank&pn=Name&am=...
//   - the Bharat QR one (bank-issued shop QRs), a run of numbered fields that
//     holds the same UPI ID inside its "merchant account" fields.
// Everything the QR said is passed on untouched (its own mode, reference and
// signature), so the UPI app sees the QR's payment and not a hand-made one.

const read = (raw) => {
  try { return decodeURIComponent(raw.replace(/\+/g, ' ')) } catch { return raw }
}
const UPI_ID = /^[\w.-]+@[\w.-]+$/

function fromLink(text) {
  // A QR that is the link and nothing else is taken to the end of its line:
  // many write the name with plain spaces in it (pn=SHIV HARDWARE STORE).
  // Inside other text (a shared message) the link ends at the first space.
  const link = text.match(/^upi:\/\/pay\/?\?([^\r\n#]+)/i) ?? text.match(/upi:\/\/pay\/?\?([^\s"'<>#]+)/i)
  if (!link) return null
  return link[1].trim().split('&').filter(Boolean).map((part) => {
    const at = part.indexOf('=')
    return at < 0 ? [part, ''] : [part.slice(0, at), part.slice(at + 1).replace(/ /g, '%20')]
  })
}

/** Numbered fields: two digits of name, two of length, then that many characters. */
function fields(text) {
  const out = new Map()
  let i = 0
  while (i + 4 <= text.length) {
    const size = Number(text.slice(i + 2, i + 4))
    if (!/^\d{4}$/.test(text.slice(i, i + 4)) || i + 4 + size > text.length) return null
    out.set(text.slice(i, i + 2), text.slice(i + 4, i + 4 + size))
    i += 4 + size
  }
  return i === text.length ? out : null
}

function fromBharatQr(text) {
  if (!/^0002\d\d/.test(text)) return null
  const top = fields(text)
  if (!top) return null
  let pa = '', tr = ''
  // Fields 26 to 51 are the payee's accounts, one per network; NPCI's are
  // marked A000000524 and hold the UPI ID (or, in another, the reference).
  for (let n = 26; n <= 51; n++) {
    const inner = top.has(String(n)) ? fields(top.get(String(n))) : null
    if (!inner || !(inner.get('00') ?? '').startsWith('A000000524')) continue
    const value = inner.get('01') ?? ''
    if (UPI_ID.test(value)) pa ||= value
    else tr ||= value
  }
  if (!pa) return null
  const pairs = [['pa', pa]]
  if (top.get('59')) pairs.push(['pn', encodeURIComponent(top.get('59'))])
  if (top.get('52')) pairs.push(['mc', top.get('52')])
  if (tr) pairs.push(['tr', encodeURIComponent(tr)])
  if (Number(top.get('54')) > 0) pairs.push(['am', top.get('54')])
  pairs.push(['cu', 'INR'])
  return pairs
}

/** The payee in what was read (several texts when a photo holds several codes), or null. */
export function findPayee(texts) {
  for (const text of texts) {
    const pairs = fromLink(text.trim()) ?? fromBharatQr(text.trim())
    if (!pairs) continue
    const get = (key) => read(pairs.find(([k]) => k.toLowerCase() === key)?.[1] ?? '')
    const pa = get('pa').trim()
    if (!UPI_ID.test(pa)) continue
    return { pa, pn: get('pn').trim(), am: cleanAmount(get('am')) || '', pairs }
  }
  return null
}

/** An amount as typed: '' for none, null when it is not an amount, else the digits. */
export function cleanAmount(input) {
  const typed = String(input ?? '').replace(/[,\s₹]/g, '')
  if (!typed) return ''
  if (!/^\d+(\.\d{1,2})?$/.test(typed) || Number(typed) <= 0) return null
  return typed.replace(/^0+(?=\d)/, '')
}

function payQuery(payee, amount) {
  let pairs = payee.pairs
  if (Number(amount || 0) !== Number(payee.am || 0)) {
    // A different amount from the QR's own: the QR's signature covers its
    // amount, so it goes too, or the app would refuse the pair as tampered.
    pairs = pairs.filter(([k]) => !['am', 'sign'].includes(k.toLowerCase()))
    if (amount) {
      pairs.push(['am', amount])
      if (!pairs.some(([k]) => k.toLowerCase() === 'cu')) pairs.push(['cu', 'INR'])
    }
  }
  return pairs.map(([k, v]) => `${k}=${v}`).join('&')
}

const ANDROID = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

/** The links for this payee and amount ('' leaves the amount to be typed in the UPI app). */
export function payLinks(payee, amount) {
  const query = payQuery(payee, amount)
  return {
    // The plain UPI link: the phone offers every UPI app on it (or goes to the
    // one set as the usual). This is the one used by default and when copied.
    any: `upi://pay?${query}`,
    // On Android the UPI link is handed to PhonePe by name, so no app chooser
    // comes up; the iPhone has only PhonePe's own kind of link.
    phonepe: ANDROID ? `intent://pay?${query}#Intent;scheme=upi;package=com.phonepe.app;end` : `phonepe://pay?${query}`,
  }
}
