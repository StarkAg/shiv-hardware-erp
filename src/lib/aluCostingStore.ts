// Where the aluminium costing lives on a device, and how it reaches the others.
//
// This device's copy is in localStorage, so the counter prices a door at once
// and offline. The server holds the shop's copy (convex/aluCosting.ts): it is
// read when the counter opens and every edit is sent a moment after it is
// made. Whichever copy was saved last wins.

import { useSyncExternalStore } from 'react'
import { defaultCosting, normaliseCosting, type AluCosting } from './aluCosting'
import { fetchAluCosting, pushAluCosting } from './convexSync'

const KEY = 'shiv:alu-costing'

function readLocal(): AluCosting {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? normaliseCosting(JSON.parse(raw)) : defaultCosting()
  } catch {
    return defaultCosting()
  }
}

let current: AluCosting = readLocal()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function keepLocal(c: AluCosting) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* private window: kept for this visit only */
  }
}

let pushTimer: ReturnType<typeof setTimeout> | null = null
let unsent = false

function schedulePush() {
  unsent = true
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(async () => {
    pushTimer = null
    const sending = current
    if (await pushAluCosting(sending, sending.savedAt)) {
      if (current === sending) unsent = false
    } else {
      // Not reached: try again shortly, as long as nothing newer replaced it.
      setTimeout(() => current === sending && schedulePush(), 15_000)
    }
  }, 1200)
}

export function saveAluCosting(next: AluCosting) {
  current = { ...next, savedAt: Date.now() }
  keepLocal(current)
  emit()
  schedulePush()
}

export function resetAluCosting() {
  saveAluCosting(defaultCosting())
}

let pulled = false
/** Takes the server's copy if it is newer; sends this one if the server has none or older. */
export async function pullAluCosting() {
  const row = await fetchAluCosting()
  if (!row) {
    if (current.savedAt > 0) schedulePush()
    return
  }
  if (row.savedAt > current.savedAt && !unsent) {
    current = { ...normaliseCosting(row.data), savedAt: row.savedAt }
    keepLocal(current)
    emit()
  } else if (row.savedAt < current.savedAt) {
    schedulePush()
  }
}

function subscribe(l: () => void) {
  listeners.add(l)
  if (!pulled) {
    pulled = true
    void pullAluCosting()
  }
  return () => listeners.delete(l)
}

export function useAluCosting(): AluCosting {
  return useSyncExternalStore(subscribe, () => current)
}
