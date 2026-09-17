import { query } from "./_generated/server";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { round2, signed, sideOf } from "./lib/money";

/**
 * What happened first, when several vouchers share a date.
 *
 * Voucher numbers run in their own series per type, so comparing them across
 * types is meaningless — RCT-0014 is not earlier than SAL-0022, it is simply
 * the fourteenth receipt. On one day the goods move first, then anything
 * adjusting the bill, then the money: a receipt cannot precede the sale it
 * pays for, and a running balance that shows it doing so reads as nonsense.
 */
const SAME_DAY_ORDER: Record<string, number> = {
  Purchase: 1,
  Sale: 1,
  "Goods Return": 2,
  "Purchase Return": 2,
  Discount: 3,
  Receipt: 4,
  Payment: 4,
  // A refund can only follow the return that left the customer in credit.
  Refund: 4,
  // A month falling due is the charge; any payment that day comes after it.
  Journal: 1,
};
const dayRank = (typeName?: string) => SAME_DAY_ORDER[typeName ?? ""] ?? 5;

async function context(ctx: QueryCtx) {
  const [ledgers, groups, types] = await Promise.all([
    ctx.db.query("ledgers").collect(),
    ctx.db.query("groups").collect(),
    ctx.db.query("voucherTypes").collect(),
  ]);
  return {
    ledgerById: new Map(ledgers.map((l) => [l._id, l])),
    groupById: new Map(groups.map((g) => [g._id, g])),
    typeById: new Map(types.map((t) => [t._id, t])),
    ledgers,
    groups,
  };
}

const openingSigned = (l: Doc<"ledgers">) => signed(l.openingSide, l.openingBalance);

type Attachment =
  | Id<"_storage">
  | { storageId: Id<"_storage">; kind: string; previewStorageId?: Id<"_storage"> };

/**
 * Resolves a voucher's documents for display, numbering the pages within each
 * kind — so two challan photos read "Challan 1 of 2" and "Challan 2 of 2"
 * while the invoice beside them is simply "Bill".
 */
async function urlsFor(ctx: QueryCtx, docs: Attachment[]) {
  const flat = docs.map((d) =>
    typeof d === "string"
      ? { storageId: d, kind: "bill", previewStorageId: undefined }
      : d
  );
  const counts = new Map<string, number>();
  for (const d of flat) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
  const seen = new Map<string, number>();

  return Promise.all(
    flat.map(async (d) => {
      const n = (seen.get(d.kind) ?? 0) + 1;
      seen.set(d.kind, n);
      const of = counts.get(d.kind)!;
      // Convex storage URLs carry no file extension, so the only honest way to
      // know a PDF from a photo is to ask the store what it holds.
      const meta = await ctx.db.system.get(d.storageId);
      return {
        storageId: d.storageId,
        kind: d.kind,
        page: n,
        pages: of,
        label: of > 1 ? `${d.kind} ${n} of ${of}` : d.kind,
        contentType: meta?.contentType ?? null,
        url: await ctx.storage.getUrl(d.storageId),
        // What to show. For a photo this is the photo itself.
        previewUrl: d.previewStorageId
          ? await ctx.storage.getUrl(d.previewStorageId)
          : await ctx.storage.getUrl(d.storageId),
      };
    })
  );
}

const vchLabel = (abbr: string, no: number) => `${abbr}-${String(no).padStart(4, "0")}`;

/**
 * One account, laid out the way a Tally ledger is: opening balance, every
 * voucher that touched it in date order, running balance, then closing —
 * with the Dr/Cr side spelled out, because the sign alone is not an answer.
 */
