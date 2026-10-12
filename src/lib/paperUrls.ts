/**
 * Where each bill photo can be fetched from, as already told by some screen.
 *
 * A ledger's rows arrive with every photo's address (reports.ledger). The bill
 * opened from one of those rows used to ask the books for the same addresses
 * again (files.describe) before it could show its photo: a round trip for
 * nothing. Screens that learn addresses write them here, and one that needs
 * them reads them from here first.
 *
 * Opening a ledger also starts its newest bill photos downloading in the
 * background (`warm`), so the photo is on this PC by the time it is opened.
 */
export type Paper = { storageId: string; url: string | null; contentType?: string | null; [k: string]: unknown }

const known = new Map<string, Paper>()
const warmed = new Set<string>()

export function rememberPapers(papers: Paper[] | undefined | null) {
  for (const p of papers ?? []) if (p?.storageId && p.url) known.set(String(p.storageId), p)
}

/** Every one of these, if all are known; otherwise null (ask the books). */
export function knownPapers(storageIds: string[]): Paper[] | null {
  const out = storageIds.map((id) => known.get(String(id)))
  return out.length && out.every(Boolean) ? (out as Paper[]) : null
}

const idle = (run: () => void) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 1500 })
  else setTimeout(run, 200)
}

/**
 * Starts photos downloading, a few at a time and only while the PC is idle,
 * so the browser holds them when they are opened. PDFs are left alone.
 */
export function warm(papers: Paper[], limit = 40) {
  const queue = papers
    .filter((p) => p.url && !/pdf/i.test(String(p.contentType ?? '')) && !warmed.has(p.url))
    .slice(0, limit)
  for (const p of queue) warmed.add(p.url!)
  let running = 0
  const next = () => {
    while (running < 3 && queue.length) {
      const p = queue.shift()!
      running += 1
      const img = new Image() as HTMLImageElement & { fetchPriority?: string }
      img.decoding = 'async'
      img.fetchPriority = 'low'
      img.onload = img.onerror = () => { running -= 1; idle(next) }
      img.src = p.url!
    }
  }
  idle(next)
}
