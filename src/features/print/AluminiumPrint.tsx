// Aluminium print sheet — matches the PDF layout exactly:
// compact phone header · all 3 thicknesses side by side · add-ons · SVG diagram.

import { Fragment } from 'react'
import type { ReactNode } from 'react'
import type { Quotation } from '../../lib/types'
import { SHOP } from '../../lib/types'
import { toInches } from '../../lib/pricing'
import {
  ALU_THICKNESSES,
  doorRates,
  windowThicknessRates,
  window2TrackAreaRates,
  window3TrackAreaRates,
} from '../../lib/aluminium'
import { A4Page } from './A4Page'

const r0 = (n: number) => Math.round(n)
const r2 = (n: number) => Math.round(n * 100) / 100

function slabRate(area: number, table: { area: number; rate: number }[]) {
  const sorted = [...table].sort((a, b) => b.area - a.area)
  for (const row of sorted) if (area >= row.area) return row.rate
  return sorted[sorted.length - 1].rate
}

// "81 ''" or "81 4/8 ''"
function dimStr(d: { inches: number; soot: number }) {
  return d.soot ? `${d.inches} ${d.soot}/8 ''` : `${d.inches} ''`
}

// ---- shared table cell helpers ----
function Th({ children, colSpan, className = '' }: { children?: ReactNode; colSpan?: number; className?: string }) {
  return (
    <th colSpan={colSpan} className={`border border-black px-1.5 py-1 font-semibold bg-slate-100 ${className}`}>
      {children}
    </th>
  )
}
function Td({ children, colSpan, className = '' }: { children?: ReactNode; colSpan?: number; className?: string }) {
  return (
    <td colSpan={colSpan} className={`border border-black px-1.5 py-1 ${className}`}>
      {children}
    </td>
  )
}

// ---- Door SVG diagram (matching PDF) ----
function DoorDiagram({ hIn, wIn }: { hIn: number; wIn: number }) {
  const DW = 88, DH = 148, M = 30, W = DW + M * 2, H = DH + M * 2
  const wLabel = dimStr({ inches: Math.floor(wIn), soot: Math.round((wIn % 1) * 8) })
  const hLabel = dimStr({ inches: Math.floor(hIn), soot: Math.round((hIn % 1) * 8) })
  return (
    <svg width={W} height={H} style={{ fontFamily: 'Arial', overflow: 'visible' }}>
      <defs>
        <marker id="da" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="#000" />
        </marker>
        <marker id="das" markerWidth="7" markerHeight="7" refX="1" refY="3.5" orient="auto-start-reverse">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="#000" />
        </marker>
      </defs>
      {/* Width */}
      <text x={M + DW / 2} y={13} textAnchor="middle" fontSize={10.5}>{wLabel}</text>
      <line x1={M} y1={19} x2={M + DW} y2={19} stroke="#000" strokeWidth={1} markerStart="url(#das)" markerEnd="url(#da)" />
      {/* Height */}
      <text x={13} y={M + DH / 2} textAnchor="middle" fontSize={10.5} transform={`rotate(-90,13,${M + DH / 2})`}>{hLabel}</text>
      <line x1={21} y1={M} x2={21} y2={M + DH} stroke="#000" strokeWidth={1} markerStart="url(#das)" markerEnd="url(#da)" />
      {/* Door body */}
      <rect x={M} y={M} width={DW} height={DH} fill="#ddd" stroke="#000" strokeWidth={1.5} />
      {/* Horizontal split at ~42% */}
      <line x1={M} y1={M + DH * 0.42} x2={M + DW} y2={M + DH * 0.42} stroke="#000" strokeWidth={0.8} />
      {/* Hinges */}
      <rect x={M + 1} y={M + 10} width={5} height={9} fill="#777" />
      <rect x={M + 1} y={M + DH * 0.55} width={5} height={9} fill="#777" />
      {/* Handle (lower panel, right side) */}
      <rect x={M + DW - 8} y={M + DH * 0.62} width={5} height={14} fill="#777" />
    </svg>
  )
}

// ---- Window SVG diagram ----
function WindowDiagram({ hIn, wIn, tracks }: { hIn: number; wIn: number; tracks: 2 | 3 }) {
  const DW = 130, DH = 88, M = 30, W = DW + M * 2, H = DH + M * 2
  const wLabel = dimStr({ inches: Math.floor(wIn), soot: Math.round((wIn % 1) * 8) })
  const hLabel = dimStr({ inches: Math.floor(hIn), soot: Math.round((hIn % 1) * 8) })
  return (
    <svg width={W} height={H} style={{ fontFamily: 'Arial', overflow: 'visible' }}>
      <defs>
        <marker id="wa" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="#000" />
        </marker>
        <marker id="was" markerWidth="7" markerHeight="7" refX="1" refY="3.5" orient="auto-start-reverse">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="#000" />
        </marker>
      </defs>
      <text x={M + DW / 2} y={13} textAnchor="middle" fontSize={10.5}>{wLabel}</text>
      <line x1={M} y1={19} x2={M + DW} y2={19} stroke="#000" strokeWidth={1} markerStart="url(#was)" markerEnd="url(#wa)" />
      <text x={13} y={M + DH / 2} textAnchor="middle" fontSize={10.5} transform={`rotate(-90,13,${M + DH / 2})`}>{hLabel}</text>
      <line x1={21} y1={M} x2={21} y2={M + DH} stroke="#000" strokeWidth={1} markerStart="url(#was)" markerEnd="url(#wa)" />
      {/* Frame */}
      <rect x={M} y={M} width={DW} height={DH} fill="#c8dff0" stroke="#000" strokeWidth={1.5} />
      {/* Panel dividers */}
      {Array.from({ length: tracks - 1 }, (_, i) => (
        <line key={i}
          x1={M + (DW / tracks) * (i + 1)} y1={M}
          x2={M + (DW / tracks) * (i + 1)} y2={M + DH}
          stroke="#000" strokeWidth={0.8} />
      ))}
    </svg>
  )
}

