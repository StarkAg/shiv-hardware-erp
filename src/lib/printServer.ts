import type { GuaranteeDocument, Quotation } from './types'

// Change this to the computer's IP address on the shop WiFi.
// Find it on macOS with: ipconfig getifaddr en0
export const PRINT_SERVER_URL = import.meta.env.VITE_PRINT_SERVER ?? 'http://192.168.29.174:3333'

export type ServerPrintPayload =
  | { kind: 'quotation'; quote: Quotation }
  | { kind: 'guarantee'; document: GuaranteeDocument; layout?: 'a4' | 'card' }

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

export async function printOnServer(payload: ServerPrintPayload, copies = 1): Promise<ServerPrintResult> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 60_000)

  try {
    const res = await fetch(`${PRINT_SERVER_URL}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, copies }),
      signal: controller.signal,
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
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function renderPngOnServer(payload: ServerPrintPayload, scale = 2): Promise<ServerRenderPngResult> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 60_000)

  try {
    const res = await fetch(`${PRINT_SERVER_URL}/render-png`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, scale }),
      signal: controller.signal,
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
  } finally {
    window.clearTimeout(timeout)
  }
}
