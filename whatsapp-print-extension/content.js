// A Print panel over WhatsApp Web's photo viewer. Press it and the photo goes
// to the shop print server — no print window.
const PANEL_ID = 'shiv-wa-print'
const TYPES = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1 }

/** The photo open in the viewer: the one big picture on screen (chat thumbnails are far smaller). */
function viewerImage() {
  let best = null
  let bestArea = 0
  for (const img of document.querySelectorAll('img')) {
    if (!img.src.startsWith('blob:')) continue
    const r = img.getBoundingClientRect()
    if (r.height < innerHeight * 0.45 || r.width < 200) continue
    if (r.bottom < 0 || r.top > innerHeight) continue
    const area = r.width * r.height
    if (area > bestArea) { best = img; bestArea = area }
  }
  return best
}

function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function buildPanel() {
  const box = document.createElement('div')
  box.id = PANEL_ID
  box.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:8px;padding:8px 10px;background:#fff;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 4px 18px rgba(0,0,0,.25);font:600 14px Segoe UI,system-ui,sans-serif;color:#0f172a'
  const btn = (label, bg) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = `all:unset;cursor:pointer;padding:8px 14px;border-radius:8px;color:#fff;background:${bg}`
    return b
  }
  const bw = btn('Print B/W', '#1d4ed8')
  const colour = btn('Print Colour', '#15803d')
  const copies = document.createElement('input')
  copies.type = 'number'; copies.min = '1'; copies.max = '20'; copies.value = '1'
  copies.title = 'Copies'
  copies.style.cssText = 'width:48px;padding:6px;border:1px solid #cbd5e1;border-radius:8px;font:inherit'
  const note = document.createElement('span')
  note.style.cssText = 'min-width:0;max-width:280px;font-weight:500'
  box.append(bw, colour, copies, note)

  async function send(mode, button) {
    const img = viewerImage()
    if (!img) { note.textContent = 'Open a photo first.'; return }
    for (const b of [bw, colour]) b.style.opacity = '.5'
    note.style.color = '#0f172a'; note.textContent = 'Printing…'
    try {
      const blob = await (await fetch(img.src)).blob()
      const mediaType = TYPES[blob.type] ? blob.type : 'image/jpeg'
      const dataUrl = await toDataUrl(blob)
      const n = Math.min(20, Math.max(1, Math.floor(Number(copies.value) || 1)))
      const out = await chrome.runtime.sendMessage({ type: 'print', dataUrl, mediaType, name: `whatsapp-${Date.now()}.${mediaType.split('/')[1]}`, mode, copies: n })
      if (!out?.ok) throw new Error(out?.error ?? 'No answer from the extension.')
      note.style.color = '#15803d'; note.textContent = `Sent to ${out.printer}`
    } catch (err) {
      note.style.color = '#b91c1c'; note.textContent = String(err.message ?? err)
    } finally {
      for (const b of [bw, colour]) b.style.opacity = '1'
    }
  }
  bw.onclick = () => send('bw', bw)
  colour.onclick = () => send('color', colour)
  // Keys typed in the copies box must not reach WhatsApp's shortcuts.
  box.addEventListener('keydown', (e) => e.stopPropagation())
  return box
}

setInterval(() => {
  const open = !!viewerImage()
  const panel = document.getElementById(PANEL_ID)
  if (open && !panel) document.body.appendChild(buildPanel())
  else if (!open && panel) panel.remove()
}, 400)
