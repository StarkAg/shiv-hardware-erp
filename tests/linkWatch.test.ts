import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM module without types
import { createLinkWatch, isLinked } from '../whatsapp-reminders/link-watch.mjs'

function setup(env: Record<string, string> = {}) {
  let t = Date.parse('2026-11-25T09:00:00Z')
  let health: unknown = { status: 'ready', allowed: true }
  let up = true
  const sent: { to: string; text: string }[] = []
  const watch = createLinkWatch({
    env: { WATCH_HEALTH_URL: 'https://bills.test/health', WATCH_LOGIN_URL: 'https://bills.test/login?key=k', WATCH_NAME: "Tony's", ALERT_TO: '+91 87099 64141', ...env },
    send: async (to: string, text: string) => { sent.push({ to, text }) },
    canSend: () => up,
    log: () => {},
    now: () => t,
    fetchImpl: async () => {
      if (health === 'throw') throw new Error('down')
      return { json: async () => health } as Response
    },
  })
  return {
    watch, sent,
    at: (min: number) => { t = Date.parse('2026-11-25T09:00:00Z') + min * 60_000 },
    health: (h: unknown) => { health = h },
    selfUp: (v: boolean) => { up = v },
  }
}

describe('watching the other WhatsApp link', () => {
  it('reads /health: ready and the right number', () => {
    expect(isLinked({ status: 'ready', allowed: true })).toBe(true)
    expect(isLinked({ status: 'ready' })).toBe(true) // the bills service has no "allowed"
    expect(isLinked({ status: 'ready', allowed: false })).toBe(false)
    expect(isLinked({ status: 'qr' })).toBe(false)
  })

  it('tells once after 10 minutes down, with the login link, and once when it is back', async () => {
    const w = setup()
    await w.watch.check()
    w.health({ status: 'qr' })
    w.at(1); await w.watch.check()
    w.at(10); await w.watch.check()
    expect(w.sent).toEqual([])
    w.at(11); await w.watch.check()
    expect(w.sent).toHaveLength(1)
    expect(w.sent[0].to).toBe('918709964141@s.whatsapp.net')
    expect(w.sent[0].text).toContain("Tony's WhatsApp is not linked (qr) since 25 Nov")
    expect(w.sent[0].text).toContain('https://bills.test/login?key=k')
    w.at(30); await w.watch.check()
    expect(w.sent).toHaveLength(1) // not again for the same outage
    w.health({ status: 'ready' })
    w.at(31); await w.watch.check()
    expect(w.sent).toHaveLength(2)
    expect(w.sent[1].text).toContain('linked again')
    w.at(32); await w.watch.check()
    expect(w.sent).toHaveLength(2)
  })

  it('a short drop says nothing', async () => {
    const w = setup()
    w.health({ status: 'reconnecting' })
    await w.watch.check()
    w.at(5); w.health({ status: 'ready' }); await w.watch.check()
    w.at(20); await w.watch.check()
    expect(w.sent).toEqual([])
  })

  it('counts an unreachable service and a wrong number as down', async () => {
    const w = setup()
    w.health('throw'); await w.watch.check()
    w.at(11); await w.watch.check()
    expect(w.sent[0].text).toContain('(unreachable)')
    const v = setup()
    v.health({ status: 'ready', allowed: false }); await v.watch.check()
    v.at(11); await v.watch.check()
    expect(v.sent).toHaveLength(1)
  })

  it('waits while its own link is down, then tells', async () => {
    const w = setup()
    w.selfUp(false)
    w.health({ status: 'qr' }); await w.watch.check()
    w.at(15); await w.watch.check()
    expect(w.sent).toEqual([])
    w.selfUp(true)
    w.at(16); await w.watch.check()
    expect(w.sent).toHaveLength(1)
    expect(w.sent[0].text).toContain('since 25 Nov') // from when it went down, not now
  })

  it('stays off without a URL or a number', () => {
    expect(setup({ WATCH_HEALTH_URL: '' }).watch.state.enabled).toBe(false)
    expect(setup({ ALERT_TO: '' }).watch.state.enabled).toBe(false)
  })
})
