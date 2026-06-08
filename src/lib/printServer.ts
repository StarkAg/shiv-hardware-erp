import type { Bill, BrandSet, CustomCatalogEntry, GuaranteeDocument, HardwareCatalog, Quotation } from './types'

const PRINT_SERVER_PORT = import.meta.env.VITE_PRINT_SERVER_PORT || '3333'
const configuredPrintServer = (import.meta.env.VITE_PRINT_SERVER || '').trim().replace(/\/+$/, '')
const PRINT_SERVER_STORAGE_KEY = 'shiv-panel:print-server-url'
const DISCOVERY_PREFIXES = ['192.168.29', '192.168.1', '192.168.0', '10.0.0']
const DISCOVERY_TIMEOUT_MS = 700

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

async function discoverPrintServer() {
  const candidates = DISCOVERY_PREFIXES.flatMap((prefix) =>
    Array.from({ length: 254 }, (_, index) => `http://${prefix}.${index + 1}:${PRINT_SERVER_PORT}`),
  )
  const batchSize = 32

  for (let start = 0; start < candidates.length; start += batchSize) {
    const batch = candidates.slice(start, start + batchSize)
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const response = await fetchWithTimeout(`${url}/status`)
        const json = await response.json().catch(() => null)
        if (response.ok && json?.server === 'Shiv Print Server') return url
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
  for (const url of candidatePrintServerUrls()) {
    try {
      const response = await fetchWithTimeout(`${url}/status`)
      const json = await response.json().catch(() => null)
      if (response.ok && json?.server === 'Shiv Print Server') {
        savePrintServerUrl(url)
        return url
      }
    } catch {
      /* try the next candidate */
    }
  }

  return await discoverPrintServer()
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
