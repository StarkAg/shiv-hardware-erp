// UPVC print sheet — mirrors Latest/UPVC Rates.xlsm print preview: shop header,
// title box, Size/Area rows, then a bordered brand matrix (Prominance/DDoor/Simta).
import type { Quotation, Dimension } from '../../lib/types'
import { CATEGORY_LABELS } from '../../lib/types'
import { assetPath } from '../../lib/assets'
import { A4Page } from './A4Page'

function dimStr(d: Dimension) {
  return d.soot ? `${d.inches} ${d.soot}/8''` : `${d.inches}''`
}
const r0 = (n: number) => Math.round(n)

export function UpvcPrint({ quote }: { quote: Quotation }) {
  const brands = quote.alu?.thicknesses ?? []
  const isDoor = quote.category === 'upvc-door'
  const sizeLabel = `${dimStr(quote.height)}  X  ${dimStr(quote.width)}`

  return (
    <A4Page>
      <div className="relative h-[297mm] w-[210mm] font-[Arial] text-black">
        <img
          src={assetPath('assets/aluminium/header-door.jpeg')}
          alt=""
          className="absolute left-[27.94mm] top-[22.47mm] block h-[53.53mm] w-[88.06mm]"
        />
        <div className="absolute right-[12mm] top-[32mm] flex h-[18mm] w-[78mm] items-center border-2 border-black px-3 text-[16pt] leading-tight">
          {CATEGORY_LABELS[quote.category]}
        </div>

        <div className="absolute left-[12mm] right-[12mm] top-[88mm] text-[14pt]">
          {/* Size / Area rows */}
          <table className="w-full border-collapse">
            <tbody>
              <tr>
                <td className="w-[40mm] border-2 border-black bg-[#d9d9d9] px-2 py-1 text-right font-semibold">Size -</td>
                <td className="border-2 border-black px-2 py-1 text-center">{sizeLabel}</td>
              </tr>
              <tr>
                <td className="border-2 border-black bg-[#d9d9d9] px-2 py-1 text-right font-semibold">Area -</td>
                <td className="border-2 border-black px-2 py-1 text-center">{quote.sqft.toFixed(2)} Sqft</td>
              </tr>
            </tbody>
          </table>

          {/* Brand matrix */}
          <table className="mt-[2mm] w-full border-collapse text-[13pt]">
            <thead>
              <tr>
                <td className="w-[40mm] border-2 border-black bg-[#d9d9d9] px-2 py-1.5 font-semibold">Brand -</td>
                {brands.map((b) => (
                  <td key={b.name} colSpan={2} className="border-2 border-black bg-[#d9d9d9] px-2 py-1.5 text-center font-semibold">
                    {b.name}
                  </td>
                ))}
              </tr>
            </thead>
            <tbody>
              {isDoor ? (
                <>
                  <tr>
                    <td className="border-2 border-black bg-[#d9d9d9] px-2 py-1.5 text-right font-semibold">Door With Chaukhat</td>
                    {brands.map((b) => (
                      <Cell key={b.name} rate={b.doorRate} cost={b.doorCost} />
                    ))}
                  </tr>
                  <tr>
                    <td className="border-2 border-black bg-[#d9d9d9] px-2 py-1.5 text-right font-semibold">Accessories</td>
                    {brands.map((b) => (
                      <td key={b.name} colSpan={2} className="border-2 border-black px-2 py-1.5 text-center">{b.accessories || 0}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="border-2 border-black bg-[#d9d9d9] px-2 py-1.5 text-right font-semibold">Total</td>
                    {brands.map((b) => (
                      <td key={b.name} colSpan={2} className="border-2 border-black px-2 py-1.5 text-center font-semibold">{r0(b.total)}</td>
                    ))}
                  </tr>
                </>
              ) : (
                <>
                  <tr>
                    <td className="border-2 border-black bg-[#d9d9d9] px-2 py-1.5 text-right font-semibold">5 MM Clear &amp; Texture Glass</td>
                    {brands.map((b) => (
                      <Cell key={b.name} rate={b.glassRate ?? b.doorRate} cost={b.glassCost ?? b.doorCost} />
                    ))}
                  </tr>
                  <tr>
                    <td className="border-2 border-black bg-[#d9d9d9] px-2 py-1.5 text-right font-semibold">5 MM Reflective Glass</td>
                    {brands.map((b) => (
                      <Cell key={b.name} rate={b.reflectiveRate ?? 0} cost={b.reflectiveCost ?? 0} />
                    ))}
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </A4Page>
  )
}

function Cell({ rate, cost }: { rate?: number; cost?: number }) {
  return (
    <>
      <td className="w-[16mm] border-2 border-black px-2 py-1.5">@{rate ?? 0}</td>
      <td className="w-[18mm] border-2 border-black px-2 py-1.5 text-right font-semibold">{r0(cost ?? 0)}</td>
    </>
  )
}
