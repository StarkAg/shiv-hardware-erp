/**
 * The shop PIN, asked once per phone; the app behind it once trusted.
 *
 * Asked once for all the shop's apps: right after the PIN, and whenever the
 * app is opened with ?apps, the other apps are listed, and one opened from
 * here comes with a one-time pass and is trusted without the PIN. A key lost
 * from localStorage is found again in its second copy before the PIN is asked.
 * On an iPhone in Safari it says to open the app from the Home Screen, where
 * the phone keeps what the app saved.
 *
 * SOURCE: src/lib/deviceTrust/ in Shiv_Panel. The small apps carry copies made
 * by `node scripts/copy-device-trust.mjs`; change it here and run that.
 */
import { useEffect, useRef, useState } from 'react'
import {
  SHOP_APPS, authorizeClient, deviceToken, forgetDevice, inIosSafari, onForgotten, openApp, recoverToken,
  stillTrusted, trustDevice, usePassInLink,
} from './deviceTrust.js'

/** How often an open app asks whether it is still on the list. */
const RECHECK = 5 * 60_000
const askedForApps = () => { try { return new URLSearchParams(window.location.search).has('apps') } catch { return false } }

export function PinGate({ convexUrl, app, client, children }) {
  // checking (a pass in the link, a second copy of the key), pin, apps, or trusted.
  const [phase, setPhase] = useState(() => (deviceToken() ? (askedForApps() ? 'apps' : 'trusted') : 'checking'))
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)

  useEffect(() => {
    if (phase !== 'checking') return
    let live = true
    void (async () => {
      const ok = (await usePassInLink(convexUrl, app)) || !!(await recoverToken())
      if (!live) return
      if (ok && client) authorizeClient(client, convexUrl)
      setPhase(ok ? (askedForApps() ? 'apps' : 'trusted') : 'pin')
    })()
    return () => { live = false }
  }, [phase, client, convexUrl, app])

  useEffect(() => {
    if (client && deviceToken()) authorizeClient(client, convexUrl)
    const off = onForgotten(() => {
      client?.clearAuth()
      setPhase('pin')
    })
    // Removed from the list while open: found on the next check, or on
    // coming back to the window. Patient, so a deploy going out is not taken
    // for the device being removed.
    const check = () => {
      if (!deviceToken()) return
      void stillTrusted(convexUrl, { patient: true }).then((ok) => { if (ok === false) forgetDevice() })
    }
    check()
    const timer = setInterval(check, RECHECK)
    window.addEventListener('focus', check)
    return () => { off(); clearInterval(timer); window.removeEventListener('focus', check) }
  }, [client, convexUrl])

  useEffect(() => { if (phase === 'pin') input.current?.focus() }, [phase])

  if (phase === 'trusted') return children
  if (phase === 'checking') return <div style={styles.page} />

  if (phase === 'apps') {
    const others = SHOP_APPS.filter((a) => a.app !== app)
    const done = () => {
      try {
        const url = new URL(window.location.href)
        url.searchParams.delete('apps')
        history.replaceState(history.state, '', url.toString())
      } catch { /* the address keeps ?apps */ }
      setPhase('trusted')
    }
    return (
      <div style={styles.page}>
        <div style={{ ...styles.card, maxWidth: 360 }}>
          <b style={styles.title}>Shop apps</b>
          <p style={styles.note}>Each opens trusted on this phone, with no PIN.</p>
          <div style={styles.list}>
            {others.map((a) => (
              <button key={a.app} type="button" style={styles.appRow} onClick={() => void openApp(convexUrl, a)}>{a.name}</button>
            ))}
          </div>
          {inIosSafari() && <p style={styles.note}>On iPhone, add each app to the Home Screen and open it from there.</p>}
          <button type="button" style={styles.button} onClick={done}>Continue to {app}</button>
        </div>
      </div>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!pin.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await trustDevice(convexUrl, pin.trim(), app)
      if (!res.ok) { setError(res.error); setPin(''); return }
      if (client) authorizeClient(client, convexUrl)
      // Straight after the PIN: the other apps, to open trusted from here.
      setPhase('apps')
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
        {inIosSafari() && <p style={styles.note}>On iPhone, add this app to the Home Screen and open it from there: Safari forgets it after a week.</p>}
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
  title: { fontSize: 20, fontWeight: 800 },
  note: { margin: 0, fontSize: 13, textAlign: 'center', opacity: 0.75 },
  list: { width: '100%', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '55vh', overflowY: 'auto' },
  appRow: {
    width: '100%', padding: '12px 14px', fontSize: 16, fontWeight: 600, textAlign: 'left', cursor: 'pointer',
    borderRadius: 'var(--pin-corner, 10px)', border: 'var(--pin-edge, 1px solid GrayText)',
    background: 'var(--pin-wall, Canvas)', color: 'var(--pin-ink, CanvasText)',
  },
  button: {
    width: '100%', padding: '12px 14px', fontSize: 15, fontWeight: 700, borderRadius: 'var(--pin-corner, 10px)', border: 0,
    background: 'var(--pin-key, #b98f4b)', color: 'var(--pin-print, #1c1917)', cursor: 'pointer',
  },
}
