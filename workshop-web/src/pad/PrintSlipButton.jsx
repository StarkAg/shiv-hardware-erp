import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useConvex, useQuery } from 'convex/react'
import { toJpeg } from 'html-to-image'
import { api, said } from '../flow.js'
import { SheetIcon } from '../ui.jsx'
import { SlipSheet } from './VisitSlip.jsx'

/**
 * Print, with no print box: the slip is drawn as a picture of the A4 page and
 * put in the shop's print queue (convex/printJobs.ts sendFiles), the way Shiv
 * Print sends a photo. The shop PC prints it on the HP in black and white: the
 * Counter app while it is open, else the print server (Tony, 21 Nov 2026).
 */

// 210mm at 96 a inch is 794px; two and a half times that is about 240 dots an inch, sharp on the HP.
const SHARPNESS = 2.5

/** The slip laid out off screen at full size, turned into a JPEG once its lettering and logo have loaded. */
function SlipPicture({ number, who, slip, onPicture }) {
  const box = useRef(null)
  const done = useRef(onPicture)
  done.current = onPicture
  useEffect(() => {
    let gone = false
    void (async () => {
      try {
        await document.fonts?.ready
        // Not img.decode(): it never settles in a window that is minimised.
        const imgs = [...(box.current?.querySelectorAll('img') ?? [])]
        await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r }))))
        const node = box.current?.querySelector('.slip')
        if (!node || gone) return
        const url = await toJpeg(node, { pixelRatio: SHARPNESS, quality: 0.92, backgroundColor: '#fff' })
        const blob = await (await fetch(url)).blob()
        if (!gone) done.current({ blob })
      } catch (err) {
        if (!gone) done.current({ error: err })
      }
    })()
    return () => { gone = true }
  }, [])
  return createPortal(
    <div ref={box} className="padprint" aria-hidden="true"><SlipSheet number={number} who={who} slip={slip} fixedZoom={1} /></div>,
    document.body,
  )
}

const WORDS = { making: 'Sending to the printer', pending: 'In the print queue', printing: 'Printing', printed: 'Printed', failed: 'Not printed' }

export function PrintSlipButton({ number, who, slip, disabled = false, className = 'key ghost' }) {
  const convex = useConvex()
  const [state, setState] = useState(null) // null | 'making' | { id } | { error }
  const job = useQuery(api.printJobs.getById, state?.id ? { id: state.id } : 'skip')

  const send = async ({ blob, error }) => {
    try {
      if (error) throw error
      const url = await convex.mutation(api.files.generateUploadUrl, {})
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
      if (!res.ok) throw new Error('The slip did not upload. Try again.')
      const { storageId } = await res.json()
      const name = `Visit order${number ? ` ${number}` : ''}.jpg`
      const id = await convex.mutation(api.printJobs.sendFiles, { files: [{ storageId, name, mediaType: 'image/jpeg' }], mode: 'bw', copies: 1 })
      setState({ id })
    } catch (err) {
      setState({ error: said(err) })
    }
  }

  const status = state === 'making' ? 'making' : state?.error ? 'failed' : state?.id ? (job?.status === 'failed' ? 'failed' : job?.status === 'printed' ? 'printed' : job?.status === 'printing' || job?.status === 'claimed' ? 'printing' : 'pending') : null
  const busy = status === 'making' || status === 'pending' || status === 'printing'
  const problem = state?.error || (job?.status === 'failed' ? job.error || 'The printer could not print it.' : '')

  return (
    <>
      <button type="button" className={className} disabled={disabled || busy} onClick={() => setState('making')}>
        <SheetIcon /> {status && status !== 'failed' ? WORDS[status] : status === 'failed' ? 'Print again' : 'Print'}
        {busy && <span className="spin tiny" />}
      </button>
      {problem && <p className="error" role="alert">{problem}</p>}
      {state === 'making' && <SlipPicture number={number} who={who} slip={slip} onPicture={send} />}
    </>
  )
}
