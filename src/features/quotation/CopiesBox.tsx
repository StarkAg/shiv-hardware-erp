import { Minus, Plus } from 'lucide-react'

/** As many as the print server will take in one job (print-server sanitizeCopies). */
const MOST = 20

const key = 'flex h-11 w-10 items-center justify-center text-stone-900 disabled:opacity-30 dark:text-stone-100'

/**
 * How many of this quotation to print. Paper only: the costs and the sheet's own
 * Quantity stay as they are. Buttons rather than a box, so the Counter's Enter walk
 * goes from the last size straight on to Print. Each screen puts it back to 1 after
 * a print, so a number left behind never wastes paper on the next customer.
 */
export function CopiesBox({ copies, onChange }: { copies: number; onChange: (copies: number) => void }) {
  return (
    <div role="group" aria-label="Copies to print" className="flex shrink-0 items-center rounded-lg border border-stone-300 bg-white dark:border-white/15 dark:bg-stone-950">
      <button type="button" className={key} aria-label="One copy fewer" disabled={copies <= 1} onClick={() => onChange(copies - 1)}>
        <Minus size={18} />
      </button>
      <span className="w-14 text-center text-sm font-bold leading-none tabular-nums text-stone-900 dark:text-stone-100" aria-live="polite">
        {copies}
        <small className="block text-[10px] font-semibold uppercase tracking-wide text-muted">{copies === 1 ? 'copy' : 'copies'}</small>
      </span>
      <button type="button" className={key} aria-label="One copy more" disabled={copies >= MOST} onClick={() => onChange(copies + 1)}>
        <Plus size={18} />
      </button>
    </div>
  )
}
