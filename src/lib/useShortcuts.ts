import { useEffect, useRef } from 'react'

/**
 * One place where a keyboard shortcut is declared.
 *
 * Every screen used to open its own `window.addEventListener('keydown')` and
 * re-decide the same two questions: what counts as a modifier, and whether a
 * key should fire while someone is typing. They answered differently, which is
 * how a bare "s" for Sale ends up opening a voucher mid-way through typing a
 * supplier's name.
 *
 * The rule is settled here instead:
 *
 *   - a function key, Escape, or anything with Ctrl / Cmd / Alt fires from
 *     anywhere, a text field included — that is what those keys are for
 *   - a bare letter or digit never fires while a field has focus
 *
 * Keys are written the way they read: 'F8', 'Escape', 'mod+a' (Ctrl on
 * Windows, Cmd on a Mac), 'mod+shift+z', 'alt+d', 's'.
 */

type Handler = (event: KeyboardEvent) => void

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  return !!el?.matches?.('input, select, textarea, [contenteditable="true"]')
}

/** The event, written the way the map writes its keys. */
function comboOf(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('mod')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  parts.push(key)
  return parts.join('+')
}

/** True for keys the shop expects to work even with the cursor in a field. */
const worksWhileTyping = (combo: string) =>
  combo.includes('mod+') ||
  combo.includes('alt+') ||
  combo.endsWith('Escape') ||
  /(^|\+)F\d{1,2}$/.test(combo)

export function useShortcuts(
  map: Record<string, Handler | undefined>,
  { enabled = true }: { enabled?: boolean } = {},
) {
  // Held in a ref so the listener is bound once rather than on every render,
  // and still calls the current handlers.
  const latest = useRef(map)
  latest.current = map

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const combo = comboOf(e)
      const handler = latest.current[combo]
      if (!handler) return
      if (isTyping(e.target) && !worksWhileTyping(combo)) return
      // A shortcut that matched has taken the key: F5 must not reload the page
      // and Ctrl+A must not select the screen.
      e.preventDefault()
      handler(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
