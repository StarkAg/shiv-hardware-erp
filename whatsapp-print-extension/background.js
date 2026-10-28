// Sends the photo to the shop print server. Done here, not in the page: web.whatsapp.com
// is https and may not call a plain-http address, but the extension may.
const DEFAULT_SERVER = 'http://localhost:3333'

async function serverUrl() {
  const { server } = await chrome.storage.sync.get('server')
  return (server || DEFAULT_SERVER).trim().replace(/\/+$/, '')
}

async function printPhoto({ dataUrl, mediaType, name, mode, copies }) {
  const base = await serverUrl()
  let res
  try {
    res = await fetch(`${base}/whatsapp-print/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ name, mediaType, data: dataUrl }], copies, mode }),
    })
  } catch {
    throw new Error(`Cannot reach the print server at ${base}. Is it running on the shop PC?`)
  }
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Print server said HTTP ${res.status}`)
  return { printer: json.printer }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'print') return false
  printPhoto(msg).then((r) => reply({ ok: true, ...r }), (e) => reply({ ok: false, error: String(e.message ?? e) }))
  return true // reply later
})
