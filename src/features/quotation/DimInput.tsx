import type { KeyboardEvent } from 'react'
import type { Dimension } from '../../lib/types'

/** A size box: whole feet for a board, inches and soot for everything else. */
export function DimInput({
  label,
  hideLabel = false,
  dim,
  onChange,
  onKeyDown,
  feet = false,
  className = '',
}: {
  label: string
  /** The label is still read out; used on every row after a list's first. */
  hideLabel?: boolean
  dim: Dimension
  onChange: (d: Dimension) => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  feet?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      {!hideLabel && <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">{label}</label>}
      {/* Boards are sized in whole feet (no soot); doors/aluminium use inches + n/8. */}
      <div className={feet ? 'grid grid-cols-1' : 'grid grid-cols-[minmax(0,1fr)_4rem] gap-1.5 md:grid-cols-[minmax(0,1fr)_5rem] md:gap-2'}>
        <label className="relative block">
          <input
            type="number"
            min={0}
            inputMode="numeric"
            data-size-entry
            aria-label={label}
            className="h-10 w-full rounded-lg border-2 border-stone-300 bg-stone-50 px-2 pr-8 text-lg font-semibold text-stone-950 outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 md:h-11 md:px-3 md:pr-9"
            placeholder="0"
            value={dim.inches || ''}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={onKeyDown}
            onChange={(e) => onChange({ inches: Number(e.target.value), soot: feet ? 0 : dim.soot })}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm font-bold text-muted md:right-3">{feet ? 'ft' : 'in'}</span>
        </label>
        {!feet && (
          <label className="relative block">
            <input
              type="number"
              min={0}
              max={7}
              inputMode="numeric"
              data-size-entry
              aria-label={`${label} soot`}
              className="h-10 w-full rounded-lg border-2 border-stone-300 bg-stone-50 px-2 pr-6 text-lg font-semibold text-stone-950 outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 md:h-11 md:px-3 md:pr-7"
              placeholder="0"
              value={dim.soot || ''}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={onKeyDown}
              onChange={(e) => onChange({ ...dim, soot: Math.min(7, Math.max(0, Number(e.target.value))) })}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm font-bold text-muted">/8</span>
          </label>
        )}
      </div>
    </div>
  )
}
