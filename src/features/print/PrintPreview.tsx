import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Printer, X } from 'lucide-react'

// A4 in CSS px at 96dpi.
const A4_W = 794
const A4_H = 1123
const HP_TEST_PRINTER = 'HP_Ink_Tank_Wireless_410_series__83E60C_'

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
  const [hpPrinting, setHpPrinting] = useState(false)
  const isDesktop = !!window.shivDesktop?.printCurrentPage

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

  async function printHp() {
    if (!window.shivDesktop?.printCurrentPage) return

    setHpPrinting(true)
    try {
      const printers = await window.shivDesktop.getPrinters()
      const hpPrinter = printers.find((printer) =>
        [printer.name, printer.displayName, printer.description]
          .filter(Boolean)
          .some((value) =>
            value === HP_TEST_PRINTER ||
            value?.includes('HP Ink Tank Wireless 410') ||
            value?.includes('83E60C'),
          ),
      )

      if (!hpPrinter) {
        const printerNames = printers.map((printer) => printer.name).join('\n')
        throw new Error(`HP printer not found. Available printers:\n${printerNames || 'None'}`)
      }

      await window.shivDesktop.printCurrentPage({ copies: 1, deviceName: hpPrinter.name })
    } catch (err) {
      alert(`HP print failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setHpPrinting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-800/95">
      <div className="no-print flex flex-col gap-2 bg-slate-900 px-3 py-2 text-white sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-3">
        <div className="font-semibold leading-tight">Print preview - {title}</div>
        <div className="flex flex-wrap gap-2">
          {isDesktop && (
            <button
              onClick={printHp}
              disabled={hpPrinting || printing}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60 sm:px-4"
              title="Silent print to HP Ink Tank Wireless 410 series [83E60C]"
            >
              <Printer size={16} /> {hpPrinting ? 'Printing HP' : 'Print HP'}
            </button>
          )}
          <button
            onClick={print}
            disabled={printing || hpPrinting}
            className="flex items-center gap-1.5 rounded-lg bg-shiv-green px-3 py-2 text-sm font-semibold text-stone-950 hover:bg-[#c6a15a] sm:px-4"
          >
            <Printer size={16} /> {printing ? 'Printing' : 'Print'}
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600 sm:px-4"
          >
            <X size={16} /> Close
          </button>
        </div>
      </div>

      {/* Fit-to-screen preview: scaled, no scrollbars */}
      <div ref={areaRef} className="flex flex-1 items-start justify-center overflow-hidden p-2 sm:p-4">
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
