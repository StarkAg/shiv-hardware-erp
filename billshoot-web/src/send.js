/**
 * The finished picture, into the shop's WhatsApp group: through the shop's
 * database (convex/shopWhatsApp.ts), which alone holds the key to the Shop
 * WhatsApp on Railway. Only a device given the shop PIN gets this far.
 *
 * A plain request rather than the live link, so no signal says so at once
 * instead of waiting for one and sending the picture later, unseen.
 */
import { deviceToken } from './deviceTrust/deviceTrust.js'

export const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud'

const base64Of = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

export async function sendToGroup(blob, fileName) {
  const data = await base64Of(blob)
  let res
  try {
    res = await fetch(`${CONVEX_URL.replace(/\/+$/, '')}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deviceToken()}` },
      body: JSON.stringify({
        path: 'shopWhatsApp:sendDocument',
        args: { mobile: 'group', fileName, mimetype: 'image/jpeg', data },
        format: 'json',
      }),
      signal: AbortSignal.timeout(90_000),
    })
  } catch {
    throw new Error('No connection to the shop. Check the signal and try again.')
  }
  const body = await res.json().catch(() => ({}))
  if (body.status === 'success') return body.value
  const said = body.errorData
  throw new Error((typeof said === 'string' ? said : said?.message) || body.errorMessage || `The shop did not answer (${res.status}).`)
}
