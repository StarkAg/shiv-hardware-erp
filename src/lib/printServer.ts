import type { Bill, BrandSet, CustomCatalogEntry, GuaranteeDocument, HardwareCatalog, Quotation } from './types'
import { fetchPrinterAgentLanUrls } from './cloudApi'

const PRINT_SERVER_PORT = import.meta.env.VITE_PRINT_SERVER_PORT || '3333'
const configuredPrintServer = (import.meta.env.VITE_PRINT_SERVER || '').trim().replace(/\/+$/, '')
const PRINT_SERVER_STORAGE_KEY = 'shiv-panel:print-server-url'
const DISCOVERY_PREFIXES = ['192.168.29', '192.168.1', '192.168.0', '10.0.0']
const DISCOVERY_TIMEOUT_MS = 700           // per-host probe during a subnet scan
const KNOWN_HOST_TIMEOUT_MS = 2500         // high-confidence hosts: tolerate a sleeping Wi-Fi radio before falling back
const CLOUD_DISCOVERY_TIMEOUT_MS = 1500    // never let a slow/unreachable cloud stall discovery

// Resolved server URL cached for the session so repeat calls skip re-discovery.
// Invalidated by fetchPrintServer() when a request to it actually fails.
let cachedServerUrl: string | null = null

// Hosts where "same host, port 3333" is a sensible print-server guess: the panel
// and print server are co-located (shop LAN, or a Tailscale address/MagicDNS).
// A public host like *.vercel.app is NOT — there the print server lives elsewhere,
// so we must use a configured/saved URL (or cloud) instead of <that-host>:3333.
function isDirectReachableHost(hostname: string): boolean {
  return (
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname) || // RFC1918 LAN
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname) ||     // Tailscale CGNAT 100.64/10
    hostname.endsWith('.ts.net')                                      // Tailscale MagicDNS
  )
}

function detectPrintServerUrl() {
  if (configuredPrintServer) return configuredPrintServer
  if (typeof window === 'undefined') return `http://localhost:${PRINT_SERVER_PORT}`

  // A manually-saved URL (e.g. the Tailscale HTTPS address) is authoritative.
  const saved = readSavedPrintServerUrl()
  if (saved) return saved

  const { protocol, hostname } = window.location
  const isHttp = protocol === 'http:' || protocol === 'https:'
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1'
  // Only guess <page-host>:3333 when the panel is served from a LAN/Tailscale host.
  if (isHttp && hostname && !isLocalhost && isDirectReachableHost(hostname)) {
    return `${protocol}//${hostname}:${PRINT_SERVER_PORT}`
  }

  return `http://localhost:${PRINT_SERVER_PORT}`
}

export const PRINT_SERVER_URL = detectPrintServerUrl()

export type ServerPrintPayload =
  | { kind: 'quotation'; quote: Quotation }
  | {
      kind: 'guarantee'
      document: GuaranteeDocument
      layout?: 'a4' | 'card'
      /** Card layout only: which Epson tray slot to print in (default 1). */
      slot?: 1 | 2
      /** Card layout only: two documents = both tray slots in one pass. */
      documents?: GuaranteeDocument[]
    }
  | { kind: 'bill'; bill: Bill }

export type ServerPrintResult = {
  ok: true
  printer: string
  jobId: string | null
}

export type ServerRenderPngResult = {
  ok: true
  image: string
  mime: 'image/png'
}

function readSavedPrintServerUrl() {
  try {
    return localStorage.getItem(PRINT_SERVER_STORAGE_KEY)?.replace(/\/+$/, '') || null
  } catch {
    return null
  }
}

export function savePrintServerUrl(url: string) {
  try {
    localStorage.setItem(PRINT_SERVER_STORAGE_KEY, url.replace(/\/+$/, ''))
  } catch {
    /* ignore storage errors */
  }
}

export function getSavedPrintServerUrl() {
  return readSavedPrintServerUrl()
}

function candidatePrintServerUrls() {
  const urls = new Set<string>()
  if (configuredPrintServer) urls.add(configuredPrintServer)

  const saved = readSavedPrintServerUrl()
  if (saved) urls.add(saved)

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location
    const isHttp = protocol === 'http:' || protocol === 'https:'
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1'
    // Only a LAN/Tailscale page-host is a real print-server candidate (not vercel.app).
    if (isHttp && hostname && !isLocalhost && isDirectReachableHost(hostname)) {
      urls.add(`${protocol}//${hostname}:${PRINT_SERVER_PORT}`)
    }
  }

  urls.add(`http://localhost:${PRINT_SERVER_PORT}`)
  return [...urls]
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = DISCOVERY_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timeout)
  }
}

