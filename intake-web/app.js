const form = document.querySelector('#intake')
const picker = document.querySelector('#photos')
const drop = document.querySelector('#drop')
const previews = document.querySelector('#previews')
const send = document.querySelector('#send')
const result = document.querySelector('#result')
const statusLabel = document.querySelector('#status-label')
const requestId = document.querySelector('#request-id')
const resultTitle = document.querySelector('#result-title')
const resultText = document.querySelector('#result-text')
const retry = document.querySelector('#retry')
const allowed = new Set(['image/jpeg', 'image/png', 'image/webp'])
const lastRequestKey = 'shiv-task-intake:last'
let files = []
let pollTimer = null

function showFiles(next) {
  files = [...next]
  previews.replaceChildren()
  for (const [index, file] of files.entries()) {
    const tile = document.createElement('div')
    tile.className = 'preview'
    const image = document.createElement('img')
    image.src = URL.createObjectURL(file)
    image.alt = `Page ${index + 1}`
    image.onload = () => URL.revokeObjectURL(image.src)
    const name = document.createElement('span')
    name.textContent = `${index + 1}. ${file.name}`
    tile.append(image, name)
    previews.append(tile)
  }
}

picker.addEventListener('change', () => showFiles(picker.files))
for (const event of ['dragenter', 'dragover']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('dragging') })
for (const event of ['dragleave', 'drop']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('dragging') })
drop.addEventListener('drop', e => showFiles([...e.dataTransfer.files].filter(file => allowed.has(file.type))))

function imageData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function showResult({ id, status, reply }) {
  result.hidden = false
  requestId.textContent = id ? `Request ${id.slice(0, 8)}` : ''
  statusLabel.textContent = status === 'answered' ? 'Completed' : status === 'failed' ? 'Send failed' : 'In this chat'
  resultTitle.textContent = status === 'answered' ? 'Result' : status === 'failed' ? 'Could not send' : 'Sent to the chat'
  resultText.textContent = reply || 'Work is in progress. Keep this page open, or return later on this computer.'
  retry.hidden = status !== 'failed' || !id
  retry.dataset.id = id || ''
  if (status === 'answered' || status === 'failed') { clearInterval(pollTimer); pollTimer = null }
}

retry.addEventListener('click', async () => {
  const id = retry.dataset.id
  if (!id) return
  retry.disabled = true
  retry.textContent = 'Retrying...'
  try {
    const response = await fetch(`/retry/${id}`, { method: 'POST' })
    const data = await response.json()
    if (!response.ok) throw Error(data.reply || data.error || 'Retry failed')
    showResult(data)
    startPolling(id)
  } catch (error) { showResult({ id, status: 'failed', reply: error.message || String(error) }) }
  finally { retry.disabled = false; retry.textContent = 'Retry this request' }
})

async function check(id) {
  const response = await fetch(`/status/${id}`, { cache: 'no-store' })
  if (!response.ok) throw Error('Could not check request status')
  showResult(await response.json())
}

function startPolling(id) {
  clearInterval(pollTimer)
  check(id).catch(() => {})
  pollTimer = setInterval(() => check(id).catch(() => {}), 4000)
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  if (files.length > 12) { alert('Choose at most 12 images.'); return }
  if (!files.length && !document.querySelector('#note').value.trim()) { alert('Add a request or choose an image.'); return }
  if (files.some(file => !allowed.has(file.type) || file.size > 12 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 36 * 1024 * 1024) { alert('Use JPEG, PNG, or WebP images under 12 MB each and 36 MB total.'); return }
  send.disabled = true
  send.textContent = 'Sending images...'
  try {
    const photos = await Promise.all(files.map(async file => ({ type: file.type, data: await imageData(file) })))
    const response = await fetch('/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: document.querySelector('#note').value, photos }) })
    const data = await response.json()
    if (!response.ok && !data.id) throw Error(data.reply || data.error || 'Could not send this request')
    localStorage.setItem(lastRequestKey, data.id)
    showResult(data)
    if (response.ok) startPolling(data.id)
    result.scrollIntoView({ behavior: 'smooth', block: 'center' })
  } catch (error) {
    showResult({ status: 'failed', reply: error.message || String(error) })
  } finally {
    send.disabled = false
    send.innerHTML = 'Send to this chat <span aria-hidden="true">&rarr;</span>'
  }
})

const last = localStorage.getItem(lastRequestKey) || localStorage.getItem('shiv-purchase-intake:last')
if (last) startPolling(last)
else fetch('/latest', { cache: 'no-store' }).then(response => response.json()).then(job => {
  if (!job) return
  localStorage.setItem(lastRequestKey, job.id)
  showResult(job)
  if (job.status === 'sent' || job.status === 'sending') startPolling(job.id)
}).catch(() => {})
