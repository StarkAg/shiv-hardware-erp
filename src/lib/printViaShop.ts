import { createCloudPrintJob, getCloudPrintJob } from './cloudApi'
import { printCardBacksOnServer, printOnServer, type ServerPrintPayload } from './printServer'

/**
 * Printing on the shop PC from wherever the phone is.
 *
 * On the shop Wi-Fi, from a page that can reach it, the print server is
 * asked directly — the fastest way. Anywhere else (or from the website, which
 * may not call the shop's plain-http address) the job goes into the online
 * queue, and the print server on the shop PC takes it from there within a few
 * seconds. Either way the caller is told how it went; for a queued job,
 * `onDone` later says whether it actually printed.
 */

export type PrintOutcome =
  | { via: 'shop'; printer: string }
  | { via: 'queue'; jobId: string }

export async function printViaShop(
  payload: Exclude<ServerPrintPayload, { kind: 'bill' }>,
  { copies = 1, onDone }: { copies?: number; onDone?: (result: { ok: true } | { ok: false; error: string }) => void } = {},
): Promise<PrintOutcome> {
  try {
    const result = await printOnServer(payload, copies)
    return { via: 'shop', printer: result.printer }
  } catch {
    // Not reachable from here — go through the online queue.
  }

  const { id } = payload.kind === 'quotation'
    ? await createCloudPrintJob({ kind: 'quotation', quote: payload.quote, copies, source: 'web' })
    : await createCloudPrintJob({
        kind: 'guarantee', document: payload.document, layout: payload.layout, copies, source: 'web',
        ...(payload.slot ? { slot: payload.slot } : {}),
        ...(payload.documents?.length ? { documents: payload.documents } : {}),
      })
  if (onDone) void follow(id, onDone)
  return { via: 'queue', jobId: id }
}

/** Card backs (design file names, slot 1 and 2) the same way: the shop PC directly, else the online queue. */
export async function printCardBacksViaShop(
  files: (string | null)[],
  { onDone }: { onDone?: (result: { ok: true } | { ok: false; error: string }) => void } = {},
): Promise<PrintOutcome> {
  try {
    const result = await printCardBacksOnServer(files)
    return { via: 'shop', printer: result.printer }
  } catch (err) {
    // The shop PC answered and refused it: queueing it would fail the same way.
    if (!/Cannot reach|Cannot find/.test(err instanceof Error ? err.message : '')) throw err
  }
  const { id } = await createCloudPrintJob({ kind: 'card-backs', files, source: 'web' })
  if (onDone) void follow(id, onDone)
  return { via: 'queue', jobId: id }
}

/** Watches a queued job until the shop PC prints it, gives up on it, or two minutes pass. */
async function follow(id: string, onDone: NonNullable<Parameters<typeof printViaShop>[1]>['onDone']) {
  const until = Date.now() + 120_000
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2500))
    try {
      const { job } = await getCloudPrintJob(id)
      if (job.status === 'printed') return onDone?.({ ok: true })
      if (job.status === 'failed' || job.status === 'cancelled') {
        return onDone?.({ ok: false, error: job.error || 'The shop PC could not print it' })
      }
    } catch {
      // A dropped connection on the phone is not the job failing; keep watching.
    }
  }
  onDone?.({ ok: false, error: 'The shop PC has not picked it up yet — is it on and online?' })
}
