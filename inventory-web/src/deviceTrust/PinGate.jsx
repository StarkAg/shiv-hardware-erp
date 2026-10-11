/**
 * The shop PIN, asked once per device; the app behind it once trusted.
 *
 * SOURCE: src/lib/deviceTrust/ in Shiv_Panel. The small apps carry copies made
 * by `node scripts/copy-device-trust.mjs`; change it here and run that.
 */
import { useEffect, useRef, useState } from 'react'
import { authorizeClient, deviceToken, forgetDevice, onForgotten, stillTrusted, trustDevice } from './deviceTrust.js'

/** How often an open app asks whether it is still on the list. */
const RECHECK = 5 * 60_000

export function PinGate({ convexUrl, app, client, children }) {
  const [trusted, setTrusted] = useState(() => !!deviceToken())
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)

  useEffect(() => {
    if (client) authorizeClient(client)
    const off = onForgotten(() => {
      client?.clearAuth()
      setTrusted(false)
    })
    // Removed from the list while open: found on the next check, or on
    // coming back to the window.
    const check = () => {
      if (!deviceToken()) return
      void stillTrusted(convexUrl).then((ok) => { if (ok === false) forgetDevice() })
    }
    check()
    const timer = setInterval(check, RECHECK)
    window.addEventListener('focus', check)
    return () => { off(); clearInterval(timer); window.removeEventListener('focus', check) }
  }, [client, convexUrl])

  useEffect(() => { if (!trusted) input.current?.focus() }, [trusted])

  if (trusted) return children

  const submit = async (e) => {
    e.preventDefault()
    if (!pin.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await trustDevice(convexUrl, pin.trim(), app)
      if (!res.ok) { setError(res.error); setPin(''); return }
      if (client) authorizeClient(client)
      setTrusted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={styles.page}>
      <form onSubmit={submit} style={styles.card}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <label style={styles.label} htmlFor="shop-pin">Shop PIN</label>
        <input
          id="shop-pin"
          ref={input}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          style={styles.input}
        />
        {error && <p role="alert" style={styles.error}>{error}</p>}
        <button type="submit" disabled={busy || !pin.trim()} style={styles.button}>
          {busy ? 'Checking' : 'Trust this device'}
        </button>
      </form>
    </div>
  )
}

// An app in the Signs look (DESIGN.md) sets the --pin-* values in its
// signs.css, and the PIN screen wears them; an app that does not is shown as
// before.
const styles = {
  page: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16, background: 'var(--pin-wall, Canvas)', color: 'var(--pin-ink, CanvasText)', colorScheme: 'light dark',
    fontFamily: 'var(--pin-font, system-ui, -apple-system, Segoe UI, Roboto, sans-serif)',
  },
  card: {
    width: '100%', maxWidth: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
  },
  label: { fontSize: 14, fontWeight: 600 },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 20, letterSpacing: 6,
    textAlign: 'center', borderRadius: 'var(--pin-corner, 10px)', border: 'var(--pin-edge, 1px solid GrayText)',
    background: 'var(--pin-wall, Field)', color: 'var(--pin-ink, FieldText)',
  },
  error: { margin: 0, fontSize: 13, color: 'var(--pin-stop, #dc2626)' },
  button: {
    width: '100%', padding: '12px 14px', fontSize: 15, fontWeight: 700, borderRadius: 'var(--pin-corner, 10px)', border: 0,
    background: 'var(--pin-key, #b98f4b)', color: 'var(--pin-print, #1c1917)', cursor: 'pointer',
  },
}
