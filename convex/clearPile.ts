import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { record } from './lib/history'

/**
 * Throwing away the pile of photographed bills waiting to be read.
 *
 * The shop photographed its bills and let a model read them into vouchers.
 * That is no longer how the books are written — they are typed at the counter
 * — so the pile left over is work nobody is going to do, and it sits on the
 * Bills screen asking to be done.
 *
 * What goes: the inbox rows, the readings made from them, and the image files
 * themselves. What stays, and what this refuses to touch: any image already
 * attached to a voucher, to something in the trash, or to a filed statement.
 * Approving a bill moves its photograph onto the voucher and out of the inbox,
 * so the two sets should not overlap at all — but "should not" is not a reason
 * to delete without looking, and the evidence behind a posted entry is not
 * this job's to remove. An image in both places is left alone and reported.
 *
 * Internal, so only `npx convex run` reaches it, and it does nothing at all
 * without `confirm: true` — a dry run is what you get otherwise, and it is
 * what should be read first. There is no undo: the files are gone from
 * storage. They are in the nightly full backup, which is a restore, not a
 * click.
 */
export const run = internalMutation({
  args: {
    /** Without this it only counts and reports. Deleting needs saying. */
    confirm: v.optional(v.boolean()),
  },
  handler: async (ctx, { confirm }) => {
    const [photos, readings, vouchers, binned, papers] = await Promise.all([
      ctx.db.query('inbox').collect(),
      ctx.db.query('readings').collect(),
      ctx.db.query('vouchers').collect(),
      ctx.db.query('trash').collect(),
      ctx.db.query('papers').collect(),
    ])

    // Every image the books are relying on, whatever shape it is stored in.
    const spokenFor = new Set<string>()
    const idOf = (d: unknown) => (typeof d === 'string' ? d : (d as { storageId: string }).storageId)
    for (const vch of vouchers) for (const d of vch.attachments ?? []) spokenFor.add(idOf(d))
    for (const t of binned) for (const d of t.attachments ?? []) spokenFor.add(idOf(d))
    for (const w of papers) for (const d of w.documents ?? []) spokenFor.add(idOf(d))

    const keep = photos.filter((p) => spokenFor.has(p.storageId as string))
    const drop = photos.filter((p) => !spokenFor.has(p.storageId as string))
    const dropIds = new Set(drop.map((p) => p._id as string))
    // A reading of a photograph being kept is kept with it; one of a
    // photograph that is going has nothing left to be a reading of.
    const readingsToDrop = readings.filter(
      (r) => dropIds.has(r.inboxId as string) || !photos.some((p) => p._id === r.inboxId),
    )

    const report = {
      confirmed: !!confirm,
      photosInPile: photos.length,
      photosDeleted: confirm ? drop.length : 0,
      photosWouldDelete: drop.length,
      readingsDeleted: confirm ? readingsToDrop.length : 0,
      readingsWouldDelete: readingsToDrop.length,
      /** Left alone because a voucher, the trash or a statement names them. */
      keptBecauseFiled: keep.map((p) => p._id as string),
      oldest: photos.length ? Math.min(...photos.map((p) => p.at)) : null,
      newest: photos.length ? Math.max(...photos.map((p) => p.at)) : null,
    }

    if (!confirm) return report

    for (const r of readingsToDrop) await ctx.db.delete(r._id)
    for (const p of drop) {
      // The file first, the row second. The other way round loses the file id
      // and leaves the image in storage with nothing pointing at it.
      await ctx.storage.delete(p.storageId).catch(() => {})
      await ctx.db.delete(p._id)
    }

    await record(
      ctx,
      'clearPile.run',
      `The pile of bills waiting to be read was thrown away: ${drop.length} photographs, ${readingsToDrop.length} readings`,
    )
    return report
  },
})