export const ledger = query({
  args: {
    ledgerId: v.id("ledgers"),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, { ledgerId, from, to }) => {
    const { ledgerById, typeById } = await context(ctx);
    const account = ledgerById.get(ledgerId);
    if (!account) return null;

    const lines = await ctx.db
      .query("voucherEntries")
      .withIndex("by_ledger", (q) => q.eq("ledgerId", ledgerId))
      .collect();

    const vouchers = new Map<Id<"vouchers">, Doc<"vouchers">>();
    for (const line of lines) {
      if (!vouchers.has(line.voucherId)) {
        const voucher = await ctx.db.get(line.voucherId);
        if (voucher) vouchers.set(line.voucherId, voucher);
      }
    }

    // Tally names the *other* side of the entry in Particulars — money paid to a
    // supplier came from Bank or Cash, and saying which is the point of the
    // column. So every voucher's remaining lines are read and named.
    const contra = new Map<Id<"vouchers">, string[]>();
    for (const voucherId of vouchers.keys()) {
      const all = await ctx.db
        .query("voucherEntries")
        .withIndex("by_voucher", (q) => q.eq("voucherId", voucherId))
        .collect();
      contra.set(
        voucherId,
        all
          .filter((l) => l.ledgerId !== ledgerId)
          .map((l) => ledgerById.get(l.ledgerId)?.name ?? "—")
      );
    }

    const sorted = lines
      .filter((l) => vouchers.has(l.voucherId))
      .sort((a, b) => {
        const va = vouchers.get(a.voucherId)!;
        const vb = vouchers.get(b.voucherId)!;
        // Same day: what actually happened first. The goods move, then any
        // adjustment to the bill, then the money — a receipt cannot precede
        // the sale it pays for. Only then does the order they were written in
        // break the tie; voucher numbers never can, since PUR-0040 and
        // PAY-0016 come from separate counters.
        return (
          a.date - b.date ||
          dayRank(typeById.get(va.typeId)?.name) - dayRank(typeById.get(vb.typeId)?.name) ||
          va.createdAt - vb.createdAt ||
          va.voucherNo - vb.voucherNo
        );
      });

    let running = openingSigned(account);
    let openingForWindow = running;
    const rows = [];
    let debit = 0;
    let credit = 0;

    for (const line of sorted) {
      // Sorted by date, so the first line past the window ends the account —
      // and the closing balance is the balance as of `to`, not as of today.
      if (to !== undefined && line.date > to) break;

      const voucher = vouchers.get(line.voucherId)!;
      running = round2(running + signed(line.side, line.amount));

      if (from !== undefined && line.date < from) {
        // Rolls into the opening balance for the window rather than showing.
        openingForWindow = running;
        continue;
      }

      if (line.side === "Dr") debit += line.amount;
      else credit += line.amount;

      const type = typeById.get(voucher.typeId);
      rows.push({
        voucherId: voucher._id,
        date: line.date,
        vchType: type?.name ?? "—",
        vchNo: voucher.voucherNo,
        vchLabel: vchLabel(type?.abbr ?? "VCH", voucher.voucherNo),
        refNo: voucher.refNo ?? "",
        narration: voucher.narration ?? "",
        contra: contra.get(voucher._id) ?? [],
        side: line.side,
        amount: line.amount,
        balance: running,
        balanceSide: sideOf(running),
        attachmentUrls: await urlsFor(ctx, voucher.attachments),
      });
    }

    const pending = (
      await ctx.db
        .query("vouchers")
        .withIndex("by_party", (q) => q.eq("partyLedgerId", ledgerId))
        .collect()
    ).filter((vch) => vch.status === "pending");

    return {
      account,
      opening: Math.abs(openingForWindow),
      openingSide: sideOf(openingForWindow),
      openingAsOf: account.openingAsOf,
      rows,
      totals: { debit: round2(debit), credit: round2(credit) },
      closing: Math.abs(running),
      closingSide: sideOf(running),
      pendingCount: pending.length,
      pending: await Promise.all(
        pending.map(async (vch) => ({
          ...vch,
          // Without this the queue had no voucher number to show, and the
          // viewer drew an empty badge where PUR-0034 belongs.
          vchLabel: vchLabel(
            typeById.get(vch.typeId)?.abbr ?? "VCH",
            vch.voucherNo
          ),
          vchType: typeById.get(vch.typeId)?.name ?? "—",
          attachmentUrls: await urlsFor(ctx, vch.attachments),
        }))
      ),
    };
  },
});

