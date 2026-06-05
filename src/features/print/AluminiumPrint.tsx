// Aluminium print sheet: Excel-style rate table with embedded product images.

import { Fragment } from 'react'
import type { ReactNode } from 'react'
import type { Quotation } from '../../lib/types'
import { toInches } from '../../lib/pricing'
import {
  ALU_THICKNESSES,
  doorRates,
  windowThicknessRates,
  window2TrackAreaRates,
  window3TrackAreaRates,
} from '../../lib/aluminium'
import { assetPath } from '../../lib/assets'
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
    <th colSpan={colSpan} className={`border border-black bg-[#d9d9d9] px-1.5 py-1 font-semibold ${className}`}>
      {children}
    </th>
  )
}
function Td({ children, colSpan, className = '' }: { children?: ReactNode; colSpan?: number; className?: string }) {
  return (
    <td colSpan={colSpan} className={`border border-black px-1.5 py-0.5 ${className}`}>
      {children}
    </td>
  )
}

function ProductDiagram({ hIn, wIn, image, isDoor }: { hIn: number; wIn: number; image: string; isDoor: boolean }) {
  const imgW = isDoor ? 112 : 152
  const imgH = isDoor ? 240 : 152
  const M = isDoor ? 32 : 34
  const W = imgW + M * 2
  const H = imgH + M * 2
  const wLabel = dimStr({ inches: Math.floor(wIn), soot: Math.round((wIn % 1) * 8) })
  const hLabel = dimStr({ inches: Math.floor(hIn), soot: Math.round((hIn % 1) * 8) })

  return (
    <div className="relative" style={{ width: W, height: H }}>
      <img
        src={image}
        alt=""
        className="absolute object-contain"
        style={{ left: M, top: M, width: imgW, height: imgH }}
      />
      <svg width={W} height={H} className="absolute inset-0 overflow-visible">
        <defs>
          <marker id={`arrow-end-${isDoor ? 'door' : 'window'}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#000" />
          </marker>
          <marker id={`arrow-start-${isDoor ? 'door' : 'window'}`} markerWidth="7" markerHeight="7" refX="1" refY="3.5" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 Z" fill="#000" />
          </marker>
        </defs>
        <text x={M + imgW / 2} y={18} textAnchor="middle" fontSize={17} fontFamily="Times New Roman, Times, serif">
          {wLabel}
        </text>
        <line
          x1={M}
          y1={28}
          x2={M + imgW}
          y2={28}
          stroke="#000"
          strokeWidth={1.6}
          markerStart={`url(#arrow-start-${isDoor ? 'door' : 'window'})`}
          markerEnd={`url(#arrow-end-${isDoor ? 'door' : 'window'})`}
        />
        <text
          x={18}
          y={M + imgH / 2}
          textAnchor="middle"
          fontSize={17}
          fontFamily="Times New Roman, Times, serif"
          transform={`rotate(-90,18,${M + imgH / 2})`}
        >
          {hLabel}
        </text>
        <line
          x1={28}
          y1={M}
          x2={28}
          y2={M + imgH}
          stroke="#000"
          strokeWidth={1.6}
          markerStart={`url(#arrow-start-${isDoor ? 'door' : 'window'})`}
          markerEnd={`url(#arrow-end-${isDoor ? 'door' : 'window'})`}
        />
      </svg>
    </div>
  )
}

// ---- Main component ----
export function AluminiumPrint({ quote }: { quote: Quotation }) {
  const { height, width, category } = quote
  const hIn = toInches(height)
  const wIn = toInches(width)
  const area = r2((hIn * wIn) / 144)
  const isDoor = category === 'aluminium-door'
  const is2Track = category === 'window-2-track'

  const chaukhatRft = isDoor
    ? Math.max(r2((hIn * 2 + wIn) / 12), 14.5)
    : r2((hIn * 2 + wIn) / 12)
  const selectedAddons = new Set(quote.alu?.addons ?? [])
  const hasChaukhat = selectedAddons.has('Chaukhat')
  const hasAccessories = selectedAddons.has('Accessories')
  const hasSsNet = selectedAddons.has('SS Net')
  const hasDecorFilm = selectedAddons.has('Decor Film')
  const hasBrownCoated = selectedAddons.has('Brown Coated')
  const hasAnyExtraAddon = hasSsNet || hasDecorFilm || hasBrownCoated

  const productTitle = isDoor
    ? `Bathroom Aluminium Door${hasChaukhat ? '\nWith Chaukhat' : ''}`
    : is2Track
    ? '2 Track Aluminium Sliding Window'
    : `3 Track Aluminium Sliding Window${hasSsNet ? '\nWith Half SS Net' : ''}`
  const headerImage = isDoor
    ? assetPath('assets/aluminium/header-door.jpeg')
    : assetPath('assets/aluminium/header-window.jpg')
  const productImage = isDoor
    ? assetPath('assets/aluminium/door.png')
    : is2Track
    ? assetPath('assets/aluminium/window-2-track.jpeg')
    : assetPath('assets/aluminium/window-3-track.jpeg')

  // compute per-thickness costs for doors
  const dRows = ALU_THICKNESSES.map((t) => {
    const r = doorRates[t]
    const doorCost = r0(area * r.door)
    const chaukhatCost = hasChaukhat ? r0(chaukhatRft * r.chaukhat) : 0
    const accessories = hasAccessories ? r.accessories : 0
    return {
      t,
      doorRate: r.door, doorCost,
      chaukhatRate: r.chaukhat, chaukhatCost,
      accessories,
      total: doorCost + chaukhatCost + accessories,
      decorFilmRate: r.decorFilm, decorFilm: hasDecorFilm ? r0(area * r.decorFilm) : 0,
      brownCoatedRate: r.brownCoated, brownCoated: hasBrownCoated ? r0(area * r.brownCoated) : 0,
    }
  })

  // compute per-thickness costs for windows
  const wRows = ALU_THICKNESSES.map((t) => {
    const tr = windowThicknessRates[t]
    const table = is2Track ? window2TrackAreaRates : window3TrackAreaRates
    const base = slabRate(area, table)
    const clearRate = base + tr.clear
    const clearCost = r0(area * clearRate)
    const chaukhatCost = hasChaukhat ? r0(chaukhatRft * tr.chaukhat) : 0
    return {
      t,
      clearRate, clearCost,
      chaukhatRate: tr.chaukhat, chaukhatCost,
      clearTotal: clearCost + chaukhatCost,
      ssNet: hasSsNet ? r0(area * 50) : 0,
      decorFilm: hasDecorFilm ? r0(area * 30) : 0,
      brownCoated: hasBrownCoated ? r0(area * 40) : 0,
    }
  })

  return (
    <A4Page>
      <div
        className="mx-auto pt-[24mm] text-black"
        style={{ width: '160mm', fontFamily: '"Times New Roman", Times, serif' }}
      >
        <div className="mb-[4mm] flex items-center justify-between gap-[6mm]">
          <img src={headerImage} alt="" className="block w-[86mm]" />
          <div
            className="flex min-h-[13mm] items-center border-2 border-black bg-[#d9d9d9] px-2 py-1 text-left text-[14px] leading-tight"
            style={{ width: '68mm' }}
          >
            <div>
            {productTitle.split('\n').map((line, i) => <div key={i}>{line}</div>)}
            </div>
          </div>
        </div>

      <div className="text-[14.5px] leading-tight text-black">
        {/* Info table */}
        <table className="mb-[2mm] w-full border-collapse border-2 border-black">
          <tbody>
            <tr>
              <td className="border-2 border-black bg-[#d9d9d9] px-2 py-0.5 text-right font-semibold" style={{ width: '22%' }}>Size -</td>
              <td className="border-2 border-black px-2 py-0.5 text-center font-medium">{dimStr(height)}  X  {dimStr(width)}</td>
            </tr>
            <tr>
              <td className="border-2 border-black bg-[#d9d9d9] px-2 py-0.5 text-right font-semibold">Area -</td>
              <td className="border-2 border-black px-2 py-0.5 text-center">{area} Sqft</td>
            </tr>
            {hasChaukhat && (
              <tr>
                <td className="border-2 border-black bg-[#d9d9d9] px-2 py-0.5 text-right font-semibold">Chaukhat -</td>
                <td className="border-2 border-black px-2 py-0.5 text-center">{chaukhatRft} Rft</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 7-column comparison table: label + (rate+amount) × 3 thicknesses */}
        <table className="w-full border-collapse border-2 border-black text-[14.5px]" style={{ tableLayout: 'fixed' }}>
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
                  <Td className="bg-[#d9d9d9] text-right">Door</Td>
                  {dRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td className="bg-[#d9d9d9] text-right">@{d.doorRate}</Td>
                      <Td className="text-right">{d.doorCost}</Td>
                    </Fragment>
                  ))}
                </tr>
                {hasChaukhat && (
                  <tr>
                    <Td className="bg-[#d9d9d9] text-right">Chaukhat</Td>
                    {dRows.map((d) => (
                      <Fragment key={d.t}>
                        <Td className="bg-[#d9d9d9] text-right">@{d.chaukhatRate}</Td>
                        <Td className="text-right">{d.chaukhatCost}</Td>
                      </Fragment>
                    ))}
                  </tr>
                )}
                {hasAccessories && (
                  <tr>
                    <Td className="bg-[#d9d9d9] text-right">Accessories</Td>
                    {dRows.map((d) => (
                      <Fragment key={d.t}>
                        <Td />
                        <Td className="text-right">{d.accessories}</Td>
                      </Fragment>
                    ))}
                  </tr>
                )}
                <tr>
                  <Td className="bg-[#d9d9d9] text-right">Total</Td>
                  {dRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td />
                      <Td className="text-right font-bold">{d.total}</Td>
                    </Fragment>
                  ))}
                </tr>
                {(hasDecorFilm || hasBrownCoated) && <tr><Td colSpan={7}>Add-ons</Td></tr>}
                {hasDecorFilm && (
                  <tr>
                    <Td className="bg-[#d9d9d9] text-right">Décor Film</Td>
                    {dRows.map((d) => (
                      <Fragment key={d.t}>
                        <Td className="bg-[#d9d9d9] text-right">@{d.decorFilmRate}</Td>
                        <Td className="text-right">{d.decorFilm}</Td>
                      </Fragment>
                    ))}
                  </tr>
                )}
                {hasBrownCoated && (
                  <tr>
                    <Td className="bg-[#d9d9d9] text-right">Brown Coated</Td>
                    {dRows.map((d) => (
                      <Fragment key={d.t}>
                        <Td className="bg-[#d9d9d9] text-right">@{d.brownCoatedRate}</Td>
                        <Td className="text-right">{d.brownCoated}</Td>
                      </Fragment>
                    ))}
                  </tr>
                )}
              </>
            ) : (
              <>
                <tr>
                  <Td className="bg-[#d9d9d9] text-right">Glass</Td>
                  {wRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td className="bg-[#d9d9d9] text-right">@{d.clearRate}</Td>
                      <Td className="text-right">{d.clearCost}</Td>
                    </Fragment>
                  ))}
                </tr>
                {hasChaukhat && (
                  <tr>
                    <Td className="bg-[#d9d9d9] text-right">Chaukhat</Td>
                    {wRows.map((d) => (
                      <Fragment key={d.t}>
                        <Td className="bg-[#d9d9d9] text-right">@{d.chaukhatRate}</Td>
                        <Td className="text-right">{d.chaukhatCost}</Td>
                      </Fragment>
                    ))}
                  </tr>
                )}
                <tr>
                  <Td className="bg-[#d9d9d9] text-right font-bold">Total</Td>
                  {wRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td />
                      <Td className="text-right font-bold">{d.clearTotal}</Td>
                    </Fragment>
                  ))}
                </tr>
                {hasAnyExtraAddon && <tr><Td colSpan={7}>Add-ons</Td></tr>}
                {hasSsNet && (
                  <tr>
                    <Td className="bg-[#d9d9d9] text-right">SS Net</Td>
                    {wRows.map((d) => (
                      <Fragment key={d.t}>
                        <Td className="bg-[#d9d9d9] text-right">@50</Td>
                        <Td className="text-right">{d.ssNet}</Td>
                      </Fragment>
                    ))}
                  </tr>
                )}
                {hasDecorFilm && (
                  <tr>
                    <Td className="bg-[#d9d9d9] text-right">Décor Film</Td>
                    {wRows.map((d) => (
                      <Fragment key={d.t}>
                        <Td className="bg-[#d9d9d9] text-right">@30</Td>
                        <Td className="text-right">{d.decorFilm}</Td>
                      </Fragment>
                    ))}
                  </tr>
                )}
                {hasBrownCoated && (
                  <tr>
                    <Td className="bg-[#d9d9d9] text-right">Brown Coated</Td>
                    {wRows.map((d) => (
                      <Fragment key={d.t}>
                        <Td className="bg-[#d9d9d9] text-right">@40</Td>
                        <Td className="text-right">{d.brownCoated}</Td>
                      </Fragment>
                    ))}
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>

        {/* Diagram */}
        <div className="mt-[5mm] flex justify-center">
          <ProductDiagram hIn={hIn} wIn={wIn} image={productImage} isDoor={isDoor} />
        </div>
      </div>
      </div>
    </A4Page>
  )
}
