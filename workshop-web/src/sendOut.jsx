import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useConvex, useQuery } from 'convex/react'
import { toJpeg } from 'html-to-image'
import { api, said } from './flow.js'
import { SendIcon, SheetIcon, TickIcon } from './ui.jsx'

/**
 * Whatever picture is opened, two ways out (Tony, 21 Nov 2026):
 *
 *   Send to group  into the shop's WhatsApp group, from the Shop number
 *                  (convex/shopWhatsApp.ts sendDocument, `mobile: 'group'`)
 *   Print          straight to the shop printer, no print box: the shop's
 *                  print queue (convex/printJobs.ts sendFiles), printed by
 *                  the Counter app on the shop PC, else the print server
 */

/** A picture as a JPEG no wider than a print needs: WhatsApp and the printer both take it as a photo. */
export async function asJpeg(blob, longest = 2400) {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height))
  if (blob.type === 'image/jpeg' && scale === 1) { bitmap.close?.(); return blob }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return new Promise((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error('Could not make the picture.'))), 'image/jpeg', 0.9))
}

/** A photo by its address, as a JPEG. */
export const photoBlob = async (url) => asJpeg(await (await fetch(url)).blob())

/**
 * A sheet drawn by the app (the visit slip, a work order copy) as a picture:
 * laid out off screen at full size, then photographed once its lettering and
 * logo have loaded. Not img.decode(): it never settles in a minimised window.
 */
export async function sheetBlob(element, selector) {
  const host = document.createElement('div')
  host.className = 'padprint'
  host.setAttribute('aria-hidden', 'true')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    flushSync(() => root.render(element))
    await document.fonts?.ready
    const imgs = [...host.querySelectorAll('img')]
    await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r }))))
    const node = host.querySelector(selector)
    if (!node) throw new Error('Could not make the picture.')
    // 2.5 times screen size: about 240 dots an inch on A4, sharp on the HP and in WhatsApp.
    const url = await toJpeg(node, { pixelRatio: 2.5, quality: 0.92, backgroundColor: '#fff' })
    return await (await fetch(url)).blob()
  } finally {
    root.unmount()
    host.remove()
  }
}

const tidy = (name) => name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Work order'

export async function toBase64(blob) {
  return new Promise((done, fail) => {
    const reader = new FileReader()
    reader.onload = () => done(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => fail(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Pictures into the shop's print queue as one job, a page each, in order;
 * returns the job's id. `mode` 'color' sends it to the Epson, 'bw' to the HP,
 * 'auto' lets the shop PC look.
 */
export async function printOnQueue(convex, blobs, name, mode = 'auto') {
  const files = []
  for (let i = 0; i < blobs.length; i += 1) {
    const url = await convex.mutation(api.files.generateUploadUrl, {})
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blobs[i] })
    if (!res.ok) throw new Error('A page did not upload. Try again.')
    const { storageId } = await res.json()
    files.push({ storageId, name: `${tidy(name)}${blobs.length > 1 ? ` ${i + 1}` : ''}.jpg`, mediaType: 'image/jpeg' })
  }
  return convex.mutation(api.printJobs.sendFiles, { files, mode, copies: 1 })
}

/**
 * A Print key that sends what `makeBlobs` draws straight to the printer and
 * follows it to Printed: no print box.
 */
export function QueuePrint({ label, makeBlobs, name, mode = 'auto', className = 'key ghost', disabled = false }) {
  const convex = useConvex()
  const [state, setState] = useState(null) // null | 'making' | { id } | { error }
  const job = useQuery(api.printJobs.getById, state?.id ? { id: state.id } : 'skip')
  const go = async () => {
    setState('making')
    try {
      setState({ id: await printOnQueue(convex, await makeBlobs(), name, mode) })
    } catch (err) {
      setState({ error: said(err) })
    }
  }
  const printed = job?.status === 'printed'
  const failed = state?.error || job?.status === 'failed'
  const busy = state === 'making' || (state?.id && !printed && !failed)
  const words = state === 'making' ? 'Sending' : busy ? (job?.status === 'printing' || job?.status === 'claimed' ? 'Printing' : 'In the queue') : printed ? 'Printed' : failed ? 'Print again' : label
  return (
    <>
      <button type="button" className={className} disabled={disabled || busy} onClick={go}>
        {printed ? <TickIcon size={22} /> : <SheetIcon size={22} />} {words}
        {busy && <span className="spin tiny" />}
      </button>
      {failed && <p className="sendproblem" role="alert">{state?.error || job?.error || 'The printer could not print it.'}</p>}
    </>
  )
}

/**
 * The two keys, for the picture `getBlob` makes. `mode` is how it prints:
 * 'bw' for a sheet the app drew, 'auto' for a photo (the shop PC reads
 * whether it has colour).
 */
export function SendOut({ getBlob, name, caption = '', mode = 'auto', className = '' }) {
  const convex = useConvex()
  const [group, setGroup] = useState(null) // null | 'sending' | 'sent' | { error }
  const [print, setPrint] = useState(null) // null | 'making' | { id } | { error }
  const job = useQuery(api.printJobs.getById, print?.id ? { id: print.id } : 'skip')
  const file = `${tidy(name)}.jpg`

  const toGroup = async () => {
    setGroup('sending')
    try {
      const data = await toBase64(await getBlob())
      await convex.action(api.shopWhatsApp.sendDocument, { mobile: 'group', fileName: file, mimetype: 'image/jpeg', data, ...(caption ? { caption } : {}) })
      setGroup('sent')
    } catch (err) {
      setGroup({ error: said(err) })
    }
  }

  const toPrinter = async () => {
    setPrint('making')
    try {
      setPrint({ id: await printOnQueue(convex, [await getBlob()], name, mode) })
    } catch (err) {
      setPrint({ error: said(err) })
    }
  }

  const printed = job?.status === 'printed'
  const printFailed = print?.error || job?.status === 'failed'
  const printing = print === 'making' || (print?.id && !printed && !printFailed)
  const printWords = print === 'making' ? 'Sending' : printing ? (job?.status === 'printing' || job?.status === 'claimed' ? 'Printing' : 'In the queue') : printed ? 'Printed' : printFailed ? 'Print again' : 'Print'
  const groupWords = group === 'sending' ? 'Sending' : group === 'sent' ? 'Sent to group' : group?.error ? 'Send again' : 'Send to group'
  const problem = group?.error || print?.error || (job?.status === 'failed' ? job.error || 'The printer could not print it.' : '')

  return (
    <div className={`sendout ${className}`}>
      <div className="sendkeys">
        <button type="button" className={group === 'sent' ? 'done' : ''} disabled={group === 'sending'} onClick={toGroup}>
          {group === 'sent' ? <TickIcon size={22} /> : <SendIcon size={22} />} {groupWords}
          {group === 'sending' && <span className="spin tiny" />}
        </button>
        <button type="button" className={printed ? 'done' : ''} disabled={printing} onClick={toPrinter}>
          {printed ? <TickIcon size={22} /> : <SheetIcon size={22} />} {printWords}
          {printing && <span className="spin tiny" />}
        </button>
      </div>
      {problem && <p className="sendproblem" role="alert">{problem}</p>}
    </div>
  )
}
