import { useState } from 'react'
import { Truck, Plus, X, Trash2 } from 'lucide-react'
import { Button, Input } from '../../components/ui'

interface Driver {
  id: string
  name: string
  phone: string
}

export function Transport() {
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [showModal, setShowModal] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  const addDriver = () => {
    if (!name.trim() || phone.length !== 10) return

    setDrivers([...drivers, {
      id: Math.random().toString(36).slice(2, 10),
      name: name.trim(),
      phone,
    }])

    setName('')
    setPhone('')
    setShowModal(false)
  }

  const removeDriver = (id: string) => {
    setDrivers(drivers.filter((d) => d.id !== id))
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-stone-950 dark:text-white flex items-center gap-2">
          <Truck size={28} className="text-shiv-green" />
          Drivers
        </h1>
        <Button onClick={() => setShowModal(true)} className="flex items-center gap-2">
          <Plus size={18} /> Add Driver
        </Button>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="rounded-xl bg-white p-6 shadow-lg dark:bg-stone-900 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-stone-950 dark:text-white">Add Driver</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-stone-500 hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <Input
                label="Driver Name"
                placeholder="Enter driver name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addDriver()}
              />

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-stone-500 dark:text-stone-400">
                  Phone Number (10 digits)
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="Enter 10-digit phone"
                  value={phone}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 10)
                    setPhone(value)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && addDriver()}
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 transition ${
                    phone.length === 10
                      ? 'border-green-500 bg-green-50 focus:border-green-600 focus:ring-green-600/20 dark:border-green-600 dark:bg-green-950/30'
                      : 'border-stone-300 bg-stone-50 focus:border-shiv-green focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950'
                  } dark:text-stone-100`}
                />
              </label>

              <div className="flex gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setShowModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={addDriver}
                  disabled={!name.trim() || phone.length !== 10}
                  className="flex-1"
                >
                  Add Driver
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drivers List */}
      {drivers.length === 0 ? (
        <div className="rounded-xl border border-stone-200/90 bg-stone-50 p-12 text-center dark:border-white/10 dark:bg-stone-900/90">
          <Truck size={48} className="mx-auto mb-4 text-stone-300 dark:text-stone-600" />
          <p className="text-stone-600 dark:text-stone-300">No drivers added yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {drivers.map((driver) => (
            <div
              key={driver.id}
              className="flex items-center justify-between rounded-lg border border-stone-200/90 bg-stone-50 p-4 dark:border-white/10 dark:bg-stone-900/90"
            >
              <div>
                <p className="font-semibold text-stone-950 dark:text-white">{driver.name}</p>
                <p className="text-sm text-stone-600 dark:text-stone-400">{driver.phone}</p>
              </div>
              <button
                onClick={() => removeDriver(driver.id)}
                className="text-red-500 hover:bg-red-50 rounded-lg p-2 dark:hover:bg-red-950/30"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
