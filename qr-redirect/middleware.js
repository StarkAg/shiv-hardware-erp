// The QR short link: <this host>/<card number>/<card secret>.
//
// For a card's first 20 days (from its own date) it redirects to the guarantee page
// on shivhardware.store, which shows the shop's name and logo. After that the card is
// served by this project's own page (src/), which is fully separate from the shop's
// site: nothing proxied from it, nothing linked to it, no name, logo or footer.
import { next } from '@vercel/functions/middleware'

const SITE = 'https://www.shivhardware.store/Gaurantee'
const CONVEX = 'https://sensible-panther-176.convex.cloud'
// Same as BRANDED_DAYS on the guarantee page (shivhardware.store, app/Gaurantee).
const BRANDED_DAYS = 20

export const config = { matcher: '/:number/:token' }

/** When the card was issued, or 0 if it cannot be found (then it is served here). */
async function issuedAt(number, token) {
  try {
    const res = await fetch(`${CONVEX}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'documents:getGuaranteeByNumber', args: { number, token }, format: 'json' }),
    })
    const value = (await res.json())?.value
    const doc = value?.document ?? value
    return Date.parse(doc?.date ?? '') || Number(value?.createdAt) || 0
  } catch {
    return 0
  }
}

export default async function middleware(request) {
  const url = new URL(request.url)
  const m = url.pathname.match(/^\/(GC-[A-Za-z0-9-]+)\/([A-Z0-9]{8,64})\/?$/)
  if (!m) return next()
  const [, number, token] = m

  // gc=1: the shop's page sent this card here (an old QR printing its address, past
  // its 20 days). Never send it back, whatever the clocks say: no loop.
  if (url.searchParams.has('gc')) return next()

  const issued = await issuedAt(number, token)
  if (issued && Date.now() - issued < BRANDED_DAYS * 24 * 60 * 60 * 1000) {
    const page = new URL(`${SITE}/${encodeURIComponent(number)}`)
    page.searchParams.set('k', token)
    return Response.redirect(page, 307)
  }
  return next()
}
