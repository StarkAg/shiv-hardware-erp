// ── The pieces the screens are built from ───────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import { blankDim, fmtDim, SOOT_GLYPH } from './dims.js'
import { onEnterNext } from './keys.js'

export const Row = ({ children, className = '' }) => <div className={`row ${className}`}>{children}</div>

export function Field({ label, value, onChange, placeholder, type = 'text', inputMode, autoFocus }) {
  return (
    <label className="field">
      <span className="flabel">{label}</span>
      <input
        type={type} inputMode={inputMode} value={value ?? ''} placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onEnterNext}
      />
    </label>
  )
}

export function Chips({ options, value, onChange, small }) {
  return (
    <div className={`chips ${small ? 'sm' : ''}`}>
      {options.map((o) => (
        <button
          key={o.id}
          className={`chip ${value === o.id ? 'on' : ''}`}
          onClick={() => onChange(o.id)}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Width and height in one pad.
 *
 * Built for a mechanic standing on a ladder with one hand free, which rules
 * out the phone keyboard: it slides up over the form, it has no eighths on it,
 * and "13 7/8" typed into a text box is three chances to get it wrong. Here a
 * size is digits, then one tap on the eighth, then Next — the same rhythm as
 * reading a tape.
 */
export function SizePad({ w: w0, h: h0, onCancel, onDone }) {
  const [w, setW] = useState(w0 || blankDim())
  const [h, setH] = useState(h0 || blankDim())
  const [side, setSide] = useState('w')
  const box = useRef(null)
  useEffect(() => { box.current?.focus() }, [])

  // The pad opens holding a size already — the usual one for this product, or
  // the one being corrected. So the first digit typed against a side REPLACES
  // what is showing, the way a calculator does after a result; digits after it
  // append. Without this, opening on 12 and typing 21 gives 1221.
  const [typed, setTyped] = useState({ w: false, h: false })

  const cur = side === 'w' ? w : h
  const setCur = side === 'w' ? setW : setH

  const tap = (d) => {
    const fresh = !typed[side]
    if (fresh) setTyped((t) => ({ ...t, [side]: true }))
    setCur((c) => {
      const next = Number(fresh ? d : `${c.inches || ''}${d}`)
      return next > 9999 ? c : { ...c, inches: next }
    })
  }
  const back = () => {
    setTyped((t) => ({ ...t, [side]: true }))
    setCur((c) => ({ ...c, inches: Math.floor((c.inches || 0) / 10) }))
  }
  const soot = (s) => setCur((c) => ({ ...c, soot: c.soot === s ? 0 : s }))

  useEffect(() => {
    const onKey = (e) => {
      if (e.key >= '0' && e.key <= '9') { tap(e.key); e.preventDefault() }
      else if (e.key === 'Backspace') { back(); e.preventDefault() }
      else if (e.key === 'Enter') { side === 'w' ? setSide('h') : onDone(w, h); e.preventDefault() }
      else if (e.key === 'Escape') { onCancel(); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="modal" onClick={onCancel}>
      <div className="sheet padsheet" ref={box} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="sizeshow">
          <button
            className={`sizehalf ${side === 'w' ? 'on' : ''} ${side === 'w' && !typed.w ? 'fresh' : ''}`}
            onClick={() => setSide('w')}
          >
            <span>Width</span><b>{fmtDim(w)}″</b>
          </button>
          <span className="sizex">×</span>
          <button
            className={`sizehalf ${side === 'h' ? 'on' : ''} ${side === 'h' && !typed.h ? 'fresh' : ''}`}
            onClick={() => setSide('h')}
          >
            <span>Height</span><b>{fmtDim(h)}″</b>
          </button>
        </div>

        <div className="sootstrip">
          {SOOT_GLYPH.map((g, s) => (
            <button
              key={s} className={`sootkey ${cur.soot === s ? 'on' : ''}`}
              onClick={() => soot(s)}
            >
              {s === 0 ? '—' : g}
            </button>
          ))}
        </div>

        <div className="padkeys">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} className="padkey" onClick={() => tap(d)}>{d}</button>
          ))}
          <button className="padkey" onClick={back} aria-label="Delete last digit">⌫</button>
          <button className="padkey" onClick={() => tap('0')}>0</button>
          {side === 'w'
            ? <button className="padkey go" onClick={() => setSide('h')}>→</button>
            : <button className="padkey go" onClick={() => onDone(w, h)}>✓</button>}
        </div>

        <button className="ghostbtn wide" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

export function Confirm({ title, body, confirmLabel = 'Confirm', danger, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onConfirm() }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  return (
    <div className="modal" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheettitle">{title}</div>
        {body && <div className="sheetsub">{body}</div>}
        <div className="sheetbtns">
          <button className="ghostbtn" onClick={onCancel}>Cancel</button>
          <button className={`primbtn ${danger ? 'danger' : ''}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

export const StatusPill = ({ status }) => {
  const label = {
    estimate: 'Estimate',
    measured: 'To confirm',
    confirmed: 'Confirmed',
    ordered: 'In workshop',
    delivered: 'Delivered',
    billed: 'Billed',
  }[status] || status
  return <span className={`pill ${status}`}>{label}</span>
}

export const BackBar = ({ onBack, title, right }) => (
  <div className="backbar">
    <button className="backbtn" onClick={onBack} aria-label="Back">‹</button>
    <div className="backtitle">{title}</div>
    {right ?? <span />}
  </div>
)
