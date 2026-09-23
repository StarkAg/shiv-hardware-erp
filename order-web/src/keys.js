// ── Working it without the mouse ────────────────────────────────────────────
// At the counter this runs on a keyboard, and the rhythm that matters is the
// one the paper pad has: write a line, move to the next, never take your hand
// off. Enter is what a person presses without being told to, so Enter is the
// key that always does the obvious next thing on whatever screen is open.
//
// A handler is skipped while somebody is typing in a box, unless it says
// otherwise — Enter in a field should finish the field, not fire the screen's
// main action behind it.

import { useEffect } from 'react'

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * `handlers` maps a key to a function, or to { run, inInputs } when the key
 * should fire even while a field has focus. `active` turns the whole set off,
 * which is what a modal uses so its own keys are the only ones listening.
 */
export function useHotkeys(handlers, active = true) {
  useEffect(() => {
    if (!active) return undefined
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
      const entry = handlers[e.key]
      if (!entry) return
      const run = typeof entry === 'function' ? entry : entry.run
      const inInputs = typeof entry === 'function' ? false : !!entry.inInputs
      if (!run) return
      if (TYPING.has(e.target?.tagName) && !inInputs) return
      const handled = run(e)
      if (handled !== false) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}

/** Move to the next field in the same form — what Enter does in a box. */
export function focusNext(el) {
  if (!el) return
  const form = el.closest('.block') || document
  const fields = [...form.querySelectorAll('input, button.sizebtn, button.orsize')]
    .filter((n) => !n.disabled && n.offsetParent !== null)
  const i = fields.indexOf(el)
  const next = fields[i + 1]
  if (next) { next.focus(); next.select?.() }
  else el.blur()
}

/** Enter in a text field moves on rather than doing nothing. */
export const onEnterNext = (e) => {
  if (e.key !== 'Enter') return
  e.preventDefault()
  focusNext(e.currentTarget)
}