/** Every voucher, newest work first — Tally's Day Book. */
export const dayBook = query({
  args: { from: v.optional(v.number()), to: v.optional(v.number()) },
  handler: async (ctx, { from, to }) => {
    const { ledgerById, typeById, groupById } = await context(ctx);
    const all = await ctx.db.query("vouchers").withIndex("by_date").collect();
    const inWindow = all.filter(
      (vch) =>
        (from === undefined || vch.date >= from) &&
        (to === undefined || vch.date <= to)
    );
    inWindow.sort(
      (a, b) =>
        a.date - b.date ||
        dayRank(typeById.get(a.typeId)?.name) - dayRank(typeById.get(b.typeId)?.name) ||
        a.createdAt - b.createdAt ||
        a.voucherNo - b.voucherNo
    );

    return Promise.all(
      inWindow.map(async (vch) => {
        const type = typeById.get(vch.typeId);
        const lines = await ctx.db
          .query("voucherEntries")
          .withIndex("by_voucher", (q) => q.eq("voucherId", vch._id))
          .collect();
        return {
          contra: lines
            .filter((l) => l.ledgerId !== vch.partyLedgerId)
            .map((l) => ledgerById.get(l.ledgerId)?.name ?? "—"),
          _id: vch._id,
          date: vch.date,
          // When it was written, as against the date on it — the day book lists
          // the latest entry first, whatever day the bill itself is dated.
          createdAt: vch.createdAt,
          vchType: type?.name ?? "—",
          vchLabel: vchLabel(type?.abbr ?? "VCH", vch.voucherNo),
          party: ledgerById.get(vch.partyLedgerId)?.name ?? "—",
          partyLedgerId: vch.partyLedgerId,
          // Which side the party is on — a goods return can be either.
          partyGroup: groupById.get(ledgerById.get(vch.partyLedgerId)?.groupId as never)?.name,
          refNo: vch.refNo ?? "",
          narration: vch.narration ?? "",
          amount: vch.amount,
          status: vch.status,
          attachmentUrls: await urlsFor(ctx, vch.attachments),
        };
      })
    );
  },
});

/**
 * One side of the party ledgers, folded from the entries: creditors (what the
 * shop owes) or debtors (what the shop is owed). Both are running accounts —
 * no receipt is allocated against a particular bill, because neither the
 * suppliers' statements nor the shop's own slips work that way.
 */
async function partyRows(ctx: QueryCtx, groupName: string) {
  const { ledgers, groupById } = await context(ctx);
  const parties = ledgers.filter((l) => groupById.get(l.groupId)?.name === groupName);

  const allLines = await ctx.db.query("voucherEntries").collect();
  const byLedger = new Map<string, typeof allLines>();
  for (const line of allLines) {
    const key = line.ledgerId as string;
    if (!byLedger.has(key)) byLedger.set(key, []);
    byLedger.get(key)!.push(line);
  }

  const pendingAll = await ctx.db
    .query("vouchers")
    .withIndex("by_status", (q) => q.eq("status", "pending"))
    .collect();

  return parties.map((account) => {
    const lines = byLedger.get(account._id as string) ?? [];
    const debits = lines.filter((l) => l.side === "Dr").reduce((t, l) => t + l.amount, 0);
    const credits = lines.filter((l) => l.side === "Cr").reduce((t, l) => t + l.amount, 0);
    const closingSignedValue = round2(
      openingSigned(account) + lines.reduce((t, l) => t + signed(l.side, l.amount), 0)
    );
    return {
      ledger: account,
      opening: account.openingBalance,
      openingSide: account.openingSide,
      debits: round2(debits),
      credits: round2(credits),
      closing: Math.abs(closingSignedValue),
      closingSide: sideOf(closingSignedValue),
      signedClosing: closingSignedValue,
      pendingCount: pendingAll.filter((p) => p.partyLedgerId === account._id).length,
      voucherCount: new Set(lines.map((l) => l.voucherId)).size,
    };
  });
}

/** Finished with: nothing owed either way, and no bill left unpriced. */
const settled = (r: { signedClosing: number; pendingCount: number }) =>
  Math.abs(r.signedClosing) < 0.005 && r.pendingCount === 0;

function partyTotals(rows: Awaited<ReturnType<typeof partyRows>>) {
  // Netted, not added up in absolute terms: a party on the wrong side of their
  // usual balance reduces the total rather than adding to it.
  const net = round2(rows.reduce((t, r) => t + r.signedClosing, 0));
  return {
    debits: round2(rows.reduce((t, r) => t + r.debits, 0)),
    credits: round2(rows.reduce((t, r) => t + r.credits, 0)),
    closing: Math.abs(net),
    closingSide: sideOf(net),
    pendingCount: rows.reduce((t, r) => t + r.pendingCount, 0),
  };
}