/** True if `url` answers /status with the Shiv Print Server signature within `timeoutMs`. */
async function probeServer(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`${url}/status`, {}, timeoutMs)
    const json = await response.json().catch(() => null)
    return response.ok && json?.server === 'Shiv Print Server'
  } catch {
    return false
  }
}

/** Resolve with the first promise that yields a truthy value, or null once all settle. */
function firstTruthy<T>(promises: Promise<T | null>[]): Promise<T | null> {
  return new Promise((resolve) => {
    let pending = promises.length
    if (!pending) return resolve(null)
    for (const p of promises) {
      p.then((value) => {
        if (value) resolve(value)
        else if (--pending === 0) resolve(null)
      }).catch(() => {
        if (--pending === 0) resolve(null)
      })
    }
  })
}

/**
 * Ask the cloud for the print server's last-reported LAN URL(s) and probe them.
 * One exact address per interface — far faster and subnet-agnostic compared to
 * the brute-force scan. Returns null if the cloud has no record or none respond.
 */
async function discoverViaCloud() {
  // Bound the cloud lookup: a sleeping/cold/unreachable cloud must not stall discovery.
  const lanUrls = await Promise.race([
    fetchPrinterAgentLanUrls(),
    new Promise<string[]>((resolve) => window.setTimeout(() => resolve([]), CLOUD_DISCOVERY_TIMEOUT_MS)),
  ])
  for (const raw of lanUrls) {
    const url = raw.replace(/\/+$/, '')
    if (await probeServer(url, DISCOVERY_TIMEOUT_MS)) {
      savePrintServerUrl(url)
      return url
    }
  }
  return null
}

async function discoverPrintServer() {
  const candidates = DISCOVERY_PREFIXES.flatMap((prefix) =>
    Array.from({ length: 254 }, (_, index) => `http://${prefix}.${index + 1}:${PRINT_SERVER_PORT}`),
  )
  const batchSize = 32

  for (let start = 0; start < candidates.length; start += batchSize) {
    const batch = candidates.slice(start, start + batchSize)
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        if (await probeServer(url, DISCOVERY_TIMEOUT_MS)) return url
        throw new Error('not shiv print server')
      }),
    )
    const found = results.find((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')?.value

    if (found) {
      savePrintServerUrl(found)
      return found
    }
  }

  return null
}

/**
 * One search at a time, and not again straight away when it fails.
 *
 * Four things ask for the print server the moment the panel opens — bills,
 * catalogue, guarantees, and the sync check. Each used to run its own search,
 * so with the server switched off the browser made four rounds of failed
 * requests and then four brute-force subnet scans, a thousand refused
 * connections deep. The shop saw a console full of red and a slow start.
 *
 * So: concurrent callers share one search, and a search that found nothing is
 * remembered briefly, because a print server that was off a second ago is
 * almost certainly still off.
 */
let inFlight: Promise<string | null> | null = null
let searchedAt = 0
const RETRY_AFTER_MS = 30_000

async function search(scan: boolean) {
  // 1. High-confidence hosts (configured + last-saved + page host) get a generous
  //    timeout so a sleeping Wi-Fi radio's first slow response doesn't drop us to a scan.
  for (const url of candidatePrintServerUrls()) {
    if (await probeServer(url, KNOWN_HOST_TIMEOUT_MS)) {
      savePrintServerUrl(url)
      cachedServerUrl = url
      return url
    }
  }

  // 2. Cloud-assisted exact-IP lookup and brute-force subnet scan run together; take
  //    whichever finds the server first. The cloud is bounded so it can never stall.
  //    A thousand-address scan is only worth it when someone is waiting on a
  //    print — never for a background refresh nobody asked for.
  const discovered = scan
    ? await firstTruthy([discoverViaCloud(), discoverPrintServer()])
    : await discoverViaCloud()
  if (discovered) cachedServerUrl = discovered
  return discovered
}

/**
 * The print server's address, or null.
 *
 * `background` marks a caller that nobody is waiting on: it skips the subnet
 * scan and honours the retry window, so a refresh cannot turn into a scan.
 */
export async function getPrintServerUrl({ background = false } = {}) {
  if (cachedServerUrl) return cachedServerUrl
  if (inFlight) return inFlight
  if (background && Date.now() - searchedAt < RETRY_AFTER_MS) return null

  inFlight = search(!background).finally(() => {
    inFlight = null
    searchedAt = Date.now()
  })
  return inFlight
}

export async function fetchPrintServer(
  path: string,
  init?: RequestInit,
  timeoutMs = 60_000,
  { background = false } = {},
) {
  const url = await getPrintServerUrl({ background })
  if (!url) {
    throw new Error('Cannot find Shiv Print Server. Start it on the shop computer and use the same Wi-Fi.')
  }

  try {
    return await fetchWithTimeout(`${url}${path}`, init, timeoutMs)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err

    // The resolved server stopped responding — drop the cached URL and re-discover.
    cachedServerUrl = null
    const discovered = await discoverPrintServer()
    if (discovered && discovered !== url) return await fetchWithTimeout(`${discovered}${path}`, init, timeoutMs)
    throw err
  }
}

