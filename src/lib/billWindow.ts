import type { Bill } from './types'
import { buildBillHtml } from './billHtml'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/**
 * On screen the bill's pages sit centred on the desk colour under a bar with
 * its name and Print, and the window scrolls to a second page. On paper none
 * of this applies: the bar is gone and the bill prints as it always does.
 */
const ON_SCREEN = `
  @media screen {
    html, body { width: auto !important; overflow: auto !important; background: #ddd7cb !important; }
    body > div { margin: 16px auto !important; box-shadow: 0 2px 12px #0003; }
    body > .billwin-bar { position: sticky; top: 0; z-index: 1; margin: 0 !important; box-shadow: none;
      display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 14px;
      background: #f3f0ea; border-bottom: 1px solid #d4cbbb; font: 700 14px system-ui, sans-serif; color: #29251e; }
    .billwin-bar span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .billwin-bar button { flex: none; padding: 8px 16px; border: 0; border-radius: 8px; background: #b98f4b;
      color: #1c1917; font: inherit; cursor: pointer; }
  }
  @media print { .billwin-bar { display: none !important; } }
`

/**
 * The bill, as it prints, in a window of its own: to keep beside the list it
 * was opened from, or the guarantee card being made out of it.
 *
 * The same `buildBillHtml` the preview and the printer use, written straight
 * into a blank window, so it needs no page of the app behind it and works the
 * same in the panel and the counter. One window per bill: opening the same
 * bill again brings its window back rather than adding another.
 *
 * False when no window could be opened (pop-ups blocked, or a desktop app from
 * before it allowed one), so the caller can show the bill where it stands.
 */
export function openBillWindow(bill: Bill): boolean {
  const title = (bill.number ? `Bill ${bill.number}` : 'Bill') + (bill.customerName ? ` · ${bill.customerName}` : '')
  const page = buildBillHtml(bill)
    .replace('</head>', () => `<title>${esc(title)}</title><style>${ON_SCREEN}</style></head>`)
    .replace('<body>', () => `<body><div class="billwin-bar"><span>${esc(title)}</span><button type="button" onclick="window.print()">Print</button></div>`)
  const win = window.open('', `bill-${bill.id}`, 'popup,width=660,height=900')
  if (!win) return false
  try {
    win.document.open()
    win.document.write(page)
    win.document.close()
    win.focus()
    return true
  } catch {
    win.close()
    return false
  }
}