/** What the shop owes — Tally's Outstanding Payables. */
export const outstanding = query({
  args: {},
  handler: async (ctx) => {
    const rows = await partyRows(ctx, "Sundry Creditors");
    // Whatever still needs doing comes first; settled accounts fall to the
    // bottom, where they can be scrolled past rather than read.
    rows.sort(
      (a, b) =>
        Number(settled(a)) - Number(settled(b)) || a.signedClosing - b.signedClosing
    );
    return { rows, totals: partyTotals(rows) };
  },
});

/** What the shop is owed — the customers running on credit. */
export const receivables = query({
  args: {},
  handler: async (ctx) => {
    const rows = await partyRows(ctx, "Sundry Debtors");
    rows.sort(
      (a, b) =>
        Number(settled(a)) - Number(settled(b)) || b.signedClosing - a.signedClosing
    );
    return { rows, totals: partyTotals(rows) };
  },
});

/**
 * The number that identifies a bill within one party's own series.
 *
 * Refs arrive both ways: "MS/2147/26-27" off a printed invoice, and a bare
 * "57" off a handwritten slip. In the printed form the financial year comes
 * along for the ride, so the bill number is the longest run of digits in the
 * ref — 2147, not the 26 or the 27 beside it.
 */
const billNo = (ref?: string) =>
  (String(ref ?? "").match(/\d+/g) ?? []).sort(
    (a, b) => b.length - a.length || Number(b) - Number(a)
  )[0] ?? "";

/**
 * Vouchers already in the books that look like the same bill as this one.
 *
 * A bill gets photographed into the queue and then, days later, entered again
 * off the supplier's statement — and the pending copy sits there for good,
 * because nothing ever told anyone it had been dealt with.
 *
 * The voucher type always has to agree, on every arm below. That is not
 * fussiness: a sale and the receipt against it carry the *same slip number*
 * quite properly, and seven such pairs sit in these books — ignoring type
 * would call every one of them a duplicate.
 *
 * What the match rests on is returned with it, because the three arms are not
 * equally sure of themselves and the queue is no use if it cries wolf:
 *
 * - `ref`  — same party, same bill number. As near certain as this gets.
 * - `slip` — same bill number and the same day, but a different party. The
 *   party is the field that gets misread (see src/lib/match.js: two customers
 *   can be one pen-stroke apart), so this is worth raising. It has to be the
 *   same day: slip numbers do come round again on these books — 04, 37, 59,
 *   64, 87 and 100 each sit on two unrelated sales weeks apart — and only the
 *   date tells a repeat from a re-entry.
 * - `date` — neither voucher carries a number at all, same party, same day.
 *   A question rather than a finding.
 */
type Twin = { voucher: Doc<"vouchers">; on: "ref" | "slip" | "date" };

function twinsOf(vch: Doc<"vouchers">, all: Doc<"vouchers">[]): Twin[] {
  const no = billNo(vch.refNo);
  const twins: Twin[] = [];

  for (const other of all) {
    if (other._id === vch._id) continue;
    if (other.typeId !== vch.typeId) continue;

    const otherNo = billNo(other.refNo);
    const sameParty = other.partyLedgerId === vch.partyLedgerId;
    const sameDay = other.date === vch.date;

    if (no && otherNo === no) {
      if (sameParty) twins.push({ voucher: other, on: "ref" });
      else if (sameDay) twins.push({ voucher: other, on: "slip" });
      continue;
    }
    if (!no && !otherNo && sameParty && sameDay) twins.push({ voucher: other, on: "date" });
  }

  return twins;
}

