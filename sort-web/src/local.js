/**
 * The phone works from its own copy; Convex is told behind it.
 *
 * Two pieces:
 *
 *   useCached(query, args, key) — a live Convex query that answers at once from
 *     what this phone last saw (kept in localStorage), and swaps to the live
 *     answer the moment it lands. Opening the app shows the tray, not "Loading".
 *
 *   outbox — every Save / Next / Undo is written here first and sent in order
 *     in the background, one at a time. It is kept in localStorage, so a dropped
 *     signal, a locked phone or a reload loses nothing; it carries on when the
 *     connection is back. Screens hide what is still in it, so a slip that has
 *     been dealt with never comes round again while its change is on its way.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { getFunctionName, makeFunctionReference } from 'convex/server'

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* full or blocked: the live answer still works */
  }
}

export function useCached(query, args, key) {
  const live = useQuery(query, args)
  const storeKey = `sort:cache:${key}`
  const [kept] = useState(() => read(storeKey, undefined))
  useEffect(() => {
    if (live !== undefined) write(storeKey, live)
  }, [live, storeKey])
  return live !== undefined ? live : read(storeKey, kept)
}

/* ── outbox ─────────────────────────────────────────────────────────── */

const BOX = 'sort:outbox'
let items = read(BOX, []) // [{ id, fn, args, hide, meta, at, tries, error }]
// Done in the last minute: the live query may not have caught up yet, so these
// stay hidden a little longer rather than flashing back onto the screen.
const recent = new Map() // hide id -> done at
const listeners = new Set()
let snapshot = { items, recent: [...recent.keys()] }
const emit = () => {
  snapshot = { items, recent: [...recent.keys()] }
  for (const l of listeners) l()
}
const save = () => write(BOX, items)
const answers = new Set() // (item, result | error) => void

/** Changes the server refuses because they already happened are finished, not failed. */
const ALREADY = /photograph is gone|already in its folder|not in the sorting queue/i

let client = null
let running = false

async function pump() {
  if (running || !client) return
  running = true
  while (items.length) {
    const item = items[0]
    try {
      const result = await client.mutation(makeFunctionReference(item.fn), item.args)
      items = items.slice(1)
      if (item.hide) recent.set(item.hide, Date.now())
      save(); emit()
      for (const a of answers) a(item, result, null)
    } catch (err) {
      const message = String(err?.message ?? err)
      if (ALREADY.test(message)) {
        items = items.slice(1)
        if (item.hide) recent.set(item.hide, Date.now())
        save(); emit()
        continue
      }
      // A real refusal (not the network) would block everything behind it:
      // after a few tries it is set aside and said, and the rest go on.
      const tries = (item.tries ?? 0) + 1
      const offline = /network|fetch|connection|timed? ?out|websocket/i.test(message) || !navigator.onLine
      if (!offline && tries >= 3) {
        items = items.slice(1)
        save(); emit()
        for (const a of answers) a(item, null, message)
        continue
      }
      items = [{ ...item, tries, error: message }, ...items.slice(1)]
      save(); emit()
      await new Promise((r) => setTimeout(r, Math.min(15000, 1500 * tries)))
    }
  }
  running = false
}

setInterval(() => {
  const cutoff = Date.now() - 60_000
  let changed = false
  for (const [k, at] of recent) if (at < cutoff) { recent.delete(k); changed = true }
  if (changed) emit()
  if (items.length && !running) void pump()
}, 5000)
if (typeof window !== 'undefined') window.addEventListener('online', () => void pump())

/**
 * Queue a mutation. `hide` is the id of what it deals with (an inbox photo, a
 * filing row); `meta` is what the screen guessed (the bookmark), kept with it
 * so the server's answer can be checked against it.
 */
export function send(fn, args, hide, meta) {
  items = [...items, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, fn: getFunctionName(fn), args, hide, meta, at: Date.now() }]
  save(); emit()
  void pump()
}

/** Take a queued change back before it has gone (Undo straight after Next). */
export function unsend(hide, fnName) {
  const before = items.length
  // Never the one being sent right now: that is already on its way.
  items = items.filter((it, i) => !(it.hide === hide && it.fn === fnName && (i > 0 || !running)))
  if (items.length !== before) { save(); emit(); return true }
  return false
}

/** Show it again at once (Undo): it is back on the stack, not just placed. */
export function unhide(hide) {
  if (recent.delete(hide)) emit()
}

/** Hook: starts the sender and returns what is still waiting, plus what is hidden. */
export function useOutbox() {
  const convex = useConvex()
  useEffect(() => {
    client = convex
    void pump()
  }, [convex])
  const snap = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    () => snapshot,
  )
  const hidden = useMemo(() => new Set([...snap.items.map((i) => i.hide).filter(Boolean), ...snap.recent]), [snap])
  return { pending: snap.items, hidden }
}

/** Hear the server's answer to each change as it is sent. */
export function useAnswers(fn) {
  useEffect(() => {
    answers.add(fn)
    return () => answers.delete(fn)
  }, [fn])
}
