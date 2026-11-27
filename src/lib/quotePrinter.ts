import { LOCAL_PRINT_SERVER_URL } from './printServer'

/**
 * The printer quotations go to on the Printers screen (its fallback when that
 * one is offline), asked of the print server on this PC. The desktop app
 * prints quotations itself, drawn as its preview shows them, and names this
 * printer; with no name it went to Windows' default, the HP (27 Nov 2026).
 *
 * Not the print server's own quotation print: its template knows only the
 * sized quotes, so a rate card such as Door Chaukhat came out as just the
 * visiting card. Undefined when the server does not answer: Windows' default.
 */
export async function quotationPrinter(): Promise<string | undefined> {
  try {
    const res = await fetch(`${LOCAL_PRINT_SERVER_URL}/printers/status`, { signal: AbortSignal.timeout(3000) })
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