/** Bills filed without an amount — the queue that Tally has no place for. */
export const pendingBills = query({
  args: {},
  handler: async (ctx) => {
    const { ledgerById, typeById } = await context(ctx);
    // Every voucher, not just the pending ones: what makes this queue hard to
    // work is not knowing whether a bill is already in the books.
    const all = await ctx.db.query("vouchers").withIndex("by_date").collect();
    const pending = all.filter((vch) => vch.status === "pending");
    pending.sort((a, b) => a.date - b.date);
    return Promise.all(
      pending.map(async (vch) => ({
        _id: vch._id,
        date: vch.date,
        vchLabel: vchLabel(typeById.get(vch.typeId)?.abbr ?? "VCH", vch.voucherNo),
        party: ledgerById.get(vch.partyLedgerId)?.name ?? "—",
        partyLedgerId: vch.partyLedgerId,
        refNo: vch.refNo ?? "",
        narration: vch.narration ?? "",
        attachmentUrls: await urlsFor(ctx, vch.attachments),
        alreadyIn: twinsOf(vch, all).map(({ voucher: twin, on }) => ({
          _id: twin._id,
          vchLabel: vchLabel(typeById.get(twin.typeId)?.abbr ?? "VCH", twin.voucherNo),
          date: twin.date,
          amount: twin.amount ?? null,
          refNo: twin.refNo ?? "",
          party: ledgerById.get(twin.partyLedgerId)?.name ?? "—",
          partyLedgerId: twin.partyLedgerId,
          status: twin.status,
          on,
        })),
      }))
    );
  },
});

/**
 * Proof the books are square: every ledger's closing balance, by side.
 *
 * Every voucher balances — the mutations refuse one that does not — so the only
 * thing that can leave this report lopsided is the opening balances, which were
 * taken from the suppliers' statements with no contra side to enter them
 * against. Tally shows exactly that as "Difference in Opening Balances", and so
 * does this; with that line in, the totals agree.
 */
export const trialBalance = query({
  args: {},
  handler: async (ctx) => {
    const { ledgers, groupById } = await context(ctx);
    const lines = await ctx.db.query("voucherEntries").collect();

    const byLedger = new Map<string, typeof lines>();
    for (const line of lines) {
      const key = line.ledgerId as string;
      if (!byLedger.has(key)) byLedger.set(key, []);
      byLedger.get(key)!.push(line);
    }

    // Cash and bank are not being kept yet — only money going out is booked, so
    // their balances would be a half-story. They are left out of the report and
    // their net shown on one line, which is the only way the totals can still
    // be true.
    const NOT_KEPT = ["Cash-in-Hand", "Bank Accounts"];

    const all = ledgers
      .map((account) => {
        const mine = byLedger.get(account._id as string) ?? [];
        const bal = round2(
          openingSigned(account) +
            mine.reduce((t, l) => t + signed(l.side, l.amount), 0)
        );
        return {
          ledgerId: account._id,
          name: account.name,
          group: groupById.get(account.groupId)?.name ?? "—",
          debit: bal > 0 ? bal : 0,
          credit: bal < 0 ? -bal : 0,
        };
      })
      .filter((r) => r.debit !== 0 || r.credit !== 0);

    const rows = all.filter((r) => !NOT_KEPT.includes(r.group));
    const held = all.filter((r) => NOT_KEPT.includes(r.group));
    const heldNet = round2(held.reduce((t, r) => t + r.debit - r.credit, 0));
    const notMaintained = {
      debit: heldNet > 0 ? heldNet : 0,
      credit: heldNet < 0 ? -heldNet : 0,
      count: held.length,
    };

    rows.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

    // The openings net to a credit; the balancing figure sits opposite them.
    const openingNet = round2(ledgers.reduce((t, l) => t + openingSigned(l), 0));
    const openingDifference = {
      debit: openingNet < 0 ? -openingNet : 0,
      credit: openingNet > 0 ? openingNet : 0,
    };

    const debit = round2(
      rows.reduce((t, r) => t + r.debit, 0) + openingDifference.debit + notMaintained.debit
    );
    const credit = round2(
      rows.reduce((t, r) => t + r.credit, 0) + openingDifference.credit + notMaintained.credit
    );

    return {
      rows,
      openingDifference,
      notMaintained,
      debit,
      credit,
      difference: round2(debit - credit),
    };
  },
});

/**
 * The shop's front page, in one question.
 *
 * Home used to ask six separate queries and each of them walked the whole
 * ledger, so opening the panel took six passes over the same three tables to
 * answer things that share every one of their reads. This does the walk once.
 *
 * It answers only what the front page shows: the day, the two directions money
 * is owed, twelve months of trade, and who the largest balances belong to.
 * Anything more detailed is a screen of its own, and this should not grow into
 * a second copy of those.
 */
