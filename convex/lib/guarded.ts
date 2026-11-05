/**
 * The builders every public function in this deployment is made with.
 *
 * Every function here used to answer whoever had the deployment's address,
 * and the address ships inside each app's own JavaScript. Now a call has to
 * come from a trusted device: one that has been given the shop's PIN once and
 * holds the signed token it got back (convex/devices.ts), or a server holding
 * a key issued for it. A device removed from the list is refused at once,
 * because the list is checked on every call, not just the token.
 *
 * The few functions a customer reaches from a guarantee card's QR code are
 * made with the raw builders instead, and say so where they are defined.
 */
import { ConvexError } from 'convex/values'
import { customAction, customCtx, customMutation, customQuery } from 'convex-helpers/server/customFunctions'
import {
  action as rawAction,
  mutation as rawMutation,
  query as rawQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from '../_generated/server'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'

const UNTRUSTED = { code: 'untrusted', message: 'This device is not trusted. Enter the shop PIN.' }

/** The trusted-device row behind this call, or null. */
export async function deviceOf(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) return null
  const id = ctx.db.normalizeId('trustedDevices', identity.subject)
  return id ? await ctx.db.get(id) : null
}

/**
 * The Shiv_Intro app on the owner's Samsung. It runs all day on a phone that
 * can be lost, so it is trusted for its own functions (the phone builders below)
 * and nothing else: not the books, not the customers, not the other devices.
 */
export const INTRO_APP = 'shiv-intro'

/** A device that may call the ordinary functions, or null. */
export async function fullDeviceOf(ctx: QueryCtx | MutationCtx) {
  const device = await deviceOf(ctx)
  return device && device.app !== INTRO_APP ? device : null
}

async function requireDevice(ctx: QueryCtx | MutationCtx) {
  const device = await fullDeviceOf(ctx)
  if (!device) throw new ConvexError(UNTRUSTED)
  return device
}

async function requirePhone(ctx: QueryCtx | MutationCtx) {
  const device = await deviceOf(ctx)
  if (device?.app !== INTRO_APP) throw new ConvexError(UNTRUSTED)
}

export const phoneQuery = customQuery(rawQuery, customCtx(async (ctx) => {
  await requirePhone(ctx)
  return {}
}))

export const phoneMutation = customMutation(rawMutation, customCtx(async (ctx) => {
  await requirePhone(ctx)
  return {}
}))

export const query = customQuery(rawQuery, customCtx(async (ctx) => {
  await requireDevice(ctx)
  return {}
}))

export const mutation = customMutation(rawMutation, customCtx(async (ctx) => {
  const device = await requireDevice(ctx)
  // "Last used" on the list, written at most once an hour.
  const now = Date.now()
  if (now - (device.lastSeenAt ?? 0) > 3_600_000) {
    await ctx.db.patch(device._id as Id<'trustedDevices'>, { lastSeenAt: now })
  }
  return {}
}))

export const action = customAction(rawAction, customCtx(async (ctx: ActionCtx) => {
  const trusted = await ctx.runQuery(internal.devices.isTrusted, {})
  if (!trusted) throw new ConvexError(UNTRUSTED)
  return {}
}))
