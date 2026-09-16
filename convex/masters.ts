import { mutation, query } from "./_generated/server";
import { properText } from "./lib/text";
import { v, ConvexError } from "convex/values";
import { record, money } from "./lib/history";
import { round2 } from "./lib/money";
import { requirePin } from "./lib/pin";
import { fold } from "./lib/parties";
import { carryRename } from "./lib/rename";

/** The groups whose ledgers are people the shop deals with. */
const PARTY_GROUPS = ["Sundry Creditors", "Sundry Debtors"];

/** Tally's group names, said the way the shop says them. */
const GROUP_LABELS: Record<string, string> = {
  "Sundry Creditors": "Suppliers",
  "Sundry Debtors": "Customers",
  "Purchase Accounts": "Purchases",
  "Sales Accounts": "Sales",
  "Cash-in-Hand": "Cash",
  "Bank Accounts": "Bank",
};
const label = (name?: string) => (name ? GROUP_LABELS[name] ?? name : "—");

/**
 * Names are written the way they are written on paper, whatever the keyboard
 * was doing at the time — the shop's one rule, in lib/text: proper case, codes
 * in capitals ("240 HDG", "CGST"), capitals typed on purpose kept ("SRT"),
 * caps lock set right ("SIMRAN PLY" → "Simran Ply").
 */
export const properCase = (name: string) => properText(name);

/**
 * Firms are written "M/s" on every bill the shop sends or receives, so they
 * are written that way here too. Applied at the door, so it holds however the
 * ledger was opened — the form, or a name typed straight into a voucher.
 */
export const withCourtesy = (name: string, groupName?: string) => {
  const clean = properCase(name);
  if (!groupName || !PARTY_GROUPS.includes(groupName)) return clean;
  return /^m\/s\b/i.test(clean) ? clean : `M/s ${clean}`;
};

export const all = query({
  args: {},
  handler: async (ctx) => {
    const [groups, ledgers, voucherTypes] = await Promise.all([
      ctx.db.query("groups").collect(),
      ctx.db.query("ledgers").collect(),
      ctx.db.query("voucherTypes").collect(),
    ]);
    groups.sort((a, b) => a.sort - b.sort);
    ledgers.sort((a, b) => a.name.localeCompare(b.name));
    const groupById = new Map(groups.map((g) => [g._id, g]));
    return {
      groups,
      voucherTypes: voucherTypes.sort((a, b) => a.sort - b.sort),
      ledgers: ledgers.map((l) => ({
        ...l,
        groupName: groupById.get(l.groupId)?.name ?? "—",
      })),
    };
  },
});