export const dashboard = query({
  args: { from: v.number(), to: v.number(), months: v.optional(v.number()) },
  handler: async (ctx, { from, to, months }) => {
    const { ledgers, groupById, typeById } = await context(ctx);
    const [vouchers, lines] = await Promise.all([
      ctx.db.query("vouchers").collect(),
      ctx.db.query("voucherEntries").collect(),
    ]);

    // ── the day ──────────────────────────────────────────────────────────
    const today = vouchers.filter((v) => v.date >= from && v.date <= to && v.status === "final");
    const sumOf = (name: string) =>
      round2(today.filter((v) => typeById.get(v.typeId)?.name === name)
        .reduce((t, v) => t + (v.amount ?? 0), 0));

    // ── twelve months of trade, oldest first ─────────────────────────────
    const span = months ?? 12;
    const edge = new Date(to);
    const series: { ym: string; label: string; sales: number; purchases: number }[] = [];
    const slot = new Map<string, number>();
    for (let back = span - 1; back >= 0; back--) {
      const d = new Date(Date.UTC(edge.getUTCFullYear(), edge.getUTCMonth() - back, 1));
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      slot.set(ym, series.length);
      series.push({
        ym,
        // "Apr" is enough on an axis; the year rides on the tooltip.
        label: d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }),
        sales: 0,
        purchases: 0,
      });
    }
    for (const voucher of vouchers) {
      if (voucher.status !== "final" || !voucher.amount) continue;
      const d = new Date(voucher.date);
      const at = slot.get(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
      if (at === undefined) continue;
      const name = typeById.get(voucher.typeId)?.name;
      if (name === "Sale") series[at].sales = round2(series[at].sales + voucher.amount);
      else if (name === "Purchase") series[at].purchases = round2(series[at].purchases + voucher.amount);
    }

    // ── who owes, and who is owed ────────────────────────────────────────
    const byLedger = new Map<string, number>();
    for (const line of lines) {
      const key = line.ledgerId as string;
      byLedger.set(key, (byLedger.get(key) ?? 0) + signed(line.side, line.amount));
    }
    const balances = ledgers.map((account) => ({
      ledgerId: account._id,
      name: account.name,
      group: groupById.get(account.groupId)?.name ?? "—",
      signed: round2(openingSigned(account) + (byLedger.get(account._id as string) ?? 0)),
    }));

    const debtors = balances.filter((b) => b.group === "Sundry Debtors");
    const creditors = balances.filter((b) => b.group === "Sundry Creditors");
    const top = (rows: typeof balances, sign: 1 | -1) =>
      rows.filter((r) => r.signed * sign > 0)
        .sort((a, b) => (b.signed - a.signed) * sign)
        .slice(0, 6)
        .map((r) => ({ ledgerId: r.ledgerId, name: r.name, amount: Math.abs(r.signed) }));

    return {
      day: {
        sales: sumOf("Sale"),
        purchases: sumOf("Purchase"),
        received: sumOf("Receipt"),
        paid: sumOf("Payment"),
        entries: today.length,
      },
      /**
       * Owed each way, gross — not netted against each other.
       *
       * The party reports net every balance into one figure, which turns
       * ₹2.35L owed by customers and ₹2.02L of customer money held against no
       * bill into a single "₹32,635 receivable" that is true of nobody. A
       * front page has to show both sides or it is worse than showing neither.
       */
      receivable: round2(debtors.reduce((t, r) => t + Math.max(r.signed, 0), 0)),
      payable: round2(creditors.reduce((t, r) => t + Math.max(-r.signed, 0), 0)),
      // Money taken from a customer with no sale behind it, and the same the
      // other way round — advances, or a bill somebody has not written up.
      customerCredit: round2(debtors.reduce((t, r) => t + Math.max(-r.signed, 0), 0)),
      supplierAdvance: round2(creditors.reduce((t, r) => t + Math.max(r.signed, 0), 0)),
      months: series,
      topOwing: top(debtors, 1),
      topOwed: top(creditors, -1),
      unpriced: vouchers.filter((v) => v.status === "pending").length,
    };
  },
});
