import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'

/**
 * Weekly copies of the owner's phone contacts (about 12,000 of them).
 *
 * The Contact Fixer app on the phone sends a gzipped vCard every week to
 * POST /contacts-backup (convex/http.ts); GET /contacts-backup/latest hands the
 * newest one back for a restore. Both carry CONTACTS_BACKUP_KEY, a Convex env
 * var that is also built into the app, and that key opens nothing else.
 */

/** Half a year of weekly copies. */
const KEEP = 26

export const save = internalMutation({
  args: {
    file: v.id('_storage'),
    bytes: v.number(),
    contacts: v.number(),
    numbers: v.number(),
    device: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const last = await ctx.db.query('contactBackups').withIndex('by_at').order('desc').first()
    // A phone book that shrank by a tenth in a week is more likely a sync or
    // import gone wrong than real deletions. Kept, but said out loud.
    const warning =
      last && args.contacts < last.contacts * 0.9
        ? `${args.contacts} contacts, down from ${last.contacts} in the copy before`
        : undefined
    await ctx.db.insert('contactBackups', { at: Date.now(), ...args, warning })

    const all = await ctx.db.query('contactBackups').withIndex('by_at').order('desc').collect()
    for (const old of all.slice(KEEP)) {
      await ctx.storage.delete(old.file)
      await ctx.db.delete(old._id)
    }
    return { warning, kept: Math.min(all.length, KEEP) }
  },
})

export const latest = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('contactBackups').withIndex('by_at').order('desc').first()
  },
})
