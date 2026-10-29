// Aluminium print sheet: Excel-style rate table with embedded product images.

import { Fragment } from 'react'
import type { ReactNode } from 'react'
import type { Quotation } from '../../lib/types'
import {
  ALU_THICKNESSES,
  doorRates,
  toAluminiumExcelInches,
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

type DiagramKind = 'door' | 'window2' | 'window3'

const excelDiagram: Record<DiagramKind, {
  groupW: number
  groupH: number
  imageX: number
  imageY: number
  imageW: number
  imageH: number
  hLineX: number
  hLineY: number
  hLineW: number
  vLineX: number
  vLineY: number
  vLineH: number
}> = {
  door: { groupW: 219, groupH: 318, imageX: 16, imageY: 12, imageW: 203, imageH: 306, hLineX: 15, hLineY: 0, hLineW: 202, vLineX: 0, vLineY: 13, vLineH: 305 },
  window2: { groupW: 237, groupH: 250, imageX: 16, imageY: 16, imageW: 221, imageH: 234, hLineX: 14, hLineY: 0, hLineW: 223, vLineX: 0, vLineY: 19, vLineH: 230 },
  window3: { groupW: 238, groupH: 262, imageX: 14, imageY: 15, imageW: 224, imageH: 248, hLineX: 15, hLineY: 0, hLineW: 223, vLineX: 0, vLineY: 16, vLineH: 243 },
}

function ProductDiagram({ hIn, wIn, image, kind }: { hIn: number; wIn: number; image: string; kind: DiagramKind }) {
  const d = excelDiagram[kind]
  const groupX = 42
  const groupY = 38
  const W = groupX + d.groupW + 6
  const H = groupY + d.groupH + 2
  const wLabel = dimStr({ inches: Math.floor(wIn), soot: Math.round((wIn % 1) * 8) })
  const hLabel = dimStr({ inches: Math.floor(hIn), soot: Math.round((hIn % 1) * 8) })
  const markerId = kind

  return (
    <div className="relative" style={{ width: W, height: H }}>
      <img
        src={image}
        alt=""
        className="absolute"
        style={{ left: groupX + d.imageX, top: groupY + d.imageY, width: d.imageW, height: d.imageH }}
      />
      <svg width={W} height={H} className="absolute inset-0 overflow-visible">
        <defs>
          <marker id={`arrow-end-${markerId}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="#000" />
          </marker>
          <marker id={`arrow-start-${markerId}`} markerWidth="7" markerHeight="7" refX="1" refY="3.5" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 Z" fill="#000" />
          </marker>
        </defs>
        <text x={groupX + d.hLineX + d.hLineW / 2} y={20} textAnchor="middle" fontSize={17} fontFamily="Times New Roman, Times, serif">
          {wLabel}
        </text>
        <line
          x1={groupX + d.hLineX}
          y1={groupY + d.hLineY}
          x2={groupX + d.hLineX + d.hLineW}
          y2={groupY + d.hLineY}
          stroke="#000"
          strokeWidth={1.6}
          markerStart={`url(#arrow-start-${markerId})`}
          markerEnd={`url(#arrow-end-${markerId})`}
        />
        <text
          x={12}
          y={groupY + d.vLineY + d.vLineH / 2}
          textAnchor="middle"
          fontSize={17}
          fontFamily="Times New Roman, Times, serif"
        >
          {hLabel}
        </text>
        <line
          x1={groupX + d.vLineX}
          y1={groupY + d.vLineY}
          x2={groupX + d.vLineX}
          y2={groupY + d.vLineY + d.vLineH}
          stroke="#000"
          strokeWidth={1.6}
          markerStart={`url(#arrow-start-${markerId})`}
          markerEnd={`url(#arrow-end-${markerId})`}
        />
      </svg>
    </div>
  )
}

// ---- Main component ----
export function AluminiumPrint({ quote }: { quote: Quotation }) {
  const { height, width, category } = quote
  const hIn = toAluminiumExcelInches(height)
  const wIn = toAluminiumExcelInches(width)
  const diagramHIn = Number(height.inches || 0) + Number(height.soot || 0) / 8
  const diagramWIn = Number(width.inches || 0) + Number(width.soot || 0) / 8
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
  const hasWindowSsNet = is2Track && hasSsNet
  const hasAnyWindowAddon = hasWindowSsNet || hasBrownCoated

  const productTitle = isDoor
    ? `Bathroom Aluminium Door${hasChaukhat ? '\nWith Chaukhat' : ''}`
    : is2Track
    ? '2 Track Aluminium Sliding Window'
    : '3 Track Aluminium Sliding Window\nWith Half SS Net'
  const headerImage = isDoor
    ? assetPath('assets/aluminium/header-door.jpeg')
    : assetPath('assets/aluminium/header-window.jpg')
  const productImage = isDoor
    ? assetPath('assets/aluminium/door.png')
    : is2Track
    ? assetPath('assets/aluminium/window-2-track.jpeg')
    : assetPath('assets/aluminium/window-3-track.jpeg')
  const diagramKind: DiagramKind = isDoor ? 'door' : is2Track ? 'window2' : 'window3'

  // The prices the quotation was made with. Since aluminium is costed from
  // its materials (lib/aluCosting) they are saved on the quotation, so a
  // reprint says what the customer was told even after the rates move. Only
  // a quotation with none saved is priced from the old rate tables below.
  const saved = quote.alu?.thicknesses?.length === ALU_THICKNESSES.length ? quote.alu.thicknesses : null

  // compute per-thickness costs for doors
  const dRows = saved && isDoor ? saved.map((r) => ({
    t: r.name,
    doorRate: r.doorRate, doorCost: r.doorCost,
    chaukhatRate: r.chaukhatRate, chaukhatCost: hasChaukhat ? r.chaukhatCost : 0,
    accessories: hasAccessories ? r.accessories : 0,
    total: r.doorCost + (hasChaukhat ? r.chaukhatCost : 0) + (hasAccessories ? r.accessories : 0),
    decorFilmRate: r.decorFilmRate, decorFilm: hasDecorFilm ? r.decorFilm : 0,
    brownCoatedRate: r.brownCoatedRate ?? 0, brownCoated: hasBrownCoated ? r.brownCoated ?? 0 : 0,
  })) : ALU_THICKNESSES.map((t) => {
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
  const wRows = saved && !isDoor ? saved.map((r) => {
    const clearRate = r.glassRate ?? r.doorRate
    const clearCost = r.glassCost ?? r.doorCost
    return {
      t: r.name,
      clearRate, clearCost,
      reflectiveRate: r.reflectiveRate ?? 0, reflectiveCost: r.reflectiveCost ?? 0,
      chaukhatRate: r.chaukhatRate, chaukhatCost: 0,
      clearTotal: clearCost,
      ssNet: hasWindowSsNet ? r.accessories : 0,
      decorFilm: hasDecorFilm ? r.decorFilm : 0,
      brownCoated: hasBrownCoated ? r.brownCoated ?? 0 : 0,
    }
  }) : ALU_THICKNESSES.map((t) => {
    const tr = windowThicknessRates[t]
    const table = is2Track ? window2TrackAreaRates : window3TrackAreaRates
    const base = slabRate(area, table)
    const clearRate = base + tr.clear
    const clearCost = r0(area * clearRate)
    const reflectiveRate = base + tr.reflective
    const reflectiveCost = r0(area * reflectiveRate)
    const chaukhatCost = hasChaukhat ? r0(chaukhatRft * tr.chaukhat) : 0
    return {
      t,
      clearRate, clearCost,
      reflectiveRate, reflectiveCost,
      chaukhatRate: tr.chaukhat, chaukhatCost,
      clearTotal: clearCost + chaukhatCost,
      ssNet: hasWindowSsNet ? r0(area * 50) : 0,
      decorFilm: hasDecorFilm ? r0(area * 30) : 0,
      brownCoated: hasBrownCoated ? r0(area * 40) : 0,
    }
  })

  return (
    <A4Page>
      <div
        className="mx-auto pt-[46mm] text-black"
        style={{ width: '160mm', fontFamily: '"Times New Roman", Times, serif' }}
      >
        <div className="mb-[1.5mm] flex items-center justify-between gap-[6mm]">
          <img src={headerImage} alt="" className="block" style={{ width: '83.4mm', height: '45mm' }} />
          <div
            className="flex min-h-[11.5mm] items-center border-2 border-black bg-[#d9d9d9] px-2 py-1 text-left text-[14pt] leading-[1.05]"
            style={{ width: '64mm' }}
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
            {isDoor && hasChaukhat && (
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
                  <Td className="bg-[#d9d9d9] text-right">4 MM Clear &amp; Texture Glass</Td>
                  {wRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td className="bg-[#d9d9d9] text-right">@{d.clearRate}</Td>
                      <Td className="text-right">{d.clearCost}</Td>
                    </Fragment>
                  ))}
                </tr>
                <tr>
                  <Td className="bg-[#d9d9d9] text-right">4 MM Reflective Glass</Td>
                  {wRows.map((d) => (
                    <Fragment key={d.t}>
                      <Td className="bg-[#d9d9d9] text-right">@{d.reflectiveRate}</Td>
                      <Td className="text-right">{d.reflectiveCost}</Td>
                    </Fragment>
                  ))}
                </tr>
                {hasAnyWindowAddon && <tr><Td colSpan={7}>Add-ons</Td></tr>}
                {hasWindowSsNet && (
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
          <ProductDiagram hIn={diagramHIn} wIn={diagramWIn} image={productImage} kind={diagramKind} />
        </div>
      </div>
      </div>
    </A4Page>
  )
}
