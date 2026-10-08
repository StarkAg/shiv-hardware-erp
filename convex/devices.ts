/**
 * Trusted devices: the shop PIN asked once, then the device is known.
 *
 * A device (a browser on a PC or phone, the desktop app, one of the shop's
 * small apps) or a server (cloud-api, a script) is written here when it is
 * trusted, and handed a signed token naming this row. Every public function
 * checks the row is still here (lib/guarded.ts), so removing a device from the
 * list ends its access on its next call.
 *
 * The PIN is the deployment's DEVICE_PIN, never in source:
 *   npx convex env set DEVICE_PIN <pin>
 */
import { ConvexError, v } from 'convex/values'
import { action as openAction, internalAction, internalMutation, internalQuery, query as openQuery } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import { mutation, query, deviceOf } from './lib/guarded'
import { record } from './lib/history'

/** Wrong PINs allowed in the window before trusting is paused. */
const MAX_TRIES = 10
const WINDOW = 15 * 60_000

/** Compared to the end, whatever differs, so timing says nothing about how close a guess was. */
function samePin(pin: string, expected: string) {
  let diff = pin.length ^ expected.length
  for (let i = 0; i < pin.length; i++) diff |= pin.charCodeAt(i) ^ expected.charCodeAt(i % expected.length)
  return diff === 0
}

async function checkPin(ctx: MutationCtx, pin: string): Promise<string | null> {
  const expected = process.env.DEVICE_PIN
  if (!expected) return 'No PIN is set on this deployment.'
  const since = Date.now() - WINDOW
  const recent = await ctx.db.query('pinAttempts').withIndex('by_at', (q) => q.gt('at', since)).collect()
  if (recent.length >= MAX_TRIES) return 'Too many wrong PINs. Wait 15 minutes.'
  if (!samePin(pin, expected)) {
    await ctx.db.insert('pinAttempts', { at: Date.now() })
    return 'Wrong PIN.'
  }
  return null
}

const kind = v.union(v.literal('device'), v.literal('server'))

/** Writes the device row once the PIN is right. Returns, never throws, so a wrong PIN is counted. */
export const register = internalMutation({
  args: { pin: v.optional(v.string()), name: v.string(), app: v.string(), kind },
  handler: async (ctx, { pin, name, app, kind }) => {
    // Servers are issued from the command line, which is already the deployment's owner.
    if (kind === 'device') {
      const wrong = await checkPin(ctx, pin ?? '')
      if (wrong) return { ok: false as const, error: wrong }
    }
    const now = Date.now()
    const id = await ctx.db.insert('trustedDevices', {
      name: name.trim().slice(0, 80) || 'Device', app: app.trim().slice(0, 40), kind, createdAt: now, lastSeenAt: now,
    })
    await record(ctx, 'device.trust', `Trusted ${kind === 'server' ? 'server' : 'device'}: ${name} (${app})`, { entity: 'device', entityId: id })
    return { ok: true as const, id: String(id) }
  },
})

/**
 * Trust this device. The one function anyone can call with nothing: it is how
 * a device becomes trusted. A wrong PIN gets nothing back but the refusal.
 */
export const trust = openAction({
  args: { pin: v.string(), name: v.string(), app: v.string() },
  handler: async (ctx, { pin, name, app }): Promise<{ ok: true; token: string } | { ok: false; error: string }> => {
    const res = await ctx.runMutation(internal.devices.register, { pin, name, app, kind: 'device' })
    if (!res.ok) return res
    const token: string = await ctx.runAction(internal.deviceKeys.signToken, { deviceId: res.id, name })
    return { ok: true, token }
  },
})

/**
 * A key for a server or script, from the command line:
 *   npx convex run --prod devices:issueServerKey '{"name":"cloud-api"}'
 * Put the token it prints in that server's SHIV_DEVICE_TOKEN.
 */
export const issueServerKey = internalAction({
  args: { name: v.string() },
  handler: async (ctx, { name }): Promise<string> => {
    const res = await ctx.runMutation(internal.devices.register, { name, app: 'server', kind: 'server' })
    if (!res.ok) throw new Error(res.error)
    return await ctx.runAction(internal.deviceKeys.signToken, { deviceId: res.id, name })
  },
})

/** Whether this call comes from a trusted device. Open: it is how an app learns it must ask for the PIN. */
export const me = openQuery({
  args: {},
  handler: async (ctx) => {
    const device = await deviceOf(ctx)
    return device ? { trusted: true as const, id: device._id, name: device.name } : { trusted: false as const }
  },
})

export const isTrusted = internalQuery({
  args: {},
  handler: async (ctx) => !!(await deviceOf(ctx)),
})

/** The list on the Trusted devices page. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await deviceOf(ctx)
    return (await ctx.db.query('trustedDevices').collect())
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((d) => ({ ...d, isThis: d._id === me?._id }))
  },
})

export const rename = mutation({
  args: { id: v.id('trustedDevices'), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const device = await ctx.db.get(id)
    if (!device) throw new ConvexError('That device is no longer trusted.')
    const clean = name.trim().slice(0, 80)
    if (!clean) throw new ConvexError('Give it a name.')
    await ctx.db.patch(id, { name: clean })
    await record(ctx, 'device.rename', `Device renamed: ${device.name} → ${clean}`, { entity: 'device', entityId: id })
  },
})

/** Removing asks the PIN again, so a trusted device cannot quietly lock the others out. */
export const remove = mutation({
  args: { id: v.id('trustedDevices'), pin: v.string() },
  handler: async (ctx, { id, pin }) => {
    const expected = process.env.DEVICE_PIN
    if (!expected || !samePin(pin, expected)) throw new ConvexError('Wrong PIN.')
    const device = await ctx.db.get(id)
    if (!device) return
    await ctx.db.delete(id)
    await record(ctx, 'device.remove', `Removed trusted ${device.kind}: ${device.name} (${device.app})`, { entity: 'device', entityId: id })
  },
})

/** Old wrong-PIN marks, cleared nightly. */
export const sweepAttempts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db.query('pinAttempts').withIndex('by_at', (q) => q.lt('at', Date.now() - WINDOW)).collect()
    for (const row of old) await ctx.db.delete(row._id)
  },
})
