/**
 * Subscribe to the print server's SSE /sync stream.
 * When any device saves bills or catalog, all connected devices on the same
 * Wi-Fi receive a push event and can re-pull the latest data.
 *
 * Returns a cleanup function that closes the connection.
 */
export function subscribeSyncStream(
  serverUrl: string,
  handlers: {
    onBills?:      (meta: { count: number; savedAt: string }) => void
    onCatalog?:    (meta: { savedAt: string })                 => void
    onGuarantees?: (meta: { count: number; savedAt: string }) => void
  },
): () => void {
  let es: EventSource | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  function connect() {
    if (closed) return
    try {
      es = new EventSource(`${serverUrl}/sync`)

      es.addEventListener('bills',       (e) => {
        try { handlers.onBills?.(JSON.parse(e.data)) } catch { /* ignore */ }
      })
      es.addEventListener('catalog',     (e) => {
        try { handlers.onCatalog?.(JSON.parse(e.data)) } catch { /* ignore */ }
      })
      es.addEventListener('guarantees', (e) => {
        try { handlers.onGuarantees?.(JSON.parse(e.data)) } catch { /* ignore */ }
      })

      es.onerror = () => {
        es?.close()
        es = null
        if (!closed) retryTimer = setTimeout(connect, 6000)
      }
    } catch {
      // EventSource not supported (e.g. Capacitor offline) — silently give up
    }
  }

  connect()

  return () => {
    closed = true
    if (retryTimer) clearTimeout(retryTimer)
    es?.close()
  }
}
