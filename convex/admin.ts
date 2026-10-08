import { v } from "convex/values";
import { mutation } from "./lib/guarded";
import { record } from "./lib/history";
import { withCourtesy, properCase } from "./masters";
import { requirePin } from "./lib/pin";

/** Clears every book. Used before a re-seed; there is no undo. */
export const wipe = mutation({
  args: { pin: v.string() },
  handler: async (ctx, { pin }) => {
    requirePin(pin);
    let deleted = 0;
    for (const table of [
      "voucherEntries",
      "vouchers",
      "trash",
      "ledgers",
      "groups",
      "voucherTypes",
      "counters",
    ] as const) {
      for (const doc of await ctx.db.query(table).collect()) {
        await ctx.db.delete(doc._id);
        deleted++;
      }
    }
    await record(ctx, "admin.wipe", `Cleared the books — ${deleted} records removed`);
    return { deleted };
  },
});

/**
 * Opens the receivable side of the books on a deployment that only had the
 * purchase side. Idempotent — it inserts what is missing and leaves the rest
 * alone, so it is safe to run again.
 */
export const enableSalesSide = mutation({
  args: { pin: v.string() },
  handler: async (ctx, { pin }) => {
    requirePin(pin);
    const groups = await ctx.db.query("groups").collect();
    const byName = new Map(groups.map((g) => [g.name, g]));

    // Reordered so the two party groups sit together in every picker.
    const wanted = [
      { name: "Sundry Creditors", nature: "liability", normalSide: "Cr", sort: 1 },
      { name: "Sundry Debtors", nature: "asset", normalSide: "Dr", sort: 2 },
      { name: "Purchase Accounts", nature: "expense", normalSide: "Dr", sort: 3 },
      { name: "Sales Accounts", nature: "income", normalSide: "Cr", sort: 4 },
      { name: "Cash-in-Hand", nature: "asset", normalSide: "Dr", sort: 5 },
      { name: "Bank Accounts", nature: "asset", normalSide: "Dr", sort: 6 },
    ] as const;

    const added: string[] = [];
    for (const g of wanted) {
      const existing = byName.get(g.name);
      if (existing) {
        if (existing.sort !== g.sort) await ctx.db.patch(existing._id, { sort: g.sort });
      } else {
        byName.set(g.name, {
          ...g,
          _id: await ctx.db.insert("groups", { ...g }),
        } as never);
        added.push(g.name);
      }
    }

    const types = await ctx.db.query("voucherTypes").collect();
    for (const t of [
      { name: "Sale", abbr: "SAL", sort: 3 },
      { name: "Receipt", abbr: "RCT", sort: 4 },
    ]) {
      if (!types.some((existing) => existing.name === t.name)) {
        await ctx.db.insert("voucherTypes", t);
        added.push(t.name);
      }
    }

    const salesGroup = byName.get("Sales Accounts")!;
    const sales = await ctx.db
      .query("ledgers")
      .withIndex("by_name", (q) => q.eq("name", "Sales"))
      .unique();
    if (!sales) {
      const now = Date.now();
      await ctx.db.insert("ledgers", {
        name: "Sales",
        groupId: salesGroup._id,
        openingBalance: 0,
        openingSide: "Cr",
        openingAsOf: now,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      added.push("Sales");
    }

    if (added.length) {
      await record(ctx, "admin.migrate", `Opened the sales side: ${added.join(", ")}`);
    }
    return { added };
  },
});

/**
 * Rewrites every voucher's particulars to the shop's standard word for its
 * type — Purchase, Payment, Sale, Receipt. The seeded vouchers carried each
 * supplier's own wording ("SALES @ 18%", "TAX INVOICE", "Against account");
 * this brings the whole register onto one vocabulary.
 */
export const normalizeParticulars = mutation({
  args: { pin: v.string() },
  handler: async (ctx, { pin }) => {
    requirePin(pin);
    const types = await ctx.db.query("voucherTypes").collect();
    const nameById = new Map(types.map((t) => [t._id, t.name]));
    const WORD: Record<string, string> = {
      Purchase: "Purchase",
      Payment: "Payment",
      Sale: "Sale",
      Receipt: "Receipt",
    };

    const changed: string[] = [];
    for (const voucher of await ctx.db.query("vouchers").collect()) {
      const word = WORD[nameById.get(voucher.typeId) ?? ""];
      if (!word || voucher.narration === word) continue;
      changed.push(`${voucher.narration ?? "—"} → ${word}`);
      await ctx.db.patch(voucher._id, { narration: word, updatedAt: Date.now() });
    }
    if (changed.length) {
      await record(ctx, "admin.migrate",
        `Standardised particulars on ${changed.length} vouchers`);
    }
    return { changed: changed.length };
  },
});

/**
 * Collapses every bank ledger into a single "Bank". The shop does not want its
 * money split across Paytm, UCO and HDFC in these books, so the entries are
 * repointed at one account and the empty ledgers removed. Cash stays separate —
 * cash in the drawer is not the same thing as money in a bank.
 */
export const mergeBanks = mutation({
  args: { pin: v.string() },
  handler: async (ctx, { pin }) => {
    requirePin(pin);
    const groups = await ctx.db.query("groups").collect();
    const bankGroup = groups.find((g) => g.name === "Bank Accounts");
    if (!bankGroup) throw new Error("No Bank Accounts group");

    const banks = await ctx.db
      .query("ledgers")
      .withIndex("by_group", (q) => q.eq("groupId", bankGroup._id))
      .collect();

    const now = Date.now();
    let target = banks.find((l) => l.name === "Bank");
    if (!target) {
      const id = await ctx.db.insert("ledgers", {
        name: "Bank",
        groupId: bankGroup._id,
        openingBalance: 0,
        openingSide: "Dr",
        openingAsOf: now,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      target = (await ctx.db.get(id))!;
    }

    const merged: string[] = [];
    let lines = 0;
    for (const bank of banks) {
      if (bank._id === target._id) continue;

      const entries = await ctx.db
        .query("voucherEntries")
        .withIndex("by_ledger", (q) => q.eq("ledgerId", bank._id))
        .collect();
      for (const entry of entries) {
        await ctx.db.patch(entry._id, { ledgerId: target._id });
        lines += 1;
      }

      // A bank is never the party on a voucher, but check before deleting.
      const asParty = await ctx.db
        .query("vouchers")
        .withIndex("by_party", (q) => q.eq("partyLedgerId", bank._id))
        .first();
      if (asParty) throw new Error(`${bank.name} is the party on a voucher — not merging`);

      // Opening balances carry over to the surviving account.
      if (bank.openingBalance !== 0) {
        const signed = (side: "Dr" | "Cr", n: number) => (side === "Dr" ? n : -n);
        const total =
          signed(target.openingSide, target.openingBalance) +
          signed(bank.openingSide, bank.openingBalance);
        await ctx.db.patch(target._id, {
          openingBalance: Math.abs(total),
          openingSide: total >= 0 ? "Dr" : "Cr",
        });
      }

      await ctx.db.delete(bank._id);
      merged.push(bank.name);
    }

    if (merged.length) {
      await record(ctx, "admin.migrate",
        `Merged ${merged.join(", ")} into one Bank ledger, ${lines} entries repointed`);
    }
    return { merged, lines };
  },
});

/**
 * Gives every attachment a type. Before this they were bare storage ids, so
 * nothing could say whether a photo was the challan or the bill. Payments and
 * receipts get "receipt"; purchases start as "bill" and are corrected from
 * there. Safe to run again — anything already labelled is left alone.
 */
export const labelAttachments = mutation({
  args: { pin: v.string() },
  handler: async (ctx, { pin }) => {
    requirePin(pin);
    const types = await ctx.db.query("voucherTypes").collect();
    const nameById = new Map(types.map((t) => [t._id, t.name]));

    let changed = 0;
    for (const voucher of await ctx.db.query("vouchers").collect()) {
      if (!voucher.attachments.some((a) => typeof a === "string")) continue;
      const type = nameById.get(voucher.typeId) ?? "";
      const kind = type === "Payment" || type === "Receipt" ? "receipt" : "bill";
      await ctx.db.patch(voucher._id, {
        attachments: voucher.attachments.map((a) =>
          typeof a === "string" ? { storageId: a, kind } : a
        ),
      });
      changed += 1;
    }

    for (const row of await ctx.db.query("trash").collect()) {
      if (!row.attachments.some((a) => typeof a === "string")) continue;
      const type = nameById.get(row.typeId) ?? "";
      const kind = type === "Payment" || type === "Receipt" ? "receipt" : "bill";
      await ctx.db.patch(row._id, {
        attachments: row.attachments.map((a) =>
          typeof a === "string" ? { storageId: a, kind } : a
        ),
      });
      changed += 1;
    }

    if (changed) {
      await record(ctx, "admin.migrate", `Labelled documents on ${changed} vouchers`);
    }
    return { changed };
  },
});

/** Writes "M/s" in front of every supplier and customer that lacks it. */
export const addCourtesyTitles = mutation({
  args: { pin: v.string() },
  handler: async (ctx, { pin }) => {
    requirePin(pin);
    const groups = await ctx.db.query("groups").collect();
    const groupById = new Map(groups.map((g) => [g._id, g.name]));

    const renamed: string[] = [];
    for (const ledger of await ctx.db.query("ledgers").collect()) {
      const group = groupById.get(ledger.groupId);
      const proper = group && ["Sundry Creditors", "Sundry Debtors"].includes(group)
        ? withCourtesy(ledger.name, group)
        : properCase(ledger.name);
      if (proper === ledger.name) continue;
      await ctx.db.patch(ledger._id, { name: proper, updatedAt: Date.now() });
      renamed.push(`${ledger.name} → ${proper}`);
    }
    if (renamed.length) {
      await record(ctx, "ledger.update", `Wrote M/s on ${renamed.length} parties`,
        { detail: renamed });
    }
    return { renamed };
  },
});
