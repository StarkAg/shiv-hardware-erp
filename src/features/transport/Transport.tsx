import { useState } from 'react'
import { Truck, Plus, X } from 'lucide-react'
import { Button, Input, Page } from '../../components/ui'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../../lib/store'
import { VEHICLE_LABEL } from '../../lib/types'
import type { VehicleType } from '../../lib/types'
import { CallRound, VehicleBadge } from '../toto/CallRound'

/**
 * Transport: the shop's hired-vehicle contacts and the call round for an order.
 * Toto (electric rickshaw) is one vehicle type among several — the list is not
 * toto-only, it just happens to be mostly totos today.
 *
 * Opening the section offers one thing: New Order. That starts a call round,
 * and the staff works down the list ringing totos until one takes the job.
 * Finishing — or simply refreshing — ends the round and returns the button,
 * because "who did I already ring" only means anything within one order.
 */
export function Transport() {
  const { totoDrivers, addTotoDriver } = useStore()

  // Per-order state, deliberately not persisted: a refresh starts a clean round.
  const navigate = useNavigate()
  const { view } = useParams<{ view?: string }>()
  const orderOpen = view === 'order'
  const setOrderOpen = (open: boolean) => navigate(open ? '/transport/order' : '/transport')
  const [called, setCalled] = useState<string[]>([])

  const [showModal, setShowModal] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [vehicle, setVehicle] = useState<VehicleType>('toto')

  const addDriver = () => {
    if (!name.trim() || phone.length !== 10) return
    addTotoDriver(name, phone, vehicle)
    setName('')
    setPhone('')
    setShowModal(false)
  }

  const markCalled = (id: string) =>
    setCalled((c) => (c.includes(id) ? c : [...c, id]))

  return (
    <Page>
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-stone-950 dark:text-white">
          <Truck size={28} className="text-shiv-green" />
          Transport
        </h1>
        <Button onClick={() => setShowModal(true)} className="flex items-center gap-2">
          <Plus size={18} /> Add Vehicle
        </Button>
      </div>

      {orderOpen ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">
              {called.length} of {totoDrivers.length} called
            </span>
            <Button variant="ghost" onClick={() => setOrderOpen(false)}>Finish order</Button>
          </div>
          <CallRound called={called} onCalled={markCalled} />
        </>
      ) : (
        // The only thing this screen asks for, so it gets the whole space.
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5">
          <Button
            onClick={() => { setCalled([]); setOrderOpen(true) }}
            className="w-full max-w-sm rounded-2xl px-10 py-8 text-2xl font-bold shadow-lg"
          >
            New Order
          </Button>
          <p className="text-sm text-muted">
            {totoDrivers.length} vehicles
          </p>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-lg dark:bg-stone-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-stone-950 dark:text-white">Add Vehicle</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-muted hover:text-stone-950 dark:hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <Input
                placeholder="10-digit mobile"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              />
              <div className="flex flex-wrap gap-2">
                {(Object.keys(VEHICLE_LABEL) as VehicleType[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVehicle(v)}
                    className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm ${
                      vehicle === v
                        ? 'border-shiv-green bg-shiv-green/15 text-stone-900 dark:text-white'
                        : 'border-stone-200 text-muted dark:border-white/10 '
                    }`}
                  >
                    <VehicleBadge vehicle={v} size={14} />
                    {VEHICLE_LABEL[v]}
                  </button>
                ))}
              </div>
              <Button onClick={addDriver} disabled={!name.trim() || phone.length !== 10} className="w-full">
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}