const SAVED_PRINTER_KEY = 'shiv-panel:print-printer'

export function getSavedPrinter(): string | null {
  try { return localStorage.getItem(SAVED_PRINTER_KEY) || null } catch { return null }
}

export function savePrinter(name: string) {
  try { localStorage.setItem(SAVED_PRINTER_KEY, name) } catch { /* ignore */ }
}

export async function fetchPrinters(): Promise<{ printers: string[]; default: string }> {
  const res = await fetchPrintServer('/printers', undefined, 8000)
  const json = await res.json()
  if (!json?.ok) throw new Error('Could not list printers')
  return json
}

export async function printBillOnServer(bill: Bill, copies = 1, printer?: string): Promise<ServerPrintResult> {
  return printOnServer({ kind: 'bill', bill }, copies, printer)
}

// ── Live printer queue ─────────────────────────────────────────────────────────

export type PrintQueueJob = {
  id: string
  number: number
  printer: string
  user?: string
  sizeKb?: number
  status?: string
  when?: string
}

export type PrintQueuePrinter = {
  name: string
  state: string
  alert: string | null
  jobs: PrintQueueJob[]
}

export type PrintQueueSnapshot = {
  ok: true
  platform: string
  printers: PrintQueuePrinter[]
  jobs: PrintQueueJob[]
}

/** Read the shop printer queue (active jobs + per-printer state/alerts). */
export async function fetchPrintQueue(): Promise<PrintQueueSnapshot> {
  const res = await fetchPrintServer('/queue', undefined, 8000)
  const json = await res.json().catch(() => null)
  if (!json?.ok) throw new Error(json?.error ?? 'Could not read the printer queue')
  return json as PrintQueueSnapshot
}

/** Cancel one queued job. Pass jobId (macOS/Linux) or printer+number (Windows). */
export async function cancelPrintJob(job: { jobId?: string; printer?: string; number?: number }): Promise<void> {
  const res = await fetchPrintServer('/queue/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(job),
  }, 8000)
  const json = await res.json().catch(() => null)
  if (!json?.ok) throw new Error(json?.error ?? 'Could not cancel the job')
}

// ── Catalog sync ─────────────────────────────────────────────────────────────

export interface CatalogSnapshot {
  hardwareCatalog: HardwareCatalog
  customCatalog: CustomCatalogEntry[]
  sets: BrandSet[]
}

/** Push the full catalog snapshot to the print server. Fire-and-forget. */
export async function pushCatalogToServer(snapshot: CatalogSnapshot): Promise<void> {
  try {
    await fetchPrintServer('/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    }, 5000)
  } catch {
    // Server offline — silently ignore
  }
}

/** Pull the catalog snapshot from the print server. Returns null if unreachable or no data. */
export async function pullCatalogFromServer(): Promise<CatalogSnapshot | null> {
  try {
    const res = await fetchPrintServer('/catalog', undefined, 5000, { background: true })
    const json = await res.json().catch(() => null)
    if (!json?.ok || !json.catalog) return null
    return json.catalog as CatalogSnapshot
  } catch {
    return null
  }
}

// ── Bills snapshot sync ───────────────────────────────────────────────────────

/** Push the full bills array to the print server. Fire-and-forget. */
export async function pushBillsToServer(bills: Bill[]): Promise<void> {
  try {
    await fetchPrintServer('/bills-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bills }),
    }, 5000)
  } catch {
    // Server offline — silently ignore
  }
}

/** Pull bills snapshot from the print server. Returns null if unreachable or empty. */
export async function pullBillsFromServer(): Promise<Bill[] | null> {
  try {
    const res = await fetchPrintServer('/bills-store', undefined, 5000, { background: true })
    const json = await res.json().catch(() => null)
    if (!json?.ok || !Array.isArray(json.bills) || json.bills.length === 0) return null
    return json.bills as Bill[]
  } catch {
    return null
  }
}

// ── Guarantee snapshot sync ───────────────────────────────────────────────────

/** Push the full guarantees array to the print server. Fire-and-forget. */
export async function pushGuaranteesToServer(guarantees: GuaranteeDocument[]): Promise<void> {
  try {
    await fetchPrintServer('/guarantees-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guarantees }),
    }, 5000)
  } catch {
    // Server offline — silently ignore
  }
}

/** Pull guarantees snapshot from the print server. Returns null if unreachable or empty. */
export async function pullGuaranteesFromServer(): Promise<GuaranteeDocument[] | null> {
  try {
    const res = await fetchPrintServer('/guarantees-store', undefined, 5000, { background: true })
    const json = await res.json().catch(() => null)
    if (!json?.ok || !Array.isArray(json.guarantees) || json.guarantees.length === 0) return null
    return json.guarantees as GuaranteeDocument[]
  } catch {
    return null
  }
}

