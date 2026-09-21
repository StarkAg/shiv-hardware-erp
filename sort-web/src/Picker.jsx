/**
 * Choosing the customer, without losing sight of the slip.
 *
 * It is a combobox rather than a sheet: the field becomes a search box in
 * place and the names drop down underneath it, so the photograph stays on
 * screen. That matters because the name is written across the top of the slip
 * and is being copied off it as it is typed — a picker that covers the bill
 * makes somebody remember a name they can no longer see.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { similarity } from './match.js'
import { properTyping } from './text.js'

export default function Picker({ parties, value, guess, onPick, onClose }) {
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const box = useRef(null)
  const list = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => box.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [])

  const shown = useMemo(() => {
    const typed = q.trim().toLowerCase()
    const all = parties ?? []
    const matched = typed ? all.filter((p) => p.name.toLowerCase().includes(typed)) : all
    return matched
      .map((p) => ({ ...p, score: guess ? similarity(guess, p.name) : 0 }))
      // By name, not by score: three spellings of one shop can only be told
      // apart when they sit together.
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
      .slice(0, 400)
  }, [parties, q, guess])

  useEffect(() => setAt(0), [q])

  // Keep the walked-to row in view when the arrow keys are used on a keyboard.
  useEffect(() => {
    list.current?.querySelector('[data-on="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const typed = q.trim()
  /**
   * Offered from the first letter typed.
   *
   * It used to wait for a second character, which meant a one-letter name had
   * no way in at all and — worse — that the row appeared a keystroke later than
   * the eye expected, so it read as something that came and went rather than
   * something always there.
   */
  const isNew =
    typed.length > 0 && !(parties ?? []).some((p) => p.name.toLowerCase() === typed.toLowerCase())

  const rows = isNew ? [{ _id: '', name: typed, isNew: true }, ...shown] : shown

  return (
    <div className="combo">
      <div className="combo-search"><input
        aria-label="Find or add a customer"
        ref={box}
        className="field search"
        value={q}
        onChange={(e) => {
          // Proper case as it is typed, so the box reads the way the name
          // will once it is filed. Only the case changes — the length is the
          // same — so the caret belongs exactly where it was; React writing
          // the corrected value back would otherwise send it to the end.
          const el = e.target
          const { selectionStart, selectionEnd } = el
          const next = properTyping(el.value)
          setQ(next)
          if (next !== el.value) {
            requestAnimationFrame(() => {
              try { el.setSelectionRange(selectionStart, selectionEnd) } catch { /* no caret on this box */ }
            })
          }
        }}
        placeholder="Type the name on the slip"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="words"
        spellCheck="false"
        enterKeyHint="done"
        onKeyDown={(e) => {
          if (e.key === 'Escape') return onClose()
          if (e.key === 'ArrowDown') { e.preventDefault(); return setAt((i) => Math.max(0, Math.min(i + 1, rows.length - 1))) }
          if (e.key === 'ArrowUp') { e.preventDefault(); return setAt((i) => Math.max(i - 1, 0)) }
          if (e.key === 'Enter' && rows[at]) return onPick({ id: rows[at].isNew ? '' : rows[at]._id, name: rows[at].name })
          return undefined
        }}
      /><button className="picker-close" onClick={onClose}>Cancel</button></div>

      <div className="combo-list" ref={list}>
        {rows.map((p, i) => (
          <button
            key={p.isNew ? 'new' : p._id}
            data-on={i === at ? '1' : '0'}
            className={
              'row' + (i === at ? ' row-at' : '') + (p.isNew ? ' row-new' : '') +
              (!p.isNew && p._id === value ? ' row-on' : '')
            }
            onMouseEnter={() => setAt(i)}
            onClick={() => onPick({ id: p.isNew ? '' : p._id, name: p.name })}
          >
            <span className="row-name">
              {p.isNew ? <><b>+</b> Open a new account — “{p.name}”</> : p.name}
            </span>
            <span className="row-hint">
              {p.isNew ? 'new customer' : p.score >= 0.72 ? `${Math.round(p.score * 100)}%` : p.place}
            </span>
          </button>
        ))}
        {!rows.length && <p className="muted pad">No customer by that name.</p>}
      </div>
    </div>
  )
}
