import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { record, money } from "./lib/history";
import { requirePin } from "./lib/pin";

/** What has been deleted lately, newest first, ready to be put back. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const [rows, ledgers, types] = await Promise.all([
      ctx.db.query("trash").withIndex("by_deletedAt").order("desc").collect(),
      ctx.db.query("ledgers").collect(),
      ctx.db.query("voucherTypes").collect(),
    ]);
    const ledgerById = new Map(ledgers.map((l) => [l._id, l]));
    const typeById = new Map(types.map((t) => [t._id, t]));

    return Promise.all(
      rows.map(async (row) => {
        const type = typeById.get(row.typeId);
        return {
          _id: row._id,
          deletedAt: row.deletedAt,
          date: row.date,
          vchType: type?.name ?? "—",
          vchLabel: `${type?.abbr ?? "VCH"}-${String(row.voucherNo).padStart(4, "0")}`,
          party: ledgerById.get(row.partyLedgerId)?.name ?? "—",
          refNo: row.refNo ?? "",
          narration: row.narration ?? "",
          amount: row.amount,
          status: row.status,
          lineCount: row.entries.length,
          attachmentUrls: await Promise.all(
            row.attachments.map(async (doc) => {
              const storageId = typeof doc === "string" ? doc : doc.storageId;
              return {
                storageId,
                kind: typeof doc === "string" ? "bill" : doc.kind,
                url: await ctx.storage.getUrl(storageId),
              };
            })
          ),
        };
      })
    );
  },
});

/**
 * Puts a deleted voucher back, lines and all, under its original voucher
 * number — the counter was never rolled back, so the number is still free and
 * the register keeps its order.
 */
export const restore = mutation({
  args: { id: v.id("trash") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) throw new Error("That entry is no longer in the trash");

    const { _id, _creationTime, entries, deletedAt, ...voucher } = row;
    const voucherId = await ctx.db.insert("vouchers", voucher);
    for (const line of entries) {
      await ctx.db.insert("voucherEntries", {
        voucherId,
        ledgerId: line.ledgerId,
        side: line.side,
        amount: line.amount,
        date: voucher.date,
      });
    }
    const type = await ctx.db.get(voucher.typeId);
    const party = await ctx.db.get(voucher.partyLedgerId);
    await ctx.db.delete(id);
    await record(
      ctx,
      "voucher.restore",
      `Restored ${type?.abbr ?? "VCH"}-${String(voucher.voucherNo).padStart(4, "0")} · ` +
        `${party?.name ?? "—"} · ${money(voucher.amount)} from Trash`,
      { entity: "voucher", entityId: voucherId }
    );
    return voucherId;
  },
});

/** Destroys one deleted voucher for good, bill photos included. */
export const purge = mutation({
  args: { pin: v.string(), id: v.id("trash")},
  handler: async (ctx, { pin, id }) => {
    requirePin(pin);
    const row = await ctx.db.get(id);
    if (!row) return;
    for (const doc of row.attachments) {
      await ctx.storage.delete(typeof doc === "string" ? doc : doc.storageId).catch(() => {});
    }
    await ctx.db.delete(id);
    await record(ctx, "trash.purge",
      `Purged voucher no. ${row.voucherNo} · ${money(row.amount)} for good`);
  },
});

/** Empties everything deleted longer ago than `days`. */
export const purgeOlderThan = mutation({
  args: { pin: v.string(), days: v.number()},
  handler: async (ctx, { pin, days }) => {
    requirePin(pin);
    const cutoff = Date.now() - days * 86400000;
    const old = await ctx.db
      .query("trash")
      .withIndex("by_deletedAt", (q) => q.lt("deletedAt", cutoff))
      .collect();
    for (const row of old) {
      for (const doc of row.attachments) {
        await ctx.storage.delete(typeof doc === "string" ? doc : doc.storageId).catch(() => {});
      }
      await ctx.db.delete(row._id);
    }
    if (old.length) {
      await record(ctx, "trash.purge",
        `Purged ${old.length} deleted voucher(s) older than ${days} days`);
    }
    return { purged: old.length };
  },
});
