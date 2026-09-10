import { useEffect, useState } from 'react'

/**
 * The ledger's dark rules are written against its own root, which after
 * scoping means `.ledger-root.dark` — but the panel puts `dark` on <html>.
 * Mirror it onto the wrapper so one toggle drives both themes, and watch for
 * changes so switching while a ledger screen is open takes effect at once.
 *
 * Shared because two screens now render ledger markup: the ledger itself, and
 * the Day Book in the panel.
 */
export function useLedgerTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const el = document.documentElement
    const sync = () => setDark(el.classList.contains('dark'))
    const observer = new MutationObserver(sync)
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    sync()
    return () => observer.disconnect()
  }, [])

  return dark
}
