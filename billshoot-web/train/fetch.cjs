/**
 * The bill photos the page finder learns from, downloaded again from the
 * books — they are not kept in git.
 *
 *   node fetch.cjs <photos dir>
 *
 * Needs a trusted-device key for the shop's Convex, in SHIV_DEVICE_TOKEN or
 * in ../../print-server/.env.local. On a new machine, make one with
 *   npx convex run --prod devices:issueServerKey '{"name":"Training Mac"}'
 * Each photo in labels.json is saved as a<n>.jpg, the names prep.py reads.
 */
const fs = require('fs')
const path = require('path')
const { ConvexHttpClient } = require('convex/browser')

const out = process.argv[2]
if (!out) { console.error('usage: node fetch.cjs <photos dir>'); process.exit(1) }
fs.mkdirSync(out, { recursive: true })

function token() {
  if (process.env.SHIV_DEVICE_TOKEN) return process.env.SHIV_DEVICE_TOKEN.trim()
  try {
    const env = fs.readFileSync(path.join(__dirname, '../../print-server/.env.local'), 'utf8')
    return env.match(/^SHIV_DEVICE_TOKEN=(.*)$/m)?.[1]?.trim()
  } catch { return undefined }
}

;(async () => {
  const key = token()
  if (!key) throw new Error('No device key: set SHIV_DEVICE_TOKEN (see the top of this file).')
  const { photos } = JSON.parse(fs.readFileSync(path.join(__dirname, 'labels.json'), 'utf8'))
  const client = new ConvexHttpClient(process.env.CONVEX_URL || 'https://sensible-panther-176.convex.cloud')
  client.setAuth(key)
  const urls = await client.query('files:describe', { storageIds: photos.map((p) => p.id) })
  let saved = 0, missing = 0
  for (let i = 0; i < photos.length; i += 8) {
    await Promise.all(photos.slice(i, i + 8).map(async (p, k) => {
      const url = urls[i + k]?.url
      if (!url) { missing += 1; return }
      const res = await fetch(url)
      if (!res.ok) { missing += 1; return }
      fs.writeFileSync(path.join(out, `a${p.n}.jpg`), Buffer.from(await res.arrayBuffer()))
      saved += 1
    }))
  }
  console.log(`saved ${saved} photos to ${out}${missing ? `, ${missing} no longer in the books` : ''}`)
})().catch((e) => { console.error(e.message || e); process.exit(1) })
