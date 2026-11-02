import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { QuotationPrint } from '../features/print/QuotationPrint'
import { enrichQuotation } from '../lib/pricing'
import { canLocalPrint } from '../lib/useLocalPrint'
import { deviceId } from '../lib/device'
import type { Quotation } from '../lib/types'

/**
 * Quotations sent from a phone, printed by this app on the shop PC.
 *
 * The phone sends only the quotation's sizes and rates. The print server used
 * to turn them into a PDF and hand that to SumatraPDF, 5-18s before the Epson
 * moved; this app draws the same quotation it draws for the counter and
 * prints it at once, as the Print button here does. Only in the desktop app
 * (the website cannot print silently), and the queue holds a new quotation
 * for it a few seconds (convex/printJobs.ts), so the print server still takes
 * it when this app is shut. Owner's ask, 2 Nov 2026.
 */
export function PhoneQuotePrinter() {
  if (!canLocalPrint()) return null
  return <Relay />
}

const printerId = () => `counter-app:${deviceId()}`

type Job = { _id: Id<'printJobs'>; copies: number; quote: Quotation }

function Relay() {
  const pending = useQuery(api.printJobs.listPending, { limit: 20 })
  const here = useMutation(api.printJobs.counterAppHere)
  const claim = useMutation(api.printJobs.claimQuotationForApp)
  const complete = useMutation(api.printJobs.complete)
  const release = useMutation(api.printJobs.releaseToServer)
  const [job, setJob] = useState<Job | null>(null)
  const busy = useRef(false)

  // Check in, so the queue keeps holding new quotations for this app.
  useEffect(() => {
    const ping = () => { void here({ printerId: printerId() }).catch(() => undefined) }
    ping()
    const t = window.setInterval(ping, 30_000)
    return () => window.clearInterval(t)
  }, [here])

  const waiting = (pending ?? []).some((j) => j.kind === 'quotation' && !j.assignedPrinterId)
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

  // Print once the quotation has laid out, then say so; a failure goes back
  // to the print server rather than being lost.
  useEffect(() => {
    if (!job) return
    const id = printerId()
    document.body.classList.add('printing-phone-quote')
    const t = window.setTimeout(async () => {
      try {
        await window.shivDesktop!.printCurrentPage({ copies: Math.max(1, job.copies || 1) })
        await complete({ id: job._id, printerId: id }).catch(() => undefined)
      } catch {
        await release({ id: job._id, printerId: id }).catch(() => undefined)
      } finally {
        document.body.classList.remove('printing-phone-quote')
        busy.current = false
        setJob(null)
      }
    }, 150)
    return () => window.clearTimeout(t)
  }, [job, complete, release])

  if (!job) return null
  return (
    <div className="print-root print-offscreen phone-quote-root" aria-hidden="true">
      <QuotationPrint quote={enrichQuotation(job.quote)} />
    </div>
  )
}
