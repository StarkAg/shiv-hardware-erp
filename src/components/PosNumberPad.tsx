import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowRight, ChevronDown, Delete } from 'lucide-react'
import { enterFlowAdvance } from '../lib/enterFlow'

/**
 * The Android app's number pad, in place of the phone's keyboard for every
 * number box (sizes, quantities, rates, mobile numbers) — big keys like a
 * counter machine's. Mounted only in the app (counter.tsx, lib/posApp).
 *
 *   - The first key after a box is entered replaces what is in it, as on a
 *     till; Back deletes one figure.
 *   - Next walks on, the same as Enter on the PC (lib/enterFlow): past the
 *     last box it lands on the screen's Print button.
 *   - Done puts the pad away.
 *
 * A box opts out with data-pos-pad="off". The phone's keyboard is kept away by
 * inputmode="none", set as the box is touched (before it takes focus).
 */

type NumberBox = HTMLInputElement

function isNumberBox(el: EventTarget | null): el is NumberBox {
  if (!(el instanceof HTMLInputElement) || el.readOnly || el.disabled) return false
  if (el.closest('[data-pos-pad="off"]')) return false
  const type = (el.type || 'text').toLowerCase()
  const mode = (el.dataset.posMode ?? el.getAttribute('inputmode') ?? '').toLowerCase()
  return type === 'number' || type === 'tel' || mode === 'numeric' || mode === 'decimal' || mode === 'tel'
}

/** Whether a decimal point belongs in this box: a rate or a thickness, not a count or a phone number. */
function takesDot(el: NumberBox) {
  const mode = (el.dataset.posMode ?? '').toLowerCase()
  if (mode === 'numeric' || mode === 'tel') return false
  if (el.type === 'tel') return false
  if (el.type === 'number') return !/^\d+$/.test(el.step || '') || el.step === 'any'
  return mode === 'decimal'
}

/** Keeps the phone's keyboard shut for the box, remembering what it asked for. */
function silence(el: NumberBox) {
  if (el.dataset.posMode === undefined) el.dataset.posMode = el.getAttribute('inputmode') ?? ''
  el.setAttribute('inputmode', 'none')
}

/** Writes past React's value tracker, so the form's onChange sees it as typed. */
function setValue(el: NumberBox, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function labelOf(el: NumberBox) {
  const own = el.getAttribute('aria-label') || el.placeholder
  if (own) return own
  const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : null
  return (byFor || el.closest('label')?.textContent || '').trim()
}

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'back'] as const

export function PosNumberPad() {
  const [box, setBox] = useState<NumberBox | null>(null)
  const [shown, setShown] = useState('')
  // What is being typed, kept here: a number box drops "12." as not a number,
  // so the point would vanish before the next figure.
  const typed = useRef('')
  const fresh = useRef(true)
  const pad = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Touch comes before focus: shut the keyboard out before it opens.
    const touch = (event: Event) => { if (isNumberBox(event.target)) silence(event.target) }
    const enter = (event: FocusEvent) => {
      if (!isNumberBox(event.target)) return
      const el = event.target
      silence(el)
      typed.current = el.value
      fresh.current = true
      setShown(el.value)
      setBox(el)
    }
    const leave = () => {
      // Focus moves after focusout; look once it has landed.
      window.setTimeout(() => {
        if (!isNumberBox(document.activeElement)) setBox(null)
      }, 0)
    }
    // A new page takes the box away without always saying so.
    const away = () => setBox(null)
    document.addEventListener('pointerdown', touch, true)
    document.addEventListener('focusin', enter)
    document.addEventListener('focusout', leave)
    window.addEventListener('hashchange', away)
    return () => {
      document.removeEventListener('pointerdown', touch, true)
      document.removeEventListener('focusin', enter)
      document.removeEventListener('focusout', leave)
      window.removeEventListener('hashchange', away)
    }
  }, [])

  // Room under the page for the pad, and the box in hand brought into view above it.
  useLayoutEffect(() => {
    const root = document.documentElement
    if (!box || !box.isConnected) { root.classList.remove('pos-pad-open'); return }
    root.style.setProperty('--pos-pad-h', `${pad.current?.offsetHeight ?? 0}px`)
    root.classList.add('pos-pad-open')
    box.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [box])

  if (!box || !box.isConnected) return null

  const write = (next: string) => {
    if (box.maxLength > 0 && next.replace('.', '').length > box.maxLength) return
    typed.current = next
    setValue(box, next.endsWith('.') ? next.slice(0, -1) : next)
    // The form may refuse or tidy it (a limit, a format): follow what it kept.
    const kept = box.value
    if (kept !== (next.endsWith('.') ? next.slice(0, -1) : next)) typed.current = kept
    setShown(typed.current)
  }

  const press = (key: (typeof KEYS)[number]) => {
    const start = fresh.current ? '' : typed.current
    if (key === 'back') {
      fresh.current = false
      write(typed.current.slice(0, -1))
      return
    }
    fresh.current = false
    if (key === '.') {
      if (!takesDot(box) || start.includes('.')) return
      write(`${start || '0'}.`)
      return
    }
    write(start === '0' ? key : start + key)
  }

  // A key must not take the focus from the box, or the pad would close.
  const keep = (event: ReactPointerEvent) => event.preventDefault()
  const dot = takesDot(box)
  const label = labelOf(box)

  return (
    <div
      ref={pad}
      onPointerDown={keep}
      className="no-print fixed inset-x-0 bottom-0 z-[60] border-t-4 border-stone-900 bg-white pb-[env(safe-area-inset-bottom)]"
      style={{ touchAction: 'manipulation' }}
    >
      <div className="flex items-baseline justify-between gap-3 px-3 pt-2">
        <span className="truncate text-sm font-bold uppercase tracking-[0.14em] text-muted">{label}</span>
        <span className="font-[family-name:var(--sign)] text-3xl font-extrabold tabular-nums text-stone-900">{shown || ' '}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 p-2">
        {KEYS.map((key) => {
          const off = key === '.' && !dot
          return (
            <button
              key={key}
              type="button"
              tabIndex={-1}
              disabled={off}
              onClick={() => press(key)}
              aria-label={key === 'back' ? 'Delete one figure' : key}
              style={{ boxShadow: 'inset 0 -4px 0 #c9cfd5' }}
              className="flex min-h-[3.6rem] items-center justify-center bg-stone-100 font-[family-name:var(--sign)] text-3xl font-extrabold text-stone-900 active:translate-y-0.5 disabled:opacity-30"
            >
              {key === 'back' ? <Delete size={30} strokeWidth={2.4} /> : key}
            </button>
          )
        })}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => box.blur()}
          style={{ boxShadow: 'inset 0 -4px 0 #c9cfd5' }}
          className="flex min-h-[3.6rem] items-center justify-center gap-1 bg-stone-100 font-[family-name:var(--sign)] text-xl font-bold uppercase text-stone-900 active:translate-y-0.5"
        >
          <ChevronDown size={24} strokeWidth={2.6} /> Done
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => enterFlowAdvance(box, 1)}
          className="col-span-2 flex min-h-[3.6rem] items-center justify-center gap-2 bg-shiv-green font-[family-name:var(--sign)] text-2xl font-extrabold uppercase text-white active:translate-y-0.5"
        >
          Next <ArrowRight size={28} strokeWidth={2.6} />
        </button>
      </div>
    </div>
  )
}
