import type { ConvexReactClient } from 'convex/react'
import { api } from '../../convex/_generated/api'

/**
 * The Shop WhatsApp, on Railway, reached through Convex (convex/shopWhatsApp.ts)
 * so the panel never holds the service's key. Plain functions, called from
 * buttons, so the app's Convex client is handed over once at start (main.tsx,
 * counter.tsx) rather than taken from a hook.
 */
let client: ConvexReactClient | null = null
export function setShopWhatsAppClient(c: ConvexReactClient | null) {
  client = c
}

/**
 * Runs one call. The service being down, or this device offline, comes back
 * as a TypeError — the same as an unreachable print server used to — so the
 * callers that offer sharing by hand still do.
 */
export async function shopWhatsApp<T>(run: (c: ConvexReactClient) => Promise<T>): Promise<T> {
  if (!client) throw new TypeError('The books are not connected on this device.')
  try {
    return await run(client)
  } catch (err) {
    const message = String((err as { data?: unknown })?.data ?? (err instanceof Error ? err.message : err))
    if (/Cannot reach|fetch failed|network/i.test(message)) throw new TypeError(message)
    throw new Error(message.replace(/^.*Uncaught ConvexError:\s*/s, '').split('\n')[0])
  }
}

export { api as shopApi }
