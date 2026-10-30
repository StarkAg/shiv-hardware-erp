// A Print panel over WhatsApp Web's viewer, only while a photo or a PDF is open
// in it. Press it and the file goes to the shop print server — no print window.
// Looks like the Shiv "Signs" design (DESIGN.md): white, square, heavy black
// rules, Barlow, green = send.
const PANEL_ID = 'shiv-wa-print'
const IMAGE_TYPES = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1 }

const css = document.createElement('style')
css.textContent = `
@font-face{font-family:"Shiv Barlow Condensed";font-weight:800;src:url("${chrome.runtime.getURL('fonts/barlow-condensed-800.woff2')}") format("woff2")}
@font-face{font-family:"Shiv Barlow Semi";font-weight:600;src:url("${chrome.runtime.getURL('fonts/barlow-semi-condensed-600.woff2')}") format("woff2")}
#${PANEL_ID}{position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:stretch;gap:0;background:#fff;color:#0e1318;border:2px solid #0e1318;border-top-width:4px;font:600 16px/1.2 "Shiv Barlow Semi","Arial Narrow",Arial,sans-serif}
#${PANEL_ID} *{box-sizing:border-box;border-radius:0;box-shadow:none}
#${PANEL_ID} button{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;justify-content:center;min-height:48px;padding:0 18px;background:#007a3d;color:#fff;font:800 20px/1 "Shiv Barlow Condensed","Arial Narrow",Arial,sans-serif;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}
#${PANEL_ID} button+button{border-left:2px solid #fff}
#${PANEL_ID} button:active{transform:translateY(2px)}
#${PANEL_ID} button:disabled{opacity:.45;cursor:default}
#${PANEL_ID} label{display:flex;align-items:center;gap:8px;padding:0 12px;font:800 16px/1 "Shiv Barlow Condensed","Arial Narrow",Arial,sans-serif;text-transform:uppercase;letter-spacing:.03em;color:#4c5660;border-left:2px solid #0e1318}
#${PANEL_ID} input{width:52px;height:36px;padding:0 6px;border:2px solid #c9cfd5;background:#fff;color:#0e1318;font:800 20px/1 "Shiv Barlow Condensed","Arial Narrow",Arial,sans-serif;text-align:center}
#${PANEL_ID} .note{display:flex;align-items:center;max-width:300px;padding:0 12px;border-left:2px solid #0e1318;color:#0e1318}
#${PANEL_ID} .note[hidden]{display:none}
#${PANEL_ID} .note.ok{color:#007a3d}
#${PANEL_ID} .note.bad{color:#b3202a}
`
document.documentElement.appendChild(css)

const big = (r) => r.height >= innerHeight * 0.55 && r.width >= 200 && r.bottom > 0 && r.top < innerHeight
// Pictures in the chat are never as tall as the viewer's; the viewer's is not inside a message either.
const inChat = (el) => !!el.closest('[data-id], [role="row"], #pane-side')

/** What the viewer is showing: a photo, or a PDF in a frame — else null. */
function viewerFile() {
  let best = null
  let bestArea = 0
  for (const img of document.querySelectorAll('img')) {
    if (!img.src.startsWith('blob:') || inChat(img)) continue
    const r = img.getBoundingClientRect()
    if (!big(r)) continue
    if (r.width * r.height > bestArea) { best = { src: img.src }; bestArea = r.width * r.height }
  }
  for (const el of document.querySelectorAll('embed, iframe, object')) {
    const src = el.src || el.data || ''
    if (!/^(blob|data):/.test(src) || inChat(el)) continue
    if (big(el.getBoundingClientRect())) return { src }
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

/** The whole PDF: press the viewer's own Download button, and take the file it makes instead of saving it. */
function capturePdf() {
  const icon = document.querySelector('[data-icon="download"], [aria-label="Download"]')
  const button = icon?.closest('button, [role="button"]') ?? icon
  if (!button) return Promise.resolve(null)
  return new Promise((resolve) => {
    const done = (blob) => { clearTimeout(timer); window.removeEventListener('message', onMsg); window.postMessage({ shivArm: false }, '*'); resolve(blob) }
    const timer = setTimeout(() => done(null), 5000)
    const onMsg = (e) => {
      if (e.source !== window || !e.data?.shivBlobUrl) return
      fetch(e.data.shivBlobUrl).then((r) => r.blob()).then((b) => done(b.type === 'application/pdf' || b.size ? b : null), () => done(null))
    }
    window.addEventListener('message', onMsg)
    window.postMessage({ shivArm: true }, '*')
    button.click()
  })
}

function buildPanel() {
  const box = document.createElement('div')
  box.id = PANEL_ID
  const key = (label) => { const b = document.createElement('button'); b.textContent = label; return b }
  const bw = key('Print B/W')
  const colour = key('Print Colour')
  const label = document.createElement('label')
  label.append('Copies')
  const copies = document.createElement('input')
  copies.type = 'number'; copies.min = '1'; copies.max = '20'; copies.value = '1'
  label.append(copies)
  const note = document.createElement('span')
  note.className = 'note'
  note.hidden = true
  box.append(bw, colour, label, note)

  const say = (text, kind = '') => { note.hidden = !text; note.textContent = text; note.className = `note ${kind}` }

  async function send(mode) {
    const file = viewerFile()
    if (!file) { say('Open a photo or PDF first.', 'bad'); return }
    bw.disabled = colour.disabled = true
    say('Printing…')
    try {
      // A PDF is shown as page pictures, so ask the viewer for the whole file.
      const whole = document.body.innerText.includes('Powered by Adobe Acrobat') ? await capturePdf() : null
      const blob = whole ?? await (await fetch(file.src)).blob()
      if (document.body.innerText.includes('Powered by Adobe Acrobat') && !whole) say('Could not get the whole PDF — printing this page only…')
      const isPdf = !!whole || blob.type === 'application/pdf'
      const mediaType = isPdf ? 'application/pdf' : IMAGE_TYPES[blob.type] ? blob.type : 'image/jpeg'
      const dataUrl = await toDataUrl(blob)
      const n = Math.min(20, Math.max(1, Math.floor(Number(copies.value) || 1)))
      const ext = isPdf ? 'pdf' : mediaType.split('/')[1]
      const out = await chrome.runtime.sendMessage({ type: 'print', dataUrl, mediaType, name: `whatsapp-${Date.now()}.${ext}`, mode, copies: n })
      if (!out?.ok) throw new Error(out?.error ?? 'No answer from the extension.')
      say(`Sent to ${out.printer}`, 'ok')
    } catch (err) {
      say(String(err.message ?? err), 'bad')
    } finally {
      bw.disabled = colour.disabled = false
    }
  }
  bw.onclick = () => send('bw')
  colour.onclick = () => send('color')
  // Keys typed in the copies box must not reach WhatsApp's shortcuts.
  box.addEventListener('keydown', (e) => e.stopPropagation())
  return box
}

setInterval(() => {
  const open = !!viewerFile()
  const panel = document.getElementById(PANEL_ID)
  if (open && !panel) document.body.appendChild(buildPanel())
  else if (!open && panel) panel.remove()
}, 400)
