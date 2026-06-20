// Visual demo — shows the readymade-door rate card AND the aluminium door sheet.
import type { GuaranteeDocument, Quotation } from '../../lib/types'
import { buildBrandRows, areaSqft } from '../../lib/pricing'
import { SEED_BRANDS } from '../../lib/data/brands'
import { QuotationPrint } from './QuotationPrint'
import { GuaranteeCard } from './GuaranteeCard'

const uid = () => Math.random().toString(36).slice(2, 10)
const customer = { id: 'c1', name: 'Rajesh Kumar', mobile: '9876543210', uid: 'JH-1029', address: 'Subhash Chowk, Ramgarh Cantt' }

function doorQuote(): Quotation {
  const h = { inches: 78, soot: 0 }, w = { inches: 36, soot: 0 }
  const brands = SEED_BRANDS.filter((b) => b.category === 'readymade-door')
  return { id: uid(), number: 'SH-2026-0001', date: '2026-06-02T10:00:00.000Z', customer, category: 'readymade-door', height: h, width: w, sqft: areaSqft(h, w, 'readymade-door'), rows: buildBrandRows(brands, h, w, 1), notes: 'Rates for the above size only.' }
}

function aluQuote(): Quotation {
  const h = { inches: 81, soot: 0 }, w = { inches: 30, soot: 0 }
  return { id: uid(), number: 'SH-2026-0002', date: '2026-06-02T10:00:00.000Z', customer, category: 'aluminium-door', height: h, width: w, sqft: 0 }
}

function guaranteeDoc(): GuaranteeDocument {
  return {
    id: uid(),
    number: 'GC-2026-0001',
    date: '2026-06-02T10:00:00.000Z',
    customer,
    category: 'readymade-door',
    height: { inches: 78, soot: 0 },
    width: { inches: 36, soot: 0 },
    qty: 1,
    items: [{ brandName: 'DDoor Sunmica', guaranteeYears: 10 }],
  }
}

export function PrintDemo() {
  const door = doorQuote(), alu = aluQuote(), guarantee = guaranteeDoc()
  return (
    <div className="a4-preview-frame min-h-screen flex-col gap-8 py-8">
      <div data-doc="door"><QuotationPrint quote={door} /></div>
      <div data-doc="guarantee"><GuaranteeCard document={guarantee} /></div>
      <div data-doc="aluminium"><QuotationPrint quote={alu} /></div>
    </div>
  )
}
