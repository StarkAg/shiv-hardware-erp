// ── The shop's letterhead, as every sheet the app prints has it ─────────────
//
// The visit order (VisitSlip.jsx) and the work order (PadSheet.jsx) both open
// with it: the logo and name, the address, GSTIN and numbers, then what the
// shop deals in and installs.

const DEALS = 'Plywood, Flush Door, Laminates, PVC & Acrylic Hi-Gloss Laminates, Adhesive, Hardware, Aluminium & Stainless Steel Architectural Section, Wooden & WPC Chowket, Gypsum False Ceiling, WPC Grill, Modular Kitchen Accessories, All types of Wooden Bit, Decorative wall Panel & General Order Suppliers.'
const INSTALLS = 'Aluminium Door & Window, UPVC Door & Window, Stainless Steel Railing, Wooden & Readymade Door, PVC / FRP / Rajshree Bathroom Door, Mosquito Solution in Door & Window, PVC & Wooden Flooring, Only 2\' x 2\' Gypsum False Ceiling, Wall Paper, ACP & Glass work in Exterior Wall.'

/** dd-mm-yy, as the sheets are dated. */
export const sheetDate = (key) => {
  const [y, m, d] = String(key ?? '').split('-')
  return d && m && y ? `${d}-${m}-${y.slice(-2)}` : ''
}

/** "M/s" once, however the name was typed. */
export const addressed = (name) => {
  const bare = String(name ?? '').trim().replace(/^m\s*\/?\s*s\.?\s*/i, '')
  return bare ? `M/s ${bare}` : ''
}

export function Letterhead() {
  return (
    <>
      <header className="sliphead">
        <img className="sliplogo" src="/shiv-logo.png" alt="" />
        <div className="slipshop">
          <b>Shiv Hardware Store</b>
          <span>Shivaji Road, Near Gandhi High School, Ramgarh Cantt. 829122</span>
        </div>
        <dl className="slipcontact">
          <div><dt>GSTIN</dt><dd>20AGEPG3564B1Z6</dd></div>
          <div><dt>Tony</dt><dd>8092850954</dd></div>
          <div><dt>Shop</dt><dd>9835350954</dd></div>
        </dl>
      </header>
      <div className="slipdeals">
        <p><b>Deals in</b>{DEALS}</p>
        <p><b>Installation</b>{INSTALLS}</p>
      </div>
    </>
  )
}