/** The hosted Shiv Hardware site's guarantee page — what every printed QR opens. */
const GUARANTEE_SITE_URL = 'https://www.shivhardware.store/Gaurantee'

/**
 * Public URL of a single guarantee card — encoded into the QR.
 *
 * Exactly what gets printed: the print server and the desktop app's direct
 * Epson path both print `GUARANTEE_PUBLIC_URL/<number>?k=<token>`
 * (print-server/.env), so the on-screen preview builds the same URL and the QR
 * you see is the QR on the card. VITE_GUARANTEE_PUBLIC_URL overrides the hosted
 * site, like the server's.
 *
 * The token is not optional: Convex's getGuaranteeByNumber opens a card only
 * when number AND token match (numbers are sequential and the card carries
 * Aadhaar/mobile), so a QR without it shows "Card not found".
 */
export function guaranteeOnlineUrl(number: string, token?: string): string {
  // The short link (qr-redirect/), when one is set: <short>/<number>/<token>, which
  // redirects to the long one. Shorter, so the QR on the small card is less dense.
  const short = (import.meta.env.VITE_GUARANTEE_SHORT_URL ?? '').trim().replace(/\/+$/, '')
  if (short && token) return `${short}/${encodeURIComponent(number)}/${encodeURIComponent(token)}`
  const base = ((import.meta.env.VITE_GUARANTEE_PUBLIC_URL ?? '').trim() || GUARANTEE_SITE_URL).replace(/\/+$/, '')
  const path = `${base}/${encodeURIComponent(number)}`
  return token ? `${path}?k=${encodeURIComponent(token)}` : path
}

export type WhatsAppWebStatus = {
  /** starting | qr | ready | reconnecting | logged_out | error | disabled */
  status: string
  qrDataUrl: string | null
  readyAt?: string | null
  lastError?: { at: string; error: string } | null
}

/** Read the shop WhatsApp connection status (+ QR data URL when re-login is needed). */
export async function fetchWhatsAppStatus(): Promise<WhatsAppWebStatus> {
  const res = await fetchPrintServer('/whatsapp-web/status', undefined, 8000)
  const json = await res.json().catch(() => null)
  if (!json || typeof json.status !== 'string') throw new Error('Could not read WhatsApp status from the print server')
  return json as WhatsAppWebStatus
}

/** True if the error from a WhatsApp send means the account needs (re-)login. */
export function isWhatsAppNotConnectedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /not connected|logged.?out|logged out|status:\s*(qr|logged_out|reconnecting|starting|error|disabled)/i.test(msg)
}

/**
 * Ask the print server to WhatsApp the guarantee-ready message to a customer's
 * mobile, using the same account that hosts the shop's WhatsApp auto-print.
 * Resolves with the JID it sent to; throws with a user-facing message on failure.
 */
export async function sendGuaranteeWhatsApp(mobile: string, name = ''): Promise<{ ok: true; jid: string; message: string; skipped?: boolean }> {
  try {
    const res = await fetchPrintServer('/whatsapp-notify-customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, name }),
    }, 25_000)
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Print server returned HTTP ${res.status}`)
    return json as { ok: true; jid: string; message: string; skipped?: boolean }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Print server timed out at ${PRINT_SERVER_URL}`)
    }
    if (err instanceof TypeError) {
      throw new Error(`Cannot reach print server at ${PRINT_SERVER_URL}. Start it on the computer and use the same Wi-Fi.`)
    }
    throw err
  }
}

export async function printOnServer(payload: ServerPrintPayload, copies = 1, printer?: string): Promise<ServerPrintResult> {
  try {
    const res = await fetchPrintServer('/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, copies, ...(printer ? { printer } : {}) }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Print server returned HTTP ${res.status}`)
    return json as ServerPrintResult
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Print server timed out at ${PRINT_SERVER_URL}`)
    }
    if (err instanceof TypeError) {
      throw new Error(`Cannot reach print server at ${PRINT_SERVER_URL}. Start it on the computer and use the same Wi-Fi.`)
    }
    throw err
  }
}

export async function renderPngOnServer(payload: ServerPrintPayload, scale = 2): Promise<ServerRenderPngResult> {
  try {
    const res = await fetchPrintServer('/render-png', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, scale }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Print server returned HTTP ${res.status}`)
    return json as ServerRenderPngResult
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Print server timed out at ${PRINT_SERVER_URL}`)
    }
    if (err instanceof TypeError) {
      throw new Error(`Cannot reach print server at ${PRINT_SERVER_URL}. Start it on the computer and use the same Wi-Fi.`)
    }
    throw err
  }
}
