import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { QuotationPrint } from '../features/print/QuotationPrint'
import { enrichQuotation } from '../lib/pricing'
import { photoIsColour } from '../lib/photoColour'
import { LOCAL_PRINT_SERVER_URL } from '../lib/printServer'
import { canLocalPrint } from '../lib/useLocalPrint'
import { deviceId } from '../lib/device'
import type { Quotation } from '../lib/types'

/**
 * Quotations and photos sent from a phone, printed by this app on the shop PC.
 *
 * The phone sends only the quotation's sizes and rates. The print server used
 * to turn them into a PDF and hand that to SumatraPDF, 5-18s before the Epson
 * moved; this app draws the same quotation it draws for the counter and
 * prints it at once, as the Print button here does. Only in the desktop app
 * (the website cannot print silently), and the queue holds a new quotation
 * for it a few seconds (convex/printJobs.ts), so the print server still takes
 * it when this app is shut. Owner's ask, 2 Nov 2026.
 *
 * Photos shared to Shiv Print go the same way (4 Nov 2026): one A4 sheet each,
 * colour on the Epson, black and white on the HP. The print server, beside this
 * app, says which printer can take it and tells the phone it has printed. If it
 * does not answer or the printer is down, the job goes back to it.
 */
export function PhoneQuotePrinter() {
  if (!canLocalPrint()) return null
  return <Relay />
}

const printerId = () => `counter-app:${deviceId()}`

type QuoteJob = { kind: 'quotation'; _id: Id<'printJobs'>; copies: number; quote: Quotation }
type PhotoJob = {
  kind: 'photos'
  _id: Id<'printJobs'>
  copies: number
  mode: 'bw' | 'color' | 'auto'
  notify?: { endpoint: string; keys: { p256dh: string; auth: string } }
  files: { name: string; mediaType: string; url: string | null }[]
}
type Job = QuoteJob | PhotoJob
type Photo = { url: string; landscape: boolean }

/**
 * A picture is ready once it has loaded. Not img.decode(): that waits on the
 * window drawing, and a minimized Counter does not draw, so a photo hung for
 * good (4 Nov 2026).
 */
const loaded = (img: HTMLImageElement) => new Promise<void>((done, fail) => {
  if (img.complete) {
    if (img.naturalWidth) done()
    else fail(new Error('The photo did not load'))
    return
  }
  img.addEventListener('load', () => done(), { once: true })
  img.addEventListener('error', () => fail(new Error('The photo did not load')), { once: true })
})

/** A step that never finishes must not hold the job, or every job after it. */
const withinTime = <T,>(work: Promise<T>, ms: number) => Promise.race([
  work,
  new Promise<never>((_, fail) => window.setTimeout(() => fail(new Error('Took too long')), ms)),
])

/** Fetches a job's photos into `urls`, reads their colour, and asks which printer takes them. */
async function loadPhotos(job: PhotoJob, urls: string[]) {
  const images = await Promise.all(job.files.map(async (file) => {
    const res = await fetch(file.url ?? '')
    if (!res.ok) throw new Error(`${file.name} could not be fetched (${res.status})`)
    const url = URL.createObjectURL(await res.blob())
    urls.push(url)
    const img = new Image()
    img.src = url
    await loaded(img)
    return { url, img }
  }))
  const mode = job.mode !== 'auto' ? job.mode : images.some(({ img }) => photoIsColour(img)) ? 'color' : 'bw'
  const res = await fetch(`${LOCAL_PRINT_SERVER_URL}/printer-ready?mode=${mode}`, { signal: AbortSignal.timeout(8000) })
  const ready = await res.json() as { ok: boolean; printer: string; reason?: string }
  if (!ready.ok) throw new Error(ready.reason || `${ready.printer} cannot print now`)
  return {
    mode,
    printer: ready.printer,
    photos: images.map<Photo>(({ url, img }) => ({ url, landscape: img.naturalWidth > img.naturalHeight })),
  }
}

/**
 * The printer quotations go to on the Printers screen (its fallback when that
 * one is offline). Without it the app printed on Windows' default printer, the
 * HP, whatever the screen said (27 Nov 2026). Undefined: the default, as before.
 */
