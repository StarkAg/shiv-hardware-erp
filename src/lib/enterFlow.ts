/**
 * Enter walks the page, Tally-style — the Shiv Quotation app's keyboard flow.
 *
 * One listener on the document, like properInputs, so every form in the app
 * gets it without each one wiring its own:
 *
 *   - Enter in a box moves to the next box in screen order (Shift+Enter: back);
 *   - a DropDown is a stop too: Enter opens it, Enter picks and moves on;
 *   - past the last box is Accept — focus lands on the page's primary button
 *     (marked data-enter-submit, e.g. Print), so one more Enter fires it.
 *
 * It listens in the bubble phase, after React, so a field that handles Enter
 * itself (and calls preventDefault) keeps its own behaviour. Textareas keep
 * their newline; anything inside data-enter="off" is left alone.
 */

const FIELD_SELECTOR = [
  'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file])',
  'select',
  'textarea',
  '[data-dropdown-trigger]',
].join(',')

let started = false

function usable(el: HTMLElement) {
  if (el.offsetParent === null) return false // hidden
  if ((el as HTMLInputElement).disabled) return false
  if (el.getAttribute('tabindex') === '-1') return false
  if (el.closest('[data-enter="off"], [aria-hidden="true"]')) return false
  return true
}

function fields(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).filter(
    (el) => usable(el) && !(el as HTMLInputElement).readOnly,
  )
}

function focusField(el: HTMLElement) {
  el.focus()
  if (el instanceof HTMLInputElement) {
    try { el.select() } catch { /* number/date inputs have no selection */ }
  }
}

function submitButton(): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-enter-submit]'))
  return buttons.find((b) => usable(b)) ?? null
}

/**
 * Move focus one step from `from`. Exported so widgets that own Enter (the
 * DropDown list) can hand the next step back once they've taken a value.
 * A no-op unless the flow is running, so the panel's own chains are untouched.
 */
export function enterFlowAdvance(from: HTMLElement | null, dir: 1 | -1 = 1) {
  if (!started || !from) return
  const all = fields()
  const i = all.indexOf(from)
  if (dir === 1 && i === all.length - 1) {
    // Past the last box is Accept.
    const accept = submitButton()
    if (accept && !accept.disabled) { accept.focus(); return }
  }
  const next = all[i === -1 ? 0 : i + dir]
  if (next) focusField(next)
}

export function startEnterFlow() {
  if (started || typeof document === 'undefined') return
  started = true

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing) return
    if (event.ctrlKey || event.altKey || event.metaKey) return
    const el = event.target as HTMLElement | null
    if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return
    if (el.closest('[data-enter="off"]')) return
    if (el.getAttribute('aria-expanded') === 'true') return // a list owns Enter while open
    // Inside a real <form>, Enter is that form's submit.
    if (el.form) return

    event.preventDefault()
    enterFlowAdvance(el, event.shiftKey ? -1 : 1)
  })
}
