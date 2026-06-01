import type { ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="no-print border-b border-stone-200/80 bg-white/90 px-6 py-4 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-stone-950">{title}</h1>
          {subtitle && <p className="text-sm font-medium text-stone-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  )
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'outline' }) {
  const styles = {
    primary: 'bg-shiv-green text-stone-950 shadow-sm shadow-amber-900/10 hover:bg-[#c6a15a]',
    ghost: 'text-stone-600 hover:bg-stone-100',
    danger: 'bg-shiv-red text-white hover:bg-[#851719]',
    outline: 'border border-stone-300 bg-white/70 text-stone-700 hover:border-shiv-green hover:bg-stone-50',
  }[variant]
  return (
    <button
      className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Input({ label, className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-semibold text-stone-500">{label}</span>}
      <input
        className={`w-full rounded-lg border border-stone-300 bg-white/90 px-3 py-2 text-sm outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 ${className}`}
        {...props}
      />
    </label>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-stone-200/90 bg-white/95 shadow-sm shadow-stone-900/5 ${className}`}>{children}</div>
}

/** iOS-style sliding toggle switch. */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
}) {
  return (
    <label className="flex w-fit cursor-pointer items-center gap-3 text-sm font-medium text-stone-600 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-shiv-green/40 ${
          checked ? 'bg-shiv-green' : 'bg-stone-300'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
      {label}
    </label>
  )
}