// ---- Main component ----
export function AluminiumPrint({ quote }: { quote: Quotation }) {
  const { height, width, category, qty } = quote
  const hIn = toInches(height)
  const wIn = toInches(width)
  const area = r2((hIn * wIn) / 144)
  const isDoor = category === 'aluminium-door'
  const is2Track = category === 'window-2-track'

  const chaukhatRft = isDoor
    ? Math.max(r2((hIn * 2 + wIn) / 12), 14.5)
    : r2((hIn * 2 + wIn) / 12)

  const productTitle = isDoor
    ? 'Bathroom Aluminium Door\nWith Chaukhat'
    : is2Track
    ? '2 Track Aluminium Sliding Window'
    : '3 Track Aluminium Sliding Window\nWith Half SS Net'

  // compute per-thickness costs for doors
  const dRows = ALU_THICKNESSES.map((t) => {
    const r = doorRates[t]
    const doorCost = r0(area * r.door)
    const chaukhatCost = r0(chaukhatRft * r.chaukhat)
    return {
      t,
      doorRate: r.door, doorCost,
      chaukhatRate: r.chaukhat, chaukhatCost,
      accessories: r.accessories,
      total: doorCost + chaukhatCost + r.accessories,
      decorFilmRate: r.decorFilm, decorFilm: r0(area * r.decorFilm),
      brownCoatedRate: r.brownCoated, brownCoated: r0(area * r.brownCoated),
    }
  })

  // compute per-thickness costs for windows
  const wRows = ALU_THICKNESSES.map((t) => {
    const tr = windowThicknessRates[t]
    const table = is2Track ? window2TrackAreaRates : window3TrackAreaRates
    const base = slabRate(area, table)
    const clearRate = base + tr.clear
    const reflectiveRate = base + tr.reflective
    const clearCost = r0(area * clearRate)
    const reflectiveCost = r0(area * reflectiveRate)
    const chaukhatCost = r0(chaukhatRft * tr.chaukhat)
    return {
      t,
      clearRate, clearCost,
      reflectiveRate, reflectiveCost,
      chaukhatRate: tr.chaukhat, chaukhatCost,
      clearTotal: clearCost + chaukhatCost,
      reflectiveTotal: reflectiveCost + chaukhatCost,
      ssNet: r0(area * 50),
      decorFilm: r0(area * 30),
      brownCoated: r0(area * 40),
    }
  })

  return (
    <A4Page>
      {/* Compact header — matches PDF: phones left, logo+address below, product box right */}
      <div className="flex items-start justify-between px-[8mm] pt-[5mm] pb-[3mm] font-print">
        <div>
          {SHOP.phones.map((p) => (
            <div key={p.label} className="text-[17px] font-bold leading-snug">
              {p.number}{' '}
              <span className="text-[13px] font-normal italic">{p.label}</span>
            </div>
          ))}
          <div className="mt-2 flex items-center gap-2">
            <img src="/assets/letterhead/shiv-logo.png" alt="" className="h-10 w-10 object-contain" />
            <div className="text-[11px] leading-tight">
              <div className="text-[12px] font-bold">{SHOP.name}</div>
              <div>Shivaji Road, Near Gandhi High School</div>
              <div>Ramgarh Cantt – 829122, Jharkhand</div>
            </div>
          </div>
        </div>
        <div className="mt-1 border border-black px-3 py-2 text-[13px] font-semibold text-center" style={{ maxWidth: '42%' }}>
          {productTitle.split('\n').map((line, i) => <div key={i}>{line}</div>)}
        </div>
      </div>

      <div className="px-[8mm] font-print text-[12.5px] text-black">
        {/* Info table */}
        <table className="w-full border-collapse border border-black mb-2">
          <tbody>
            <tr>
              <td className="border border-black px-2 py-1 text-right font-semibold" style={{ width: '22%' }}>Size -</td>
              <td className="border border-black px-2 py-1">{dimStr(height)}  X  {dimStr(width)}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 text-right font-semibold">Area -</td>
              <td className="border border-black px-2 py-1">{area} Sqft</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 text-right font-semibold">Chaukhat -</td>
              <td className="border border-black px-2 py-1">{chaukhatRft} Rft</td>
            </tr>
          </tbody>
        </table>

        {/* 7-column comparison table: label + (rate+amount) × 3 thicknesses */}
        <table className="w-full border-collapse border border-black text-[12px]" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '22%' }} />
            {ALU_THICKNESSES.map((_, i) => (
              <Fragment key={i}>
                <col style={{ width: '9%' }} />
                <col style={{ width: '14.33%' }} />
              </Fragment>
            ))}
          </colgroup>
          <thead>
            <tr>
              <Th>Thickness -</Th>
              {ALU_THICKNESSES.map((t) => (
                <Th key={t} colSpan={2} className="text-center">{t}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isDoor ? (
              <>
                <tr>
                  <Td className="text-right">Door</Td>
                  {dRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td className="text-right text-slate-600">@{d.doorRate}</Td>
                      <Td className="text-right">{d.doorCost}</Td>
                    </Fragment>
                  ))}
                </tr>
                <tr>
                  <Td className="text-right">Chaukhat</Td>
                  {dRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td className="text-right text-slate-600">@{d.chaukhatRate}</Td>
                      <Td className="text-right">{d.chaukhatCost}</Td>
                    </Fragment>
                  ))}
                </tr>
                <tr>
                  <Td className="text-right">Accessories</Td>
                  {dRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td />
                      <Td className="text-right">{d.accessories}</Td>
                    </Fragment>
                  ))}
                </tr>
                <tr>
                  <Td className="text-center font-bold">Total</Td>
                  {dRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td />
                      <Td className="text-right font-bold">{d.total}{qty > 1 ? ` ×${qty}` : ''}</Td>
                    </Fragment>
                  ))}
                </tr>
                <tr>
                  <Td colSpan={7} className="font-semibold">Add-ons</Td>
                </tr>
                <tr>
                  <Td className="text-right">Décor Film</Td>
                  {dRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td className="text-right text-slate-600">@{d.decorFilmRate}</Td>
                      <Td className="text-right">{d.decorFilm}</Td>
                    </Fragment>
                  ))}
                </tr>
                <tr>
                  <Td className="text-right">Brown Coated</Td>
                  {dRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td className="text-right text-slate-600">@{d.brownCoatedRate}</Td>
                      <Td className="text-right">{d.brownCoated}</Td>
                    </Fragment>
                  ))}
                </tr>
              </>
            ) : (
              <>
                <tr>
                  <Td className="text-right">Glass (Clear)</Td>
                  {wRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td className="text-right text-slate-600">@{d.clearRate}</Td>
                      <Td className="text-right">{d.clearCost}</Td>
                    </Fragment>
                  ))}
                </tr>
                <tr>
                  <Td className="text-right">Glass (Reflective)</Td>
                  {wRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td className="text-right text-slate-600">@{d.reflectiveRate}</Td>
                      <Td className="text-right">{d.reflectiveCost}</Td>
                    </Fragment>
                  ))}
                </tr>
                <tr>
                  <Td className="text-right">Chaukhat</Td>
                  {wRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td className="text-right text-slate-600">@{d.chaukhatRate}</Td>
                      <Td className="text-right">{d.chaukhatCost}</Td>
                    </Fragment>
                  ))}
                </tr>
                <tr>
                  <Td className="text-center font-bold">Total (Clear)</Td>
                  {wRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td />
                      <Td className="text-right font-bold">{d.clearTotal}</Td>
                    </Fragment>
                  ))}
                </tr>
                <tr>
                  <Td className="text-center font-bold">Total (Refl.)</Td>
                  {wRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td />
                      <Td className="text-right font-bold">{d.reflectiveTotal}</Td>
                    </Fragment>
                  ))}
                </tr>
                <tr>
                  <Td colSpan={7} className="font-semibold">Add-ons</Td>
                </tr>
                <tr>
                  <Td className="text-right">SS Net</Td>
                  {wRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td className="text-right text-slate-600">@50</Td>
                      <Td className="text-right">{d.ssNet}</Td>
                    </Fragment>
                  ))}
                </tr>
                <tr>
                  <Td className="text-right">Décor Film</Td>
                  {wRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td className="text-right text-slate-600">@30</Td>
                      <Td className="text-right">{d.decorFilm}</Td>
                    </Fragment>
                  ))}
                </tr>
                <tr>
                  <Td className="text-right">Brown Coated</Td>
                  {wRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td className="text-right text-slate-600">@40</Td>
                      <Td className="text-right">{d.brownCoated}</Td>
                    </Fragment>
                  ))}
                </tr>
              </>
            )}
          </tbody>
        </table>

        {/* Diagram */}
        <div className="mt-4 flex justify-center">
          {isDoor
            ? <DoorDiagram hIn={hIn} wIn={wIn} />
            : <WindowDiagram hIn={hIn} wIn={wIn} tracks={is2Track ? 2 : 3} />}
        </div>
      </div>
    </A4Page>
  )
}