export const createLedger = mutation({
  args: {
    name: v.string(),
    groupId: v.id("groups"),
    place: v.optional(v.string()),
    phone: v.optional(v.string()),
    gstin: v.optional(v.string()),
    aadhaar: v.optional(v.string()),
    openingBalance: v.number(),
    openingSide: v.union(v.literal("Dr"), v.literal("Cr")),
    openingAsOf: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    const name = withCourtesy(args.name, group?.name);
    // However it was typed — spaces, dashes — an Aadhaar is twelve digits.
    const aadhaar = args.aadhaar
      ? args.aadhaar.replace(/\D/g, "") || undefined
      : undefined;

    // The same party written another way is the same party: "W/B" is "WB",
    // "E. Ahmed" is "E Ahmed". Refused on the same side of the books only — a
    // customer and a supplier of one name are two accounts on purpose.
    const clash = (await ctx.db.query("ledgers").collect()).find(
      (l) => l.name === name || (l.groupId === args.groupId && fold(l.name) === fold(name))
    );
    if (clash) throw new ConvexError(`"${clash.name}" already exists — use that account.`);
    const now = Date.now();
    const id = await ctx.db.insert("ledgers", {
      ...args,
      name,
      aadhaar,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await record(
      ctx,
      "ledger.create",
      `Opened ledger ${name} under ${label(group?.name)}` +
        (args.openingBalance
          ? `, opening ${money(args.openingBalance)} ${args.openingSide}`
          : ""),
      { entity: "ledger", entityId: id }
    );
    return id;
  },
});

export const updateLedger = mutation({
  args: {
    id: v.id("ledgers"),
    name: v.optional(v.string()),
    place: v.optional(v.string()),
    phone: v.optional(v.string()),
    gstin: v.optional(v.string()),
    aadhaar: v.optional(v.string()),
    openingBalance: v.optional(v.number()),
    openingSide: v.optional(v.union(v.literal("Dr"), v.literal("Cr"))),
    openingAsOf: v.optional(v.number()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const before = await ctx.db.get(id);
    if (patch.aadhaar !== undefined) {
      patch.aadhaar = patch.aadhaar.replace(/\D/g, "") || undefined;
    }
    if (patch.name && before) {
      const group = await ctx.db.get(before.groupId);
      patch.name = withCourtesy(patch.name, group?.name);
      const renamed = patch.name;
      const clash = (await ctx.db.query("ledgers").collect()).find(
        (l) => l._id !== id && (l.name === renamed || (l.groupId === before.groupId && fold(l.name) === fold(renamed)))
      );
      if (clash) throw new ConvexError(`"${clash.name}" already exists — use that account.`);
    }
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });

    // A rename is only a rename if the old name goes everywhere it was written.
    let carried = "";
    if (before && patch.name && patch.name !== before.name) {
      const group = await ctx.db.get(before.groupId);
      const copies = await carryRename(ctx, before, patch.name, group?.name !== "Sundry Creditors");
      const parts = [
        copies.bills && `${copies.bills} bill${copies.bills === 1 ? "" : "s"}`,
        copies.binned && `${copies.binned} in the bin`,
        copies.customers && `${copies.customers} customer record${copies.customers === 1 ? "" : "s"}`,
      ].filter(Boolean);
      if (parts.length) carried = ` — renamed on ${parts.join(", ")}`;
    }

    const changed = Object.keys(patch).filter(
      (k) => (before as Record<string, unknown> | null)?.[k] !== (patch as Record<string, unknown>)[k]
    );
    await record(
      ctx,
      "ledger.update",
      `Changed ${before?.name ?? "ledger"}${changed.length ? `: ${changed.join(", ")}` : ""}${carried}`,
      { entity: "ledger", entityId: id, detail: patch }
    );
  },
});

/**
 * How much is posted to each account.
 *
 * The list uses this to say which accounts can be deleted before anyone tries:
 * a refusal after the fact, behind a confirmation and a code, is a poor way to
 * learn that an account has twelve vouchers on it.
 */
export const usage = query({
  args: {},
  handler: async (ctx) => {
    const counts: Record<string, number> = {};
    for (const vch of await ctx.db.query("vouchers").collect()) {
      const key = vch.partyLedgerId as string;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    // An account can also be the other side of an entry — Sales, Bank, an
    // expense head — without ever being the party on one.
    for (const line of await ctx.db.query("voucherEntries").collect()) {
      const key = line.ledgerId as string;
      if (!(key in counts)) counts[key] = 0;
      counts[key] = Math.max(counts[key], 1);
    }
    return counts;
  },
});

/** Removes a ledger, refusing while anything is posted to it. */
export const removeLedger = mutation({
  args: {
    pin: v.string(),
    id: v.id("ledgers"),
    /**
     * Destroy what the bin still holds against this account, and then delete
     * it. Asked for a second time in the UI, because this is the one way the
     * account can go and what goes with it does not come back.
     */
    purgeTrash: v.optional(v.boolean()),
  },
  handler: async (ctx, { pin, id, purgeTrash }) => {
    requirePin(pin);
    const lines = await ctx.db
      .query("voucherEntries")
      .withIndex("by_ledger", (q) => q.eq("ledgerId", id))
      .first();
    // ConvexError, not Error: a plain Error reaches the browser as "Server
    // Error" with the reason stripped, and the reason is the whole message.
    if (lines) {
      throw new ConvexError("This account has entries posted to it — it cannot be deleted.");
    }

    const voucher = await ctx.db
      .query("vouchers")
      .withIndex("by_party", (q) => q.eq("partyLedgerId", id))
      .first();
    if (voucher) {
      throw new ConvexError("This account has vouchers against it — it cannot be deleted.");
    }

    /**
     * The trash counts as well.
     *
     * A deleted voucher keeps the account it was posted against, and its lines
     * keep theirs, so that a restore puts the balances back exactly. Checking
     * only the live books let an account be deleted while its voucher sat in
     * the bin — and restoring it afterwards wrote lines against an account
     * that no longer existed: money in the trial balance belonging to nobody,
     * in a party statement that could never be opened.
     */
    const binned = (await ctx.db.query("trash").collect()).filter(
      (row) => row.partyLedgerId === id || row.entries.some((e) => e.ledgerId === id)
    );
    const binnedBills = (await ctx.db.query("billsTrash").collect()).filter(
      (row) => row.bill?.ledgerId === id
    );
    if ((binned.length || binnedBills.length) && !purgeTrash) {
      // Structured, so the screen can offer the way through rather than just
      // reporting the wall: it says what is in the bin and what it would cost.
      throw new ConvexError({
        kind: "trash",
        vouchers: binned.length,
        bills: binnedBills.length,
        message:
          "This account has something in the trash — it can go, but what the bin holds against it goes for good with it.",
      });
    }

    // Asked for: the bin's hold on this account is destroyed, bill photographs
    // and all, and only then does the account itself go. Nothing is left
    // pointing at an account that no longer exists.
    for (const row of binned) {
      for (const doc of row.attachments ?? []) {
        await ctx.storage.delete(typeof doc === "string" ? doc : doc.storageId).catch(() => {});
      }
      await ctx.db.delete(row._id);
    }
    for (const row of binnedBills) {
      await ctx.db.delete(row._id);
    }

    const ledger = await ctx.db.get(id);
    await ctx.db.delete(id);
    const alsoGone = binned.length + binnedBills.length;
    await record(
      ctx,
      "ledger.remove",
      alsoGone
        ? `Removed ledger ${ledger?.name ?? ""} and purged ${alsoGone} binned ${alsoGone === 1 ? "entry" : "entries"} with it`
        : `Removed empty ledger ${ledger?.name ?? ""}`,
      { entity: "ledger", entityId: id },
    );
  },
});

/**
 * Opens the accounts the shop's own spending needs.
 *
 * Not every photograph is a customer or a supplier — fare, cartage and the
 * odd repair are money out with no party to owe. Master data rather than
 * administration, so it sits here beside createLedger.
 */
export const setUpExpenses = mutation({
  args: {},
  handler: async (ctx) => {
    const made: string[] = [];

    let group = await ctx.db
      .query("groups")
      .withIndex("by_name", (q) => q.eq("name", "Indirect Expenses"))
      .unique();
    if (!group) {
      const id = await ctx.db.insert("groups", {
        name: "Indirect Expenses",
        nature: "expense",
        normalSide: "Dr",
        sort: 7,
      });
      group = (await ctx.db.get(id))!;
      made.push("Indirect Expenses");
    }

    const type = await ctx.db
      .query("voucherTypes")
      .withIndex("by_name", (q) => q.eq("name", "Expense"))
      .unique();
    if (!type) {
      await ctx.db.insert("voucherTypes", { name: "Expense", abbr: "EXP", sort: 8 });
      made.push("Expense voucher type");
    }

    const ledgers = await ctx.db.query("ledgers").collect();
    const now = Date.now();
    for (const name of ["Fare & Cartage", "Shop Expenses"]) {
      if (ledgers.some((l) => l.name === name)) continue;
      await ctx.db.insert("ledgers", {
        name,
        groupId: group._id,
        openingBalance: 0,
        openingSide: "Dr",
        openingAsOf: now,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      made.push(name);
    }
    return { made };
  },
});

/** Puts a colour mark on an account, or takes one off. */
export const toggleTag = mutation({
  args: { id: v.id("ledgers"), tag: v.string() },
  handler: async (ctx, { id, tag }) => {
    const ledger = await ctx.db.get(id);
    if (!ledger) throw new Error("No such account");
    const held = ledger.tags ?? [];
    const tags = held.includes(tag) ? held.filter((t) => t !== tag) : [...held, tag];
    await ctx.db.patch(id, { tags, updatedAt: Date.now() });
    return tags;
  },
});

/**
 * Put the address back into the name, which is how this shop writes a party:
 * "Santosh Singh Ji, Purnimandap" — who, then where, as one name.
 *
 * Most accounts are already written that way. The ones that are not were filed
 * with the village in its own `place` field, so the two halves print and read
 * differently from every other account in the books. This merges them.
 *
 * Run it with `dryRun: true` first: it reports exactly what it would rewrite
 * and changes nothing. Renaming an account is not a small thing — a bill names
 * its party in free text, so the rename has to leave every old spelling still
 * finding the account, which `findParty` now handles.
 */
const PLACEHOLDER = /^(—|-|–|n\/?a|na|nil|none|\.)$/i

export const mergePlaceIntoName = mutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const ledgers = await ctx.db.query("ledgers").collect();
    const changed: { from: string; to: string }[] = [];
    const skipped: { name: string; why: string }[] = [];

    for (const l of ledgers) {
      const place = String(l.place ?? "").trim();
      if (!place) continue;

      // A dash typed to mean "no address" is not an address.
      if (PLACEHOLDER.test(place)) {
        skipped.push({ name: l.name, why: `place is a placeholder (${place})` });
        if (!dryRun) await ctx.db.patch(l._id, { place: undefined, updatedAt: Date.now() });
        continue;
      }

      // Already written the shop's way; just let the duplicate field go.
      if (l.name.toLowerCase().includes(place.toLowerCase())) {
        skipped.push({ name: l.name, why: "name already carries the address" });
        if (!dryRun) await ctx.db.patch(l._id, { place: undefined, updatedAt: Date.now() });
        continue;
      }

      const merged = `${l.name.trim().replace(/,\s*$/, "")}, ${place}`;

      // Never merge onto a name another account already answers to — that
      // would be two accounts with one name and a balance split between them.
      const clash = ledgers.find(
        (o) => o._id !== l._id && fold(o.name) === fold(merged),
      );
      if (clash) {
        skipped.push({ name: l.name, why: `"${merged}" is already another account` });
        continue;
      }

      changed.push({ from: l.name, to: merged });
      if (!dryRun) {
        await ctx.db.patch(l._id, { name: merged, place: undefined, updatedAt: Date.now() });
      }
    }

    if (!dryRun && changed.length) {
      await record(
        ctx,
        "ledger.merge-place",
        `Merged the address into the name on ${changed.length} account(s)`,
        {},
      );
    }
    return { dryRun: Boolean(dryRun), changed, skipped };
  },
});

/**
 * One party, one account.
 *
 * The books opened accounts by two doors — the account form, which wrote "M/s"
 * in front of a firm's name, and a name typed straight onto a bill, which did
 * not. The two never recognised each other, so a firm could end up with
 * "Pappu Jee", "Pappu Jee, Naisarai" and "M/s Pappu Jee, Naisarai" and its
 * balance split three ways.
 *
 * `fold` now ignores the courtesy, so no more of these will be made. This
 * gathers up the ones already there: everything that points at a duplicate is
 * repointed at the survivor, and the emptied accounts are removed.
 *
 * Run with `dryRun: true` first. Merging accounts moves entries between them
 * and is not a thing to do twice by accident.
 */
/** The opening balance as one signed figure, so two can be added together. */
const signedOpening = (l: { openingSide: "Dr" | "Cr"; openingBalance: number }) =>
  l.openingSide === "Cr" ? -l.openingBalance : l.openingBalance;

export const mergeDuplicateParties = mutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const groups = await ctx.db.query("groups").collect();
    const partyGroupIds = new Set(
      groups.filter((g) => PARTY_GROUPS.includes(g.name)).map((g) => g._id as string),
    );
    const ledgers = (await ctx.db.query("ledgers").collect())
      .filter((l) => partyGroupIds.has(l.groupId as string));

    // Same name, and never across the two sides of the books: a customer and a
    // supplier of one name are two accounts on purpose.
    const families = new Map<string, typeof ledgers>();
    for (const l of ledgers) {
      const key = `${l.groupId}::${fold(l.name)}`;
      families.set(key, [...(families.get(key) ?? []), l]);
    }

    const entries = await ctx.db.query("voucherEntries").collect();
    const vouchers = await ctx.db.query("vouchers").collect();
    const papers = await ctx.db.query("papers").collect();
    const billLines = await ctx.db.query("billLines").collect();
    const cashEntries = await ctx.db.query("cashEntries").collect();
    const lessons = await ctx.db.query("lessons").collect();

    /** Which account each removed one was folded into. */
    const remap = new Map<string, string>();
    const merged: {
      kept: string; absorbed: string[]; movedEntries: number; movedVouchers: number;
    }[] = [];

    for (const family of families.values()) {
      if (family.length < 2) continue;

      // The account with the most history wins, so the fewest references move.
      // A tie goes to the one already written the shop's way.
      const weight = (l: (typeof family)[number]) =>
        entries.filter((e) => e.ledgerId === l._id).length;
      const survivor = [...family].sort(
        (a, b) =>
          weight(b) - weight(a) ||
          Number(/^m\/s/i.test(b.name)) - Number(/^m\/s/i.test(a.name)) ||
          b.name.length - a.name.length,
      )[0];
      const losers = family.filter((l) => l._id !== survivor._id);

      let movedEntries = 0;
      let movedVouchers = 0;
      let opening = signedOpening(survivor);

      for (const loser of losers) {
        remap.set(loser._id as string, survivor._id as string);

        for (const e of entries.filter((e) => e.ledgerId === loser._id)) {
          movedEntries++;
          if (!dryRun) await ctx.db.patch(e._id, { ledgerId: survivor._id });
        }
        for (const v0 of vouchers.filter((v) => v.partyLedgerId === loser._id)) {
          movedVouchers++;
          if (!dryRun) await ctx.db.patch(v0._id, { partyLedgerId: survivor._id });
        }
        for (const row of papers.filter((r) => r.ledgerId === loser._id)) {
          if (!dryRun) await ctx.db.patch(row._id, { ledgerId: survivor._id });
        }
        for (const row of billLines.filter((r) => r.partyLedgerId === loser._id)) {
          if (!dryRun) await ctx.db.patch(row._id, { partyLedgerId: survivor._id });
        }
        for (const row of cashEntries.filter((r: any) => r.ledgerId === loser._id)) {
          if (!dryRun) await ctx.db.patch(row._id, { ledgerId: survivor._id } as any);
        }
        for (const row of lessons.filter((r: any) => r.ledgerId === loser._id)) {
          if (!dryRun) await ctx.db.patch(row._id, { ledgerId: survivor._id } as any);
        }

        // An opening balance on a duplicate is still the party's money.
        opening += signedOpening(loser);
        // Keep a phone the survivor never had.
        if (loser.phone && !survivor.phone && !dryRun) {
          await ctx.db.patch(survivor._id, { phone: loser.phone });
        }
        if (!dryRun) await ctx.db.delete(loser._id);
      }

      if (!dryRun) {
        await ctx.db.patch(survivor._id, {
          openingBalance: Math.abs(round2(opening)),
          openingSide: opening < 0 ? ("Cr" as const) : ("Dr" as const),
          updatedAt: Date.now(),
        });
      }

      merged.push({
        kept: survivor.name,
        absorbed: losers.map((l) => l.name),
        movedEntries,
        movedVouchers,
      });
    }

    // The counter's own copy of a bill remembers the account it posted to, so
    // it has to follow — otherwise reopening it would point at nothing.
    if (!dryRun && remap.size) {
      const store = await ctx.db.query("billsStore").first();
      if (store) {
        const bills = (store.bills ?? []).map((b: any) =>
          b?.ledgerId && remap.has(b.ledgerId)
            ? { ...b, ledgerId: remap.get(b.ledgerId) }
            : b,
        );
        await ctx.db.patch(store._id, { bills });
      }
      await record(
        ctx,
        "ledger.merge-duplicates",
        `Merged ${remap.size} duplicate account(s) into ${merged.length} party account(s)`,
        {},
      );
    }

    return { dryRun: Boolean(dryRun), merged };
  },
});
