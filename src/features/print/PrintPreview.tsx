import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Printer, X } from 'lucide-react'

// A4 in CSS px at 96dpi.
const A4_W = 794
const A4_H = 1123

// Full-screen preview overlay. The A4 sheet is scaled to fit the screen (no
// scrolling); printing still uses the true A4 size via @media print rules.
export function PrintPreview({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [printing, setPrinting] = useState(false)

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const fit = () => {
      const pad = 32
      const s = Math.min((el.clientWidth - pad) / A4_W, (el.clientHeight - pad) / A4_H, 1)
      setScale(s > 0 ? s : 1)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Esc closes the preview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function print() {
    if (!window.shivDesktop?.printCurrentPage) {
      window.print()
      return
    }

    setPrinting(true)
    try {
      await window.shivDesktop.printCurrentPage({ copies: 1 })
    } catch (err) {
      alert(`Print failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-800/95">
      <div className="no-print flex items-center justify-between bg-slate-900 px-6 py-3 text-white">
        <div className="font-semibold">Print preview — {title}</div>
        <div className="flex gap-2">
          <button
            onClick={print}
            disabled={printing}
            className="flex items-center gap-1.5 rounded-lg bg-shiv-green px-4 py-2 text-sm font-semibold text-stone-950 hover:bg-[#c6a15a]"
          >
            <Printer size={16} /> {printing ? 'Printing' : 'Print'}
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600"
          >
            <X size={16} /> Close
          </button>
        </div>
      </div>

      {/* Fit-to-screen preview: scaled, no scrollbars */}
      <div ref={areaRef} className="flex flex-1 items-start justify-center overflow-hidden p-4">
        <div
          className="preview-scale"
          style={{ ['--preview-scale' as string]: scale, width: A4_W, height: A4_H }}
        >
          <div className="print-root">{children}</div>
        </div>
      </div>
    </div>
  )
}
