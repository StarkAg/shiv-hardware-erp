import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Phone, Printer } from 'lucide-react'
import { useStore } from '../../lib/store'
import { CATEGORY_META } from '../../lib/types'
import type { Bill, BillItem } from '../../lib/types'
import { shortenBrand } from '../../lib/billHtml'

// ── Helpers ──────────────────────────────────────────────────────────────────

function brandColor(name: string): string {
  const PALETTE = [
    '#b5895a', '#5e9e6e', '#4a85b0', '#a05858',
    '#7060b0', '#a07040', '#3e9080', '#a06040',
  ]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function fmtAmount(n: number) {
  return '₹' + n.toLocaleString('en-IN')
}

function toProperCase(s: string) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}


// ── Flip card ─────────────────────────────────────────────────────────────────

type BrandGroup = { brand: string; items: BillItem[] }

function BrandFlipCard({
  group,
  bill,
  selected,
  disabled,
  onToggleSelect,
}: {
  group: BrandGroup
  bill: Bill
  selected: boolean
  disabled: boolean   // true when 2 others are already selected
  onToggleSelect: () => void
}) {
  const [flipped, setFlipped] = useState(false)
  const color = brandColor(group.brand)
  const subtotal = group.items.reduce((s, i) => s + (i.amount ?? 0), 0)
  const dateStr = new Date(bill.date).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  // Swipe detection
  const touchStart = useRef({ x: 0, y: 0 })
  const didSwipe = useRef(false)

  function handleTouchStart(e: React.TouchEvent) {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    didSwipe.current = false
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const dx = e.changedTouches[0].clientX - touchStart.current.x
    const dy = e.changedTouches[0].clientY - touchStart.current.y
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      didSwipe.current = true
      setFlipped((f) => !f)
    }
  }

  function handleClick() {
    if (didSwipe.current) { didSwipe.current = false; return }
    setFlipped((f) => !f)
  }

  return (
    <div className="relative flex select-none flex-col gap-1.5" style={{ aspectRatio: '54/96' }}>
      {/* Card — flip wrapper */}
      <div
        className={`cursor-pointer rounded-[10px] transition-[box-shadow] ${selected ? 'ring-2 ring-shiv-green ring-offset-1' : ''}`}
        style={{ perspective: '900px', flex: '0 0 auto', aspectRatio: '54/86' }}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
      <div
        className="relative h-full w-full"
        style={{
          transformStyle: 'preserve-3d',
          transition: 'transform 0.44s cubic-bezier(0.4,0,0.2,1)',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* ══ FRONT ══ */}
        <div
          className="absolute inset-0 flex flex-col overflow-hidden rounded-[10px] border border-stone-200 bg-white dark:border-white/10 dark:bg-stone-900"
          style={{ backfaceVisibility: 'hidden', boxShadow: `0 6px 24px ${color}44` }}
        >
          {/* Full-bleed gradient fills the card */}
          <div
            className="flex flex-1 flex-col items-center justify-center gap-3 px-3"
            style={{ background: `linear-gradient(155deg, ${color}f5 0%, ${color}99 100%)` }}
          >
            {/* Gloss shimmer line */}
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-1/3 rounded-t-[10px] opacity-20"
              style={{ background: 'linear-gradient(180deg,rgba(255,255,255,0.7) 0%,transparent 100%)' }}
            />

            {/* Initials badge */}
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-extrabold text-white"
              style={{ backgroundColor: 'rgba(0,0,0,0.22)', boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.3)' }}
            >
              {initials(group.brand)}
            </div>

            <div className="text-center">
              <div className="text-[13px] font-extrabold leading-tight text-white drop-shadow-sm">
                {group.brand}
              </div>
              <div className="mt-0.5 text-[10px] font-semibold text-white/70">
                {group.items.length} item{group.items.length !== 1 ? 's' : ''}
              </div>
            </div>

          </div>

          {/* Footer chip */}
          <div className="flex items-center justify-between px-3 py-2" style={{ background: 'rgba(0,0,0,0.06)' }}>
            <span className="text-[8px] font-bold uppercase tracking-widest text-white/60">Plywood</span>
            <span className="text-[8px] font-semibold text-white/50">swipe or tap ▸</span>
          </div>
        </div>

        {/* ══ BACK ══ */}
        <div
          className="absolute inset-0 flex flex-col overflow-hidden rounded-[10px] border border-stone-200 bg-white dark:border-white/10 dark:bg-stone-900"
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            boxShadow: `0 6px 24px ${color}44`,
          }}
        >
          {/* Customer info */}
          <div className="shrink-0 border-b border-stone-100 px-3 pb-1.5 pt-2.5 dark:border-white/10">
            <div className="flex items-baseline justify-between gap-1">
              <div className="min-w-0 truncate text-[10px] font-bold text-stone-800 dark:text-stone-100">
                {bill.customerName ? `M/S ${toProperCase(bill.customerName)}` : ''}
              </div>
              <span className="shrink-0 text-[8px] text-stone-400">{dateStr}</span>
            </div>
            <div className="mt-0.5 flex flex-col gap-0.5">
              {bill.customerPhone && (
                <span className="flex items-center gap-1 text-[9px] text-stone-400">
                  <Phone size={8} className="shrink-0" /> {bill.customerPhone}
                </span>
              )}
              {bill.customerUid && (
                <span className="text-[9px] text-stone-400">UID {bill.customerUid}</span>
              )}
            </div>
          </div>

          {/* Items — scrollable, stops propagation so scroll doesn't flip */}
          <div
            className="min-h-0 flex-1 overflow-y-auto px-3 py-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <table className="w-full text-[9px]" style={{ tableLayout: 'fixed', borderCollapse: 'collapse' }}>
              <colgroup>
                <col style={{ width: '15%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '26%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '21%' }} />
              </colgroup>
              <tbody>
                {group.items.map((item) => {
                  const short = item.category ? (CATEGORY_META[item.category]?.short ?? '') : ''
                  const size = short.match(/\d+mm/)?.[0] ?? (item.category === 'flush-door' ? '30mm' : '')
                  const brand = shortenBrand(item.brandName ?? '')
                  const dim = item.sizeIn || (item.heightIn && item.widthIn ? `${item.heightIn}×${item.widthIn}` : '')
                  const cols = item.category
                    ? [size, brand, dim, `${item.qty} ${item.unit}`]
                    : [item.description, '', '', `${item.qty} ${item.unit}`]
                  const td = 'overflow-hidden text-ellipsis whitespace-nowrap text-stone-600 dark:text-stone-300 pb-0.5'
                  return (
                    <tr key={item.id}>
                      {cols.map((c, i) => <td key={i} className={td}>{c}</td>)}
                      <td className={`${td} text-right font-bold text-stone-800 dark:text-stone-100`}>
                        {fmtAmount(item.amount ?? 0)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Total */}
          <div className="shrink-0 border-t border-stone-200 px-3 py-2 dark:border-white/10">
            <div className="flex items-center justify-between border-b border-stone-200 pb-2 dark:border-white/10">
              <span className="text-[9px] font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                Total
              </span>
              <span className="text-[12px] font-extrabold text-stone-800 dark:text-stone-100">
                {fmtAmount(subtotal)}
              </span>
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* Select strip — full-width, easy to tap */}
      <button
        disabled={disabled}
        className={`flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-bold transition-colors ${
          selected
            ? 'bg-shiv-green text-stone-950'
            : disabled
            ? 'cursor-not-allowed border border-stone-200 bg-stone-50 text-stone-300 dark:border-white/5 dark:bg-white/5 dark:text-stone-700'
            : 'border border-stone-300 bg-stone-50 text-stone-500 dark:border-white/15 dark:bg-white/5 dark:text-stone-400'
        }`}
        onClick={onToggleSelect}
      >
        <Check size={12} strokeWidth={3} />
        {selected ? 'Selected' : 'Select'}
      </button>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function BillBrandCardsPage() {
  const { billId } = useParams<{ billId: string }>()
  const navigate = useNavigate()

  const { bills } = useStore()



  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set())

  function toggleSelect(brand: string) {
    setSelectedBrands((prev) => {
      const next = new Set(prev)
      if (next.has(brand)) {
        next.delete(brand)
      } else if (next.size < 2) {
        next.add(brand)
      }
      return next
    })
  }

  const bill = bills.find((b) => b.id === billId)

  if (!bill) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-stone-400">
        <p className="text-sm">Bill not found.</p>
        <button onClick={() => navigate(-1)} className="text-sm underline">Go back</button>
      </div>
    )
  }

  // Only plywood-group items
  const plywoodItems = bill.items.filter(
    (item) => item.category && CATEGORY_META[item.category]?.group === 'Plywoods',
  )

  // Group by brand
  const groupMap = new Map<string, BillItem[]>()
  for (const item of plywoodItems) {
    const key = item.brandName?.trim() || 'Other'
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(item)
  }
  const groups: BrandGroup[] = Array.from(groupMap.entries()).map(([brand, items]) => ({
    brand,
    items,
  }))

  const grandTotal = plywoodItems.reduce((s, i) => s + (i.amount ?? 0), 0)

  function handlePrint() {
    // Print only the name/text side — 1 slot or 2 slots depending on selection
    const printGroups = selectedBrands.size > 0
      ? groups.filter((g) => selectedBrands.has(g.brand))
      : groups.slice(0, 1)

    const x = (s: unknown) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

    const customerName = bill!.customerName ? toProperCase(bill!.customerName) : ''
    const dateStr = new Date(bill!.date).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    })

    const nameCard = (g: BrandGroup) => {
      const subtotal = g.items.reduce((s, i) => s + (i.amount ?? 0), 0)
      const td = (v: string, right = false) =>
        `<td style="font-size:6.5pt;color:${right ? '#1c1917' : '#374151'};font-weight:${right ? '700' : '400'};
          text-align:${right ? 'right' : 'left'};overflow:hidden;white-space:nowrap;
          max-width:0;padding-bottom:2pt;vertical-align:baseline">${v}</td>`

      const itemRows = `<table style="width:100%;table-layout:fixed;border-collapse:collapse">` +
        g.items.map(item => {
          const short = item.category ? (CATEGORY_META[item.category]?.short ?? '') : ''
          const size  = short.match(/\d+mm/)?.[0] ?? ''
          const brand = item.brandName ?? ''
          const dim   = item.sizeIn || (item.heightIn && item.widthIn ? `${item.heightIn}×${item.widthIn}` : '')
          const cells = item.category
            ? [size, brand, dim, `${x(item.qty)} ${x(item.unit)}`]
            : [x(item.description), '', '', `${x(item.qty)} ${x(item.unit)}`]
          return `<tr>${cells.map(c => td(c)).join('')}${td(fmtAmount(item.amount ?? 0), true)}</tr>`
        }).join('') +
        `</table>`

      return `
        <div style="
          width:54mm;height:86mm;border-radius:3.18mm;overflow:hidden;
          display:flex;flex-direction:column;font-family:Arial,sans-serif;
          background:#fff;border:0.5pt solid #ccc;
        ">
          <div style="padding:6pt 6pt 4pt;border-bottom:0.5pt solid #e5e7eb;flex-shrink:0">
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:3pt">
              ${customerName
                ? `<div style="font-size:8pt;font-weight:700;color:#1c1917;
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0">M/S ${x(customerName)}</div>`
                : '<div style="flex:1"></div>'}
              <div style="font-size:6pt;color:#a8a29e;flex-shrink:0">${dateStr}</div>
            </div>
            <div style="margin-top:2pt;display:flex;flex-direction:column;gap:1.5pt">
              ${bill!.customerPhone
                ? `<div style="font-size:6.5pt;color:#78716c">&#9990; ${x(bill!.customerPhone)}</div>`
                : ''}
              ${bill!.customerUid
                ? `<div style="font-size:6.5pt;color:#78716c">UID ${x(bill!.customerUid)}</div>`
                : ''}
            </div>
          </div>
          <div style="flex:1;overflow:hidden;padding:5pt 6pt">${itemRows}</div>
          <div style="border-top:0.5pt solid #e5e7eb;padding:3pt 6pt 5pt;flex-shrink:0">
            <div style="border-top:0.5pt solid #bbb;border-bottom:0.5pt solid #bbb;
              padding:3pt 0;display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:6.5pt;font-weight:700;text-transform:uppercase;
                letter-spacing:0.04em;color:#78716c">Total</span>
              <span style="font-size:10pt;font-weight:800;color:#1c1917">${fmtAmount(subtotal)}</span>
            </div>
          </div>
        </div>`
    }

    // Two portrait slots side by side (ID card tray style)
    const slots = printGroups.length === 2
      ? `<div style="display:flex;gap:6mm;justify-content:center;align-items:flex-start">
          ${nameCard(printGroups[0])}
          ${nameCard(printGroups[1])}
        </div>`
      : `<div style="display:flex;justify-content:center">
          ${nameCard(printGroups[0])}
        </div>`

    const html = `<!doctype html><html><head>
      <meta charset="utf-8">
      <title>ID Cards</title>
      <style>
        @page { size:A4 portrait; margin:20mm 18mm; }
        body { margin:0;padding:0;background:#fff; }
      </style>
    </head><body>${slots}</body></html>`

    const iframe = document.createElement('iframe')
    iframe.style.cssText =
      'position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:none;opacity:0;'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument!
    doc.open()
    doc.write(html)
    doc.close()
    iframe.contentWindow!.focus()
    setTimeout(() => {
      iframe.contentWindow!.print()
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe)
      }, 1200)
    }, 350)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-stone-200/80 bg-stone-50/95 px-3 py-3 shadow-sm dark:border-white/10 dark:bg-stone-950/90">
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-white/10"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-stone-900 dark:text-stone-100">
            Bill #{bill.number}
            {bill.customerName && (
              <span className="ml-1.5 text-xs font-medium text-stone-500 dark:text-stone-400">
                · {toProperCase(bill.customerName)}
              </span>
            )}
          </div>
          <div className="text-xs text-stone-400 dark:text-stone-500">
            Plywood · {fmtAmount(grandTotal)}
          </div>
        </div>
        <button
          onClick={handlePrint}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-bold text-stone-700 dark:border-white/15 dark:bg-white/5 dark:text-stone-200"
        >
          <Printer size={14} /> Print
        </button>
      </div>

      {/* Cards grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-stone-400 dark:text-stone-500">
            <p className="text-sm font-medium">No plywood items in this bill.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {groups.map((group) => (
                <BrandFlipCard
                  key={group.brand}
                  group={group}
                  bill={bill}
                  selected={selectedBrands.has(group.brand)}
                  disabled={!selectedBrands.has(group.brand) && selectedBrands.size >= 2}
                  onToggleSelect={() => toggleSelect(group.brand)}
                />
              ))}
            </div>

          </>
        )}
      </div>
    </div>
  )
}
