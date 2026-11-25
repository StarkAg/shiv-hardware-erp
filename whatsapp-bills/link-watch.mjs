/**
 * Each WhatsApp service watches the other one's link (owner's ask, 25 Nov
 * 2026). Tony's number (whatsapp-bills) was unlinked for over a day before
 * anyone noticed; a service cannot say that about itself, as its own link is
 * the one that is gone, but the other one can.
 *
 * Once a minute the other service's /health is read. If it has not been
 * linked ("ready") for WATCH_DOWN_MINUTES (10), one WhatsApp message goes to
 * ALERT_TO with the other's login link; when it is linked again, one more says
 * so. Nothing is sent while this service's own link is not up.
 *
 * The same file is in whatsapp-reminders/ and whatsapp-bills/: keep both alike.
 *
 * Environment (Railway variables):
 *   WATCH_HEALTH_URL   the other service's /health
 *   WATCH_LOGIN_URL    its /login?key=... link, put in the message (optional)
 *   WATCH_NAME         what to call it in the message
 *   ALERT_TO           the number told (country code, digits only)
 *   WATCH_DOWN_MINUTES how long down before telling (10)
 */

/** Whether a /health answer means linked to the right number. */
export const isLinked = (health) => health?.status === 'ready' && health?.allowed !== false

const indiaTime = (ms) => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })

export function createLinkWatch({
  env = process.env, send, canSend = () => true, log = console.log,
  now = () => Date.now(), fetchImpl = fetch,
}) {
  const healthUrl = env.WATCH_HEALTH_URL || ''
  const loginUrl = env.WATCH_LOGIN_URL || ''
  const name = env.WATCH_NAME || 'The other WhatsApp'
  const alertTo = String(env.ALERT_TO || '').replace(/\D/g, '')
  const downAfterMs = Math.max(1, Number(env.WATCH_DOWN_MINUTES) || 10) * 60_000
  const state = { enabled: !!(healthUrl && alertTo), watching: healthUrl || null, status: null, downSince: null, alerted: false, lastAlert: null }
  let timer = null

  async function tell(text) {
    if (!canSend()) return false
    await send(`${alertTo}@s.whatsapp.net`, text)
    state.lastAlert = { at: new Date(now()).toISOString(), text }
    log(`[watch] told ${alertTo}: ${text.split('\n')[0]}`)
    return true
  }

  async function check() {
    if (!state.enabled) return
    let health = null
    try {
      const res = await fetchImpl(healthUrl, { signal: AbortSignal.timeout(10_000) })
      health = await res.json()
    } catch {
      health = { status: 'unreachable' }
    }
    state.status = health?.status ?? 'unknown'
    if (isLinked(health)) {
      if (state.alerted) {
        try { if (await tell(`${name} WhatsApp is linked again (${indiaTime(now())}).`)) state.alerted = false } catch (err) { log('[watch] could not send:', err?.message ?? err) }
      }
      if (!state.alerted) state.downSince = null
      return
    }
    state.downSince ??= now()
    if (state.alerted || now() - state.downSince < downAfterMs) return
    const lines = [
      `${name} WhatsApp is not linked (${state.status}) since ${indiaTime(state.downSince)}.`,
      loginUrl ? `Link it again here (QR or "Link with phone number instead"):\n${loginUrl}` : 'Link it again from its login page.',
    ]
    try { if (await tell(lines.join('\n'))) state.alerted = true } catch (err) { log('[watch] could not send:', err?.message ?? err) }
  }

  return {
    check,
    state,
    start(everyMs = 60_000) {
      if (!state.enabled || timer) return
      log(`[watch] watching ${healthUrl}, telling ${alertTo} after ${downAfterMs / 60_000} min down`)
      timer = setInterval(() => { void check() }, everyMs)
    },
    stop() { clearInterval(timer); timer = null },
  }
}
