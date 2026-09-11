import { useMemo, useState } from 'react'
import { Phone, PhoneCall, MoreVertical, Check, CarTaxiFront, Zap, Truck } from 'lucide-react'
import { useStore } from '../../lib/store'
import { Input } from '../../components/ui'
import { Button, Card } from '../../components/ui'
import type { TotoAvailability, VehicleType } from '../../lib/types'
import { VEHICLE_LABEL } from '../../lib/types'
import Confirm from '../ledger/components/Confirm'

/**
 * One order's call round down the toto list.
 *
 * Who has been called is per-order state held in memory by the parent, so
 * closing or refreshing ends the order and hands back the New Order button —
 * one order, one pass down the list, which is how it works at the counter.
 *
 * Availability tags are the opposite: they belong to the toto, not the order,
 * so they are saved and carry across.
 */

/**
 * Removing a contact asks for the shop code. This is a guard against a stray tap
 * on a shared counter device, not real security — anyone with the browser
 * console can bypass it. It exists so a contact list built over years can't be
 * lost by accident.
 */
const REMOVE_CODE = '2611'

/** A toto is an electric rickshaw, so it gets the three-wheeler plus a charge mark. */
export function VehicleBadge({ vehicle, size = 12 }: { vehicle: VehicleType; size?: number }) {
  if (vehicle === 'toto') {
    return (
      <span className="relative inline-flex shrink-0">
        <CarTaxiFront size={size} />
        <Zap size={Math.round(size * 0.6)} className="absolute -bottom-1 -right-1 text-amber-500" />
      </span>
    )
  }
  return <Truck size={size} className="shrink-0" />
}

const TAGS: { value: TotoAvailability; label: string; dot: string; ring: string }[] = [
  { value: 'green',  label: 'Free',    dot: 'bg-emerald-500', ring: 'ring-emerald-500' },
  { value: 'orange', label: 'Maybe',   dot: 'bg-amber-500',   ring: 'ring-amber-500' },
  { value: 'red',    label: 'Not now', dot: 'bg-red-500',     ring: 'ring-red-500' },
]

export function CallRound({ called, onCalled }: { called: string[]; onCalled: (id: string) => void }) {
  const { totoDrivers, setTotoAvailability, removeTotoDriver, updateTotoDriver } = useStore()
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')

  // Free first, then maybe, then not available — the order you'd ring in.
  const ordered = useMemo(() => {
    const rank: Record<TotoAvailability, number> = { green: 0, orange: 1, red: 2 }
    return [...totoDrivers].sort((a, b) => rank[a.availability] - rank[b.availability])
  }, [totoDrivers])

  return (
    <>
    {removing && (
      <Confirm
        title={`Remove ${removing.name}?`}
        confirmLabel="Remove"
        danger
        ask={{ label: 'Shop code', secret: true }}
        onConfirm={(code) => {
          if (code.trim() !== REMOVE_CODE) throw new Error('Wrong code.')
          removeTotoDriver(removing.id)
        }}
        onClose={() => setRemoving(null)}
      />
    )}
    <Card className="divide-y divide-stone-100 dark:divide-white/10">
      {ordered.map((d) => {
        const done = called.includes(d.id)
        if (editingId === d.id) {
          return (
            <div key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" className="w-36" />
              <Input
                value={editPhone}
                inputMode="numeric"
                onChange={(e) => setEditPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="Mobile"
                className="w-36"
              />
              <Button
                onClick={() => {
                  if (!editName.trim() || editPhone.length !== 10) return
                  updateTotoDriver(d.id, { name: editName.trim(), phone: editPhone })
                  setEditingId(null)
                }}
                disabled={!editName.trim() || editPhone.length !== 10}
              >
                Save
              </Button>
              <Button variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
            </div>
          )
        }
        return (
          <div key={d.id} className={`flex items-center gap-3 px-4 py-3 ${done ? 'opacity-45' : ''}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{d.name}</span>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-muted dark:bg-white/10">
                  <VehicleBadge vehicle={d.vehicle ?? 'toto'} />
                  {VEHICLE_LABEL[d.vehicle ?? 'toto']}
                </span>
                {done && <Check size={14} className="shrink-0 text-good" />}
              </div>
              <div className="text-xs text-muted">{d.phone}</div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {TAGS.map((t) => (
                <button
                  key={t.value}
                  title={t.label}
                  aria-label={`${d.name}: ${t.label}`}
                  onClick={() => setTotoAvailability(d.id, t.value)}
                  className={`h-5 w-5 rounded-full ${t.dot} ${
                    d.availability === t.value
                      ? `ring-2 ring-offset-1 ${t.ring} dark:ring-offset-stone-900`
                      : 'opacity-30'
                  }`}
                />
              ))}
            </div>

            {/* tel: hands off to the phone's dialer, so the call goes out from
                the shop's own number rather than through any service. */}
            <a
              href={`tel:${d.phone}`}
              onClick={() => onCalled(d.id)}
              className="shrink-0 rounded-lg bg-shiv-green/15 p-2 text-stone-800 hover:bg-shiv-green/25 dark:text-white"
              aria-label={`Call ${d.name}`}
            >
              {done ? <PhoneCall size={18} /> : <Phone size={18} />}
            </a>

            <div className="relative shrink-0">
              <Button
                variant="ghost"
                className="px-1.5 py-1 text-muted"
                title="More"
                aria-label={`More actions for ${d.name}`}
                onClick={() => setMenuFor(menuFor === d.id ? null : d.id)}
              >
                <MoreVertical size={16} />
              </Button>
              {menuFor === d.id && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                  <div className="absolute right-0 top-full z-20 mt-1 min-w-[7rem] overflow-hidden rounded-lg border border-stone-200 bg-white shadow-xl dark:border-white/10 dark:bg-stone-800">
                    <button
                      onClick={() => {
                        setMenuFor(null)
                        setEditingId(d.id)
                        setEditName(d.name)
                        setEditPhone(d.phone)
                      }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-white/10"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => { setMenuFor(null); setRemoving(d) }}
                      className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-stone-100 dark:hover:bg-white/10"
                    >
                      Remove
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })}
    </Card>
    </>
  )
}
