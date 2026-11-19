import {
  Calculator, CarTaxiFront, ClipboardList, CreditCard, FileText, History, IndianRupee, Inbox, Package, ScrollText, ShieldCheck,
} from 'lucide-react'

/**
 * The Counter's pages, in one list for the three places that show them: the
 * PC's side menu and the phone's bottom bar (CounterLayout), and the Android
 * app's home screen of tiles (features/pos/PosHome).
 */
export const NAV = [
  {
    label: 'Quotations',
    items: [
      { to: '/quote-options', label: 'Quote', icon: FileText },
      { to: '/history', label: 'Quote history', icon: History },
      // The handwritten slip, for the customer: nothing goes in the books.
      { to: '/slip', label: 'Slip', icon: ScrollText },
    ],
  },
  {
    label: 'Guarantee',
    items: [
      { to: '/guarantee/card', label: 'Card', icon: ShieldCheck },
      { to: '/guarantee/backs', label: 'Card backs', icon: CreditCard },
      { to: '/guarantee/list', label: 'To make', icon: ClipboardList },
      { to: '/guarantee/history', label: 'Card history', icon: History },
      { to: '/guarantee/claims', label: 'Claims', icon: Inbox, badge: true },
    ],
  },
  {
    label: 'Shop',
    items: [
      { to: '/inventory', label: 'Inventory', icon: Package },
      { to: '/rates', label: 'Rates', icon: IndianRupee },
      { to: '/aluminium-rates', label: 'Aluminium rates', icon: Calculator },
      { to: '/transport', label: 'Toto', icon: CarTaxiFront },
    ],
  },
]

export type NavItem = (typeof NAV)[number]['items'][number]

export const ALL_ROWS: NavItem[] = NAV.flatMap((area) => area.items)

/** Which entry the address belongs to, so a deep link still lights its row. */
export const owns = (to: string, pathname: string) => {
  if (to === '/quote-options') return /^\/(quote|product)/.test(pathname)
  if (to === '/history') return pathname.startsWith('/history')
  return pathname.startsWith(to)
}
