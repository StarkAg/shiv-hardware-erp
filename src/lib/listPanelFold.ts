import { useSyncExternalStore } from 'react'

/** Whether the bill screen's right-hand List panel is folded away, kept on this computer. */
const KEY = 'shiv.billListPanel.folded'
const listeners = new Set<() => void>()

function read(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
let folded = read()

export function setListPanelFolded(v: boolean) {
  folded = v
  try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* kept for this visit only */ }
  listeners.forEach((l) => l())
}

/** The panel, the bill preview beside it and the form all read this one answer. */
export function useListPanelFolded(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => folded,
  )
}
