import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { record, money } from "./lib/history";
import { requirePin } from "./lib/pin";
import { fold } from "./lib/parties";

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
 * was doing at the time: "simran ply" and "SIMRAN PLY" both become "Simran
 * Ply".
 *
 * Deliberate acronyms survive — SRT, IOB, UCO stay as they are — unless the
 * whole name was shouted, in which case there was no intent to preserve and
 * every word is set properly.
 */
export const properCase = (name: string) => {
  const clean = name.trim().replace(/\s+/g, " ");
  const shouted = clean === clean.toUpperCase();

  return clean
    .split(" ")
    .map((word) => {
      if (/^m\/s$/i.test(word)) return "M/s";
      const letters = word.replace(/[^A-Za-z]/g, "");
      const isAcronym =
        letters.length > 0 && letters.length <= 4 && letters === letters.toUpperCase();
      if (isAcronym && !shouted) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
};

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

    const clash = await ctx.db
      .query("ledgers")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (clash) throw new Error(`A ledger named "${name}" already exists`);
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
    }
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });
    const changed = Object.keys(patch).filter(
      (k) => (before as Record<string, unknown> | null)?.[k] !== (patch as Record<string, unknown>)[k]
    );
    await record(
      ctx,
      "ledger.update",
      `Changed ${before?.name ?? "ledger"}${changed.length ? `: ${changed.join(", ")}` : ""}`,
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
  args: { pin: v.string(), id: v.id("ledgers")},
  handler: async (ctx, { pin, id }) => {
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

    const ledger = await ctx.db.get(id);
    await ctx.db.delete(id);
    await record(ctx, "ledger.remove", `Removed empty ledger ${ledger?.name ?? ""}`, {
      entity: "ledger",
      entityId: id,
    });
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