async function quotationPrinter(): Promise<string | undefined> {
  try {
    const res = await fetch(`${LOCAL_PRINT_SERVER_URL}/printers/status`, { signal: AbortSignal.timeout(5000) })
    const status = await res.json() as {
      printers?: { name: string; online: boolean }[]
      routes?: { quotation?: { printer?: string | null; fallback?: string | null } }
    }
    const route = status.routes?.quotation
    const online = (name?: string | null) => Boolean(name && status.printers?.some((p) => p.name === name && p.online))
    if (online(route?.printer)) return route!.printer!
    if (online(route?.fallback)) return route!.fallback!
    return route?.printer ?? undefined
  } catch {
    return undefined
  }
}

function Relay() {
  const pending = useQuery(api.printJobs.listPending, { limit: 20 })
  const here = useMutation(api.printJobs.counterAppHere)
  const claim = useMutation(api.printJobs.claimForApp)
  const complete = useMutation(api.printJobs.complete)
  const release = useMutation(api.printJobs.releaseToServer)
  const [job, setJob] = useState<Job | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const busy = useRef(false)
  const root = useRef<HTMLDivElement>(null)

  // Check in, so the queue keeps holding new jobs for this app.
  useEffect(() => {
    const ping = () => { void here({ printerId: printerId() }).catch(() => undefined) }
    ping()
    const t = window.setInterval(ping, 30_000)
    return () => window.clearInterval(t)
  }, [here])

  // By id, so a new job wakes this up even beside a PDF left for the print server.
  const waiting = (pending ?? [])
    .filter((j) => (j.kind === 'quotation' || j.kind === 'raw-file') && !j.assignedPrinterId && !j.leftForServer)
    .map((j) => j._id)
    .join()
  // One at a time: the next is taken when this one is done (job back to null).
  useEffect(() => {
    if (!waiting || job || busy.current) return
    busy.current = true
    void claim({ printerId: printerId() })
      .then((next) => {
        if (next) setJob(next as Job)
        else busy.current = false
      })
      .catch(() => { busy.current = false })
  }, [waiting, job, claim])

  // Print once the job has laid out, then say so; a failure goes back to the
  // print server rather than being lost.
  useEffect(() => {
    if (!job) return
    const id = printerId()
    const urls: string[] = []
    let current = true
    document.body.classList.add('printing-phone-quote')
    void (async () => {
      try {
        const sheet = job.kind === 'photos' ? await withinTime(loadPhotos(job, urls), 30_000) : null
        const deviceName = sheet ? sheet.printer : await quotationPrinter()
        if (!current) return
        if (sheet) setPhotos(sheet.photos)
        await new Promise((done) => window.setTimeout(done, 150))
        if (!current) return
        if (sheet) await withinTime(Promise.all([...(root.current?.querySelectorAll('img') ?? [])].map(loaded)), 10_000)
        await withinTime(window.shivDesktop!.printCurrentPage({
          copies: Math.max(1, job.copies || 1),
          ...(deviceName ? { deviceName } : {}),
        }), 60_000)
        await complete({ id: job._id, printerId: id }).catch(() => undefined)
        if (sheet && job.kind === 'photos' && job.notify) {
          void fetch(`${LOCAL_PRINT_SERVER_URL}/tell-phone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: job._id, notify: job.notify, files: job.files.map(({ name }) => ({ name })), mode: sheet.mode, printer: sheet.printer }),
          }).catch(() => undefined)
        }
      } catch {
        await release({ id: job._id, printerId: id }).catch(() => undefined)
      } finally {
        urls.forEach((url) => URL.revokeObjectURL(url))
        if (current) {
          document.body.classList.remove('printing-phone-quote')
          setPhotos([])
          busy.current = false
          setJob(null)
        }
      }
    })()
    return () => { current = false }
  }, [job, complete, release])

  if (!job) return null
  return (
    <div ref={root} className="print-root print-offscreen phone-quote-root" aria-hidden="true">
      {job.kind === 'quotation'
        ? <QuotationPrint quote={enrichQuotation(job.quote)} />
        : photos.map((photo) => (
          <div key={photo.url} className="phone-photo-page">
            <img src={photo.url} className={photo.landscape ? 'is-landscape' : undefined} alt="" />
          </div>
        ))}
    </div>
  )
}
