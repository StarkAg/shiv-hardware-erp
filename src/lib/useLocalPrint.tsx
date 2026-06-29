import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Offline-first local printing for the desktop app.
 *
 * When running inside the Electron shell on the shop computer, documents are
 * printed directly on the local printer via silent print — instant, and with NO
 * internet, print-server, or cloud queue involved. Callers render `mount` (a
 * hidden, print-only copy of the document) and call `printNode(...)`.
 *
 * Returns `printNode` rejecting when local printing isn't available (e.g. a
 * browser/tablet), so callers can fall back to the server/cloud path.
 */
export function canLocalPrint(): boolean {
  return Boolean(window.shivDesktop?.printCurrentPage)
}

type PrintRequest = {
  node: ReactNode
  copies: number
  resolve: () => void
  reject: (err: unknown) => void
}

export function useLocalPrint() {
  const [req, setReq] = useState<PrintRequest | null>(null)
  const reqRef = useRef<PrintRequest | null>(null)
  reqRef.current = req

  const printNode = useCallback((node: ReactNode, copies = 1) => {
    return new Promise<void>((resolve, reject) => {
      if (!window.shivDesktop?.printCurrentPage) {
        reject(new Error('Local printing unavailable'))
        return
      }
      setReq({ node, copies: Math.max(1, copies), resolve, reject })
    })
  }, [])

  useEffect(() => {
    if (!req) return
    let cancelled = false
    // Let the hidden document lay out (and cached images paint) before printing.
    const t = window.setTimeout(async () => {
      try {
        await window.shivDesktop!.printCurrentPage({ copies: req.copies })
        if (!cancelled) req.resolve()
      } catch (err) {
        if (!cancelled) req.reject(err)
      } finally {
        if (!cancelled) setReq(null)
      }
    }, 150)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [req])

  const mount = req ? (
    <div className="print-root print-offscreen" aria-hidden="true">
      {req.node}
    </div>
  ) : null

  return { printNode, mount, printing: Boolean(req) }
}
