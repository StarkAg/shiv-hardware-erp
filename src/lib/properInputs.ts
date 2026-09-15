import { properText, properTyping } from '../../convex/lib/text'

/**
 * Proper case in every text box in the panel, without touching each form.
 *
 * Two listeners on the document, ahead of React:
 *
 *   - while typing, first letters rise ("bunty sharma" → "Bunty Sharma"). Only
 *     the case changes, so the caret stays put;
 *   - on leaving a box, the full rule runs — codes to capitals ("240 hdg" →
 *     "240 HDG"), spaces tidied, caps lock set right — and React is told, so
 *     the form's own state has the tidied value.
 *
 * Boxes where case is not a name's are left alone: numbers, phones, e-mail,
 * search, Aadhaar, GSTIN, UPI and the like — and any box marked
 * data-case="raw". The bill builder's item and party boxes do their own
 * typing rule and are tidied by the server when the bill is posted, because a
 * blur there would drop the item picked from the list.
 */

const SKIP_TYPES = new Set([
  'password', 'email', 'tel', 'number', 'url', 'search', 'date', 'time', 'datetime-local',
  'month', 'week', 'color', 'range', 'file', 'checkbox', 'radio', 'hidden', 'submit', 'button',
])
const SKIP_MODES = new Set(['numeric', 'decimal', 'tel', 'email', 'url', 'search', 'none'])
const SKIP_HINT = /aadhaar|\buid\b|gstin|gst\s*no|\bupi\b|ifsc|\bpan\b|\bpin\b|password|e-?mail|\burl\b|website|phone|mobile|search|\botp\b|\butr\b|12-digit|\bref\b|bill no|voucher no|invoice no/i

type TextBox = HTMLInputElement | HTMLTextAreaElement

function eligible(target: EventTarget | null): target is TextBox {
  const el = target as TextBox | null
  if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false
  if (el.readOnly || el.disabled) return false
  if (el.closest('[data-case="raw"]')) return false
  if (el instanceof HTMLInputElement && SKIP_TYPES.has((el.type || 'text').toLowerCase())) return false
  if (SKIP_MODES.has((el.getAttribute('inputmode') ?? '').toLowerCase())) return false
  const hint = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('autocomplete')]
    .filter(Boolean)
    .join(' ')
  return !SKIP_HINT.test(hint)
}

/** Writes past React's value tracker, so React sees the change as the user's. */
function setValue(el: TextBox, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
}

let started = false

export function startProperInputs() {
  if (started || typeof document === 'undefined') return
  started = true

  document.addEventListener(
    'input',
    (event) => {
      if ((event as InputEvent).isComposing || !eligible(event.target)) return
      const el = event.target
      const next = properTyping(el.value)
      if (next === el.value) return
      const { selectionStart, selectionEnd } = el
      setValue(el, next)
      // Same length, so the same caret.
      try { el.setSelectionRange(selectionStart, selectionEnd) } catch { /* not every type has one */ }
    },
    true,
  )

  document.addEventListener(
    'focusout',
    (event) => {
      if (!eligible(event.target)) return
      const el = event.target
      if (el.hasAttribute('data-bill-nav') || el.hasAttribute('data-bill-item-desc') || el.closest('[data-case="post"]')) return
      const next = properText(el.value)
      if (next === el.value) return
      setValue(el, next)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    true,
  )
}
