import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { ArrowLeft, MapPin, Share2, Square, Wifi, WifiOff } from 'lucide-react'
import { PRINT_SERVER_URL } from '../../lib/printServer'

type Phase = 'waiting' | 'live' | 'stopped' | 'error'

export function DeliverPage() {
  const { deliveryId } = useParams<{ deliveryId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const driverName: string = (location.state as { driverName?: string })?.driverName ?? 'Driver'

  const [phase, setPhase] = useState<Phase>('waiting')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [errMsg, setErrMsg] = useState('')

  const startedAt = useRef(Date.now())
  const watchId = useRef<number | null>(null)
  const sendTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastCoords = useRef<{ lat: number; lng: number } | null>(null)
  const trackingUrl = `${PRINT_SERVER_URL}/track/${deliveryId}`

  // Elapsed timer
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [])

  // Start GPS watch + location sender
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setErrMsg('GPS not available on this device')
      setPhase('error')
      return
    }

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords
        lastCoords.current = { lat, lng }
        setCoords({ lat, lng })
        setAccuracy(Math.round(acc))
        setPhase('live')
      },
      (err) => {
        setErrMsg(err.message)
        setPhase('error')
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    )

    // Send location to server every 4 seconds
    sendTimer.current = setInterval(async () => {
      if (!lastCoords.current) return
      try {
        await fetch(`${PRINT_SERVER_URL}/delivery/${deliveryId}/location`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lastCoords.current),
        })
      } catch {}
    }, 4000)

    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
      if (sendTimer.current) clearInterval(sendTimer.current)
    }
  }, [deliveryId])

  async function stopDelivery() {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    if (sendTimer.current) clearInterval(sendTimer.current)
    try {
      await fetch(`${PRINT_SERVER_URL}/delivery/${deliveryId}/stop`, { method: 'POST' })
    } catch {}
    setPhase('stopped')
  }

  function shareLink() {
    if (navigator.share) {
      navigator.share({ title: 'Track your delivery', url: trackingUrl }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(trackingUrl).catch(() => {})
      alert('Link copied!')
    }
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60), sec = s % 60
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-stone-200/80 bg-stone-50/95 px-3 py-3 shadow-sm dark:border-white/10 dark:bg-stone-950/90">
        <button
          onClick={() => navigate('/transport')}
          className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-white/10"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-stone-900 dark:text-stone-100">{driverName}</div>
          <div className="text-xs text-stone-400 dark:text-stone-500">Active Delivery · {fmt(elapsed)}</div>
        </div>
        {phase === 'live'
          ? <Wifi size={18} className="text-shiv-green shrink-0" />
          : <WifiOff size={18} className="text-stone-400 shrink-0" />}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">

        {/* Status ring */}
        <div className={`flex h-32 w-32 flex-col items-center justify-center rounded-full border-4 shadow-lg ${
          phase === 'live'    ? 'border-shiv-green bg-shiv-green/10'
          : phase === 'error' ? 'border-red-400 bg-red-50 dark:bg-red-950/20'
          : phase === 'stopped' ? 'border-stone-300 bg-stone-100 dark:bg-white/10'
          : 'border-stone-200 bg-stone-50 dark:bg-white/5'
        }`}>
          <MapPin size={36} className={
            phase === 'live' ? 'text-shiv-green' : phase === 'error' ? 'text-red-400' : 'text-stone-400'
          } />
          <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            {phase === 'waiting' ? 'Getting GPS…'
              : phase === 'live' ? 'Sharing Live'
              : phase === 'stopped' ? 'Stopped'
              : 'GPS Error'}
          </span>
        </div>

        {/* Coords */}
        {coords && (
          <div className="rounded-xl border border-stone-200/80 bg-white px-5 py-3 text-center shadow-sm dark:border-white/10 dark:bg-stone-900">
            <div className="font-mono text-xs text-stone-500 dark:text-stone-400">
              {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
            </div>
            {accuracy !== null && (
              <div className="mt-0.5 text-[10px] text-stone-400">
                Accuracy ±{accuracy}m
              </div>
            )}
          </div>
        )}

        {errMsg && (
          <p className="text-center text-sm text-red-500">{errMsg}</p>
        )}

        {phase === 'stopped' && (
          <p className="text-center text-sm font-medium text-stone-500 dark:text-stone-400">
            Delivery ended. Customer tracking link is now inactive.
          </p>
        )}

        {/* Actions */}
        {phase !== 'stopped' && phase !== 'error' && (
          <div className="flex w-full max-w-xs flex-col gap-3">
            <button
              onClick={shareLink}
              className="flex items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-bold text-stone-700 shadow-sm dark:border-white/15 dark:bg-white/5 dark:text-stone-200"
            >
              <Share2 size={16} /> Share Tracking Link
            </button>
            <button
              onClick={stopDelivery}
              className="flex items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-3 text-sm font-bold text-white shadow-sm"
            >
              <Square size={16} fill="white" /> Stop Delivery
            </button>
          </div>
        )}

        {(phase === 'stopped' || phase === 'error') && (
          <button
            onClick={() => navigate('/transport')}
            className="rounded-xl bg-shiv-green px-6 py-3 text-sm font-bold text-stone-950"
          >
            Back to Drivers
          </button>
        )}
      </div>
    </div>
  )
}
