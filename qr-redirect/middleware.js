// The QR short link: <this host>/<card number>/<card secret>.
//
// For a card's first 20 days (from its own date) it redirects to the guarantee page
// on shivhardware.store, which shows the shop's name and logo. After that the card is
// served here instead, so the address bar never shows the shop's site: the request is
// proxied to the same page (which is neutral by then), and vercel.json proxies its
// scripts and images. One page to maintain, not two copies.
import { next, rewrite } from '@vercel/functions/middleware'

const SITE = 'https://www.shivhardware.store/Gaurantee'
const CONVEX = 'https://sensible-panther-176.convex.cloud'
// Same as BRANDED_DAYS on the guarantee page (shivhardware.store, app/Gaurantee).
const BRANDED_DAYS = 20

export const config = { matcher: '/:number/:token' }

/** When the card was issued, or 0 if it cannot be found (then it is served neutral here). */
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

  const page = new URL(`${SITE}/${encodeURIComponent(number)}`)
  page.searchParams.set('k', token)
  // Keep the page's own refresh parameters (Next.js _rsc) on the way through.
  for (const [k, v] of url.searchParams) if (k !== 'k') page.searchParams.set(k, v)

  const issued = await issuedAt(number, token)
  if (issued && Date.now() - issued < BRANDED_DAYS * 24 * 60 * 60 * 1000) {
    return Response.redirect(page, 307)
  }
  return rewrite(page)
}
