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

function detectPrintServerUrl() {
  if (configuredPrintServer) return configuredPrintServer
  if (typeof window === 'undefined') return `http://localhost:${PRINT_SERVER_PORT}`

  const { protocol, hostname } = window.location
  const isHttp = protocol === 'http:' || protocol === 'https:'
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1'
  if (isHttp && hostname && !isLocalhost) return `${protocol}//${hostname}:${PRINT_SERVER_PORT}`

  return readSavedPrintServerUrl() ?? `http://localhost:${PRINT_SERVER_PORT}`
}

export const PRINT_SERVER_URL = detectPrintServerUrl()

export type ServerPrintPayload =
  | { kind: 'quotation'; quote: Quotation }
  | { kind: 'guarantee'; document: GuaranteeDocument; layout?: 'a4' | 'card' }
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
    if (isHttp && hostname && !isLocalhost) urls.add(`${protocol}//${hostname}:${PRINT_SERVER_PORT}`)
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

export async function getPrintServerUrl() {
  if (cachedServerUrl) return cachedServerUrl

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
  const discovered = await firstTruthy([discoverViaCloud(), discoverPrintServer()])
  if (discovered) cachedServerUrl = discovered
  return discovered
}

export async function fetchPrintServer(path: string, init?: RequestInit, timeoutMs = 60_000) {
  const url = await getPrintServerUrl()
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
    const res = await fetchPrintServer('/catalog', undefined, 5000)
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
    const res = await fetchPrintServer('/bills-store', undefined, 5000)
    const json = await res.json().catch(() => null)
    if (!json?.ok || !Array.isArray(json.bills) || json.bills.length === 0) return null
    return json.bills as Bill[]
  } catch {
    return null
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
