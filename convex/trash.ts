import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { record, money } from "./lib/history";
import { requirePin } from "./lib/pin";
import { linkTrashRows } from './lib/trashLinks';
import { attachmentIds, deleteUnreferencedFiles, describeAttachments } from './lib/attachmentFiles';

/** One bin for the panel and books. A linked bill/voucher is one deleted event. */
export const all = query({
  args: {},
  handler: async (ctx) => {
    const [bills, vouchers, ledgers, types] = await Promise.all([
      ctx.db.query('billsTrash').collect(), ctx.db.query('trash').collect(),
      ctx.db.query('ledgers').collect(), ctx.db.query('voucherTypes').collect(),
    ]);
    const links = linkTrashRows(bills, vouchers);
    const linked = new Set(links.values());
    const partyNames = new Map(ledgers.map(l => [l._id, l.name]));
    const typeNames = new Map(types.map(t => [t._id, t]));
    const describe = async (voucher: typeof vouchers[number]) => ({
      date: voucher.date,
      type: typeNames.get(voucher.typeId)?.name ?? 'Voucher',
      label: `${typeNames.get(voucher.typeId)?.abbr ?? 'VCH'}-${String(voucher.voucherNo).padStart(4, '0')}`,
      party: partyNames.get(voucher.partyLedgerId) ?? '—',
      refNo: voucher.refNo ?? '',
      amount: voucher.amount ?? null,
      status: voucher.status,
      attachmentUrls: await describeAttachments(ctx, voucher.attachments),
    });
    const billRows = await Promise.all(bills.map(async row => {
      const voucher = vouchers.find(v => v._id === links.get(row._id));
      const details = voucher ? await describe(voucher) : null;
      return {
        source: 'bill' as const, _id: row._id, deletedAt: row.deletedAt,
        date: details?.date ?? new Date(row.bill?.date ?? row.deletedAt).getTime(),
        type: details?.type ?? (row.bill?.kind ?? 'sale'),
        label: `Bill ${row.bill?.number ?? '—'}`,
        party: row.bill?.customerName || details?.party || '—',
        refNo: row.bill?.ref || details?.refNo || '',
        amount: row.bill?.total ?? details?.amount ?? null,
        status: details?.status ?? 'final',
        linkedVoucher: details?.label ?? null,
        attachmentUrls: details?.attachmentUrls ?? await describeAttachments(ctx, row.bill?.attachments ?? []),
      };
    }));
    const voucherRows = await Promise.all(vouchers.filter(v => !linked.has(v._id)).map(async row => ({
      ...await describe(row), source: 'voucher' as const, _id: row._id,
      deletedAt: row.deletedAt, linkedVoucher: null,
    })));
    return [...billRows, ...voucherRows].sort((a, b) => b.deletedAt - a.deletedAt);
  },
});

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
          attachmentUrls: await describeAttachments(ctx, row.attachments),
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
    if (row.refNo?.startsWith('CASH-staff-pay-')) throw new Error('Record a new payment in Cashier → Staff Payments so wages and cash stay together.');

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
    await ctx.db.delete(id);
    await deleteUnreferencedFiles(ctx, attachmentIds(row.attachments));
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
      await ctx.db.delete(row._id);
    }
    await deleteUnreferencedFiles(ctx, old.flatMap(row => attachmentIds(row.attachments)));
    if (old.length) {
      await record(ctx, "trash.purge",
        `Purged ${old.length} deleted voucher(s) older than ${days} days`);
    }
    return { purged: old.length };
  },
});
