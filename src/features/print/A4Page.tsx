import type { ReactNode } from 'react'

/** A single A4 sheet. Wrap print content in this for screen preview + print. */
export function A4Page({ children }: { children: ReactNode }) {
  return <div className="a4-page">{children}</div>
}

/** Wraps a printable document: triggers window.print() and isolates it via .print-root. */
export function PrintFrame({ children }: { children: ReactNode }) {
  return (
    <div className="print-root">
      <div className="a4-preview-frame no-print-frame">{children}</div>
    </div>
  )
}
