import { internalMutation, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { record } from "./lib/history";
import { requirePin } from "./lib/pin";
import { properText } from "./lib/text";
import { api } from "./_generated/api";

/**
 * Where each piece of paper goes.
 *
 * The books know what every bill says. This is the only thing that knows where
 * the bill itself is — and it is the half that turns a few thousand loose slips
 * into customer bundles without anybody holding the whole shop in their head.
 *
 * The arrangement is the shop's own: one tray of unsorted paper, and numbered
 * bookmarks on the table beside it. A slip is photographed, its customer is
 * named, and the app answers with a bookmark number — the same number every
 * time for that customer, so their bills gather in one place however scattered
 * they were in the tray. When a customer's packet is done it goes into their
 * folder and the bookmark comes free for the next customer.
 *
 * So the bookmarks are not one per customer for ever. They are a working
 * surface, reused all day; the folders are where paper actually lives. There
 * is no ceiling on them — a number is handed out whenever one is needed, and a
 * freed number is handed out again before a higher one, so a shop that files
 * as it goes rarely sees a big number at all.
 */

const PLAN_KEY = "current";

/**
 * How many slips ahead the photographs are pulled down.
 *
 * Four is about as far as a hand gets in front of the screen. More would be
 * fetching pictures of paper that may never be reached this sitting.
 */
const AHEAD = 4;

/**
 * How many bookmarks the table holds. `null` is unlimited, and is the default.
 *
 * It used to be forty, and forty is what the two-walk design was built around:
 * naming and placing were split into separate passes precisely so that a slot
 * was spent only when paper reached it, because spending one at naming time
 * emptied the table before the first hundred slips were placed.
 *
 * Unlimited does not make that split pointless — naming still has to happen
 * before placing, since the app cannot call out a bookmark for a slip whose
 * customer it does not yet know. What it removes is the jam: "every bookmark
 * is taken, go and file a packet" in the middle of a stack of two thousand.
 * Numbers are still handed out lowest-free-first and still come back when a
 * packet is filed, so they stay small and readable; they simply carry on past
 * forty when a sort genuinely needs them to.
 */
const SLOTS_BY_DEFAULT: number | null = null;

const planRow = (ctx: QueryCtx | MutationCtx) =>
  ctx.db
    .query("filingPlan")
    .withIndex("by_key", (q) => q.eq("key", PLAN_KEY))
    .unique();

/** How many bookmarks are laid out, or null when there is no limit. */
async function slotCount(ctx: QueryCtx | MutationCtx): Promise<number | null> {
  return (await planRow(ctx))?.slotCount ?? SLOTS_BY_DEFAULT;
}

/** S07 — how a slot is written on the table and on the screen. */
export const slotLabel = (slot: number) => `S${String(slot).padStart(2, "0")}`;

/**
 * The bookmark a customer is holding, from any of their filing rows.
 *
 * Not `slotted` alone. A bookmark is given out when the slip is named, so
 * between the two walks the customer holds a number while their paper is
 * still in the stack — and looking only for placed paper showed no bookmark
 * beside their name on the very screen somebody opens to find it.
 *
 * Filed rows are skipped: that packet is in its folder and the number has
 * gone back.
 */
const heldSlot = (rows: Doc<"filing">[]): number | null => {
  const holding = rows.filter((r) => r.stage !== "filed" && r.slot !== undefined);
  if (!holding.length) return null;
  // Paper already on the table wins over paper still coming to it, so a
  // customer mid-move is shown where their pile actually is.
  const placed = holding.find((r) => r.stage !== "named");
  return (placed ?? holding[0]).slot ?? null;
};

/**
 * Which slot each customer is holding at the moment.
 *
 * Derived from the rows rather than stored: one source of truth, and no slot
 * table that can drift out of step with where the paper actually is.
 */
/**
 * Which bookmark each customer is holding.
 *
 * Counted over every stage except `filed`, because a bookmark is now given out
 * at naming time and the slip sits at `named` until the paper reaches it. Only
 * filing the packet gives the number back. Reading `slotted` alone — which is
 * all this looked at while numbers were handed out during the second walk —
 * would now let a customer named this morning and a customer named this
 * afternoon both be told bookmark 7.
 */
async function slotsHeld(ctx: QueryCtx | MutationCtx) {
  const rows = await ctx.db.query("filing").collect();
  const byParty = new Map<string, number>();
  for (const r of rows) {
    if (r.stage === "filed") continue;
    if (r.slot !== undefined) byParty.set(String(r.partyLedgerId), r.slot);
  }
  // A bookmark given out on the Ledger screen before any paper: taken all the same.
  for (const h of await ctx.db.query("filingHolds").collect()) {
    if (!byParty.has(String(h.partyLedgerId))) byParty.set(String(h.partyLedgerId), h.slot);
  }
  return byParty;
}

/** The bookmark held for a customer who has no paper on it yet, if any. */
async function holdOf(ctx: QueryCtx | MutationCtx, partyLedgerId: Id<"ledgers">) {
  return await ctx.db
    .query("filingHolds")
    .withIndex("by_party", (q) => q.eq("partyLedgerId", partyLedgerId))
    .first();
}

/** A Sundry Debtors account by this name: the existing one, or a new one opened for it. */
async function partyByName(ctx: MutationCtx, name: string, asOf: number): Promise<Id<"ledgers">> {
  const wanted = name.trim();
  if (!wanted) throw new Error("Say whose bill this is");
  const all = await ctx.db.query("ledgers").collect();
  const exact = all.find((l) => l.name.toLowerCase() === wanted.toLowerCase());
  if (exact) return exact._id;
  const group = await ctx.db
    .query("groups")
    .withIndex("by_name", (q) => q.eq("name", "Sundry Debtors"))
    .unique();
  if (!group) throw new Error("The Sundry Debtors group is missing");
  const now = Date.now();
  const id = await ctx.db.insert("ledgers", {
    name: properText(wanted),
    groupId: group._id,
    openingBalance: 0,
    openingSide: "Dr",
    openingAsOf: asOf,
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  // Every customer holds a bookmark from the moment the account opens.
  await holdFor(ctx, id);
  return id;
}

/**
 * The bookmark this customer's bill goes in.
 *
 * A customer already on the table keeps their bookmark, which is the whole
 * point — it is what gathers their slips together. A customer new to the table
 * takes the lowest free number, so the table fills from one end, freed numbers
 * come back into use, and the eye knows where to look.
 *
 * With no limit set there is always a number: when everything below is taken
 * the count simply goes one higher. Only a table the shop has deliberately
 * fixed can run out, and then this returns null and the bill waits.
 */
function nextFree(
  held: Map<string, number>,
  partyLedgerId: Id<"ledgers">,
  count: number | null,
): number | null {
  const already = held.get(String(partyLedgerId));
  if (already !== undefined) return already;

  const taken = new Set(held.values());
  // Unlimited: the lowest free number, however high that has to reach.
  const ceiling = count ?? taken.size + 1;
  for (let slot = 1; slot <= ceiling; slot += 1) if (!taken.has(slot)) return slot;
  return null;
}

async function slotFor(
  ctx: MutationCtx,
  partyLedgerId: Id<"ledgers">
): Promise<number | null> {
  const [held, count] = await Promise.all([slotsHeld(ctx), slotCount(ctx)]);
  return nextFree(held, partyLedgerId, count);
}

/**
 * Every customer holds a bookmark, paper or not (the shop's rule from
 * 2026-10-04): the Ledger lists each account with its number beside it, so a
 * slip that turns up for anybody already has a place on the table.
 *
 * Gives the lowest free number to each active customer holding none, in name
 * order, and returns how many were given. Safe to run at any time — a
 * customer with a number keeps it. The held map is built once and kept current
 * through the loop (the same reason as seatWaiting: one read, not one per row).
 */
export async function holdEveryone(ctx: MutationCtx): Promise<number> {
  const debtors = await ctx.db
    .query("groups")
    .withIndex("by_name", (q) => q.eq("name", "Sundry Debtors"))
    .unique();
  if (!debtors) return 0;
  const customers = (
    await ctx.db.query("ledgers").withIndex("by_group", (q) => q.eq("groupId", debtors._id)).collect()
  )
    .filter((l) => l.active)
    .sort((a, b) => a.name.localeCompare(b.name));
  const [held, count] = await Promise.all([slotsHeld(ctx), slotCount(ctx)]);
  let given = 0;
  const now = Date.now();
  for (const c of customers) {
    if (held.has(String(c._id))) continue;
    const slot = nextFree(held, c._id, count);
    if (slot === null) break; // a fixed table is full
    held.set(String(c._id), slot);
    await ctx.db.insert("filingHolds", { partyLedgerId: c._id, slot, at: now });
    given += 1;
  }
  return given;
}

/** One customer: their bookmark, given now if they have none. */
export async function holdFor(ctx: MutationCtx, partyLedgerId: Id<"ledgers">): Promise<number | null> {
  const held = await slotsHeld(ctx);
  const already = held.get(String(partyLedgerId));
  if (already !== undefined) return already;
  const slot = nextFree(held, partyLedgerId, await slotCount(ctx));
  if (slot !== null) await ctx.db.insert("filingHolds", { partyLedgerId, slot, at: Date.now() });
  return slot;
}

/** Runs holdEveryone: once by hand, and every few minutes so no account is missed. */
export const holdAllCustomers = internalMutation({
  args: {},
  handler: async (ctx) => ({ given: await holdEveryone(ctx) }),
});

/**
 * Records that this bill has been named, and gives it its bookmark.
 *
 * Naming and placing are still two walks through the stack — the slip goes
 * back where it came from, in order, and no paper moves here. What has changed
 * is when the number is decided.
 *
 * It used to be decided on the second walk, and deliberately so: with forty
 * bookmarks, one given out at naming time was held for paper still sitting in
 * the stack, and naming two hundred slips before placing any emptied the table
 * with nothing on it. Bookmarks are unlimited now, so that cost is gone — and
 * deciding here is better, because the number is then settled before anybody
 * picks the stack up. The second walk only reads it out.
 *
 * A customer keeps one bookmark across every slip of theirs, whenever it was
 * named, which is what gathers their paper into one pile.
 *
 * `capturedAt` is when it was photographed. The inbox rows carry it and are
 * deleted straight after, so this is the last moment it can be recorded — and
 * it is the only thing that can put the digital order back into stack order.
 */
export async function enrol(
  ctx: MutationCtx,
  args: {
    voucherId: Id<"vouchers">;
    partyLedgerId: Id<"ledgers">;
    capturedAt: number;
    stack?: string;
  }
): Promise<{ rowId: Id<"filing">; slot: number | null }> {
  const existing = await ctx.db
    .query("filing")
    .withIndex("by_voucher", (q) => q.eq("voucherId", args.voucherId))
    .first();
  if (existing) return { rowId: existing._id, slot: existing.slot ?? null };

  const slot = await slotFor(ctx, args.partyLedgerId);
  const rowId = await ctx.db.insert("filing", {
    voucherId: args.voucherId,
    partyLedgerId: args.partyLedgerId,
    capturedAt: args.capturedAt,
    stack: args.stack,
    // Still `named`: the number is decided, the paper has not moved. The
    // second walk is what turns this into `slotted`.
    stage: "named",
    slot: slot ?? undefined,
    at: Date.now(),
  });
  return { rowId, slot };
}

/* ------------------------------------------------------------------ */
/* the second walk: placing the paper                                  */
/* ------------------------------------------------------------------ */

/**
 * How far the placing has got, stack by stack.
 *
 * `left` is what is named but still in the stack; `current` is the slip whose
 * number is on the screen right now, so closing the phone and opening it again
 * does not lose your place in a stack of a thousand.
 */
export const placeState = query({
  args: { stack: v.optional(v.string()) },
  handler: async (ctx, { stack }) => {
    const rows = await ctx.db.query("filing").collect();

    const byStack = new Map<string, { left: number; placed: number; total: number }>();
    for (const r of rows) {
      const key = r.stack ?? "";
      const tally = byStack.get(key) ?? { left: 0, placed: 0, total: 0 };
      tally.total += 1;
      if (r.stage === "named") tally.left += 1;
      else tally.placed += 1;
      byStack.set(key, tally);
    }

    const mine = stack === undefined ? rows : rows.filter((r) => (r.stack ?? "") === stack);

    // The last slip actually placed — what the person is holding, or has just
    // put down. Ordered by when it was placed, not when it was shot.
    const placed = mine
      .filter((r) => r.stage === "slotted" || r.stage === "waiting")
      .sort((a, b) => b.at - a.at);
    const current = placed[0] ? await card(ctx, placed[0], mine) : null;

    /**
     * The next few slips' photographs, fetched before Next is pressed.
     *
     * All at once. This used to walk the four in a loop, awaiting a voucher
     * and then a URL for each — eight round trips, one after another, inside a
     * query that re-runs on every single press of Next because the mutation
     * has just touched a filing row. That was the wait between pressing Next
     * and the bookmark appearing, and none of the eight depended on any other.
     */
    const upNext = mine
      .filter((r) => r.stage === "named")
      .sort((a, b) => a.capturedAt - b.capturedAt)
      .slice(0, AHEAD);

    const vouchers = await Promise.all(upNext.map((r) => ctx.db.get(r.voucherId)));
    const urls = await Promise.all(
      vouchers.map((voucher) => {
        const first = voucher?.attachments?.[0];
        const storageId = typeof first === "string" ? first : first?.storageId;
        return storageId ? ctx.storage.getUrl(storageId) : null;
      }),
    );
    const ahead = urls.filter((u): u is string => Boolean(u));

    return {
      ahead,
      stacks: [...byStack]
        .map(([s, tally]) => ({ stack: s, ...tally }))
        .sort((a, b) => a.stack.localeCompare(b.stack)),
      left: mine.filter((r) => r.stage === "named").length,
      total: mine.length,
      current,
    };
  },
});

/** One slip as the placing screen shows it: whose, where, and how far down. */
async function card(ctx: QueryCtx | MutationCtx, row: Doc<"filing">, siblings: Doc<"filing">[]) {
  // Fetched together. Neither read depends on the other, and awaiting them one
  // after the other put a whole extra round trip between pressing Next and the
  // bookmark appearing on screen.
  const [party, voucher] = await Promise.all([
    ctx.db.get(row.partyLedgerId),
    ctx.db.get(row.voucherId),
  ]);
  // Older vouchers stored a bare storage id; newer ones an object with a kind.
  const first = voucher?.attachments?.[0];
  const front = typeof first === "string" ? first : first?.storageId;
  return {
    id: row._id,
    party: party?.name ?? "—",
    slot: row.slot ?? null,
    slotLabel: row.slot === undefined ? null : slotLabel(row.slot),
    stack: row.stack ?? null,
    // Counted from the bottom of the stack over every bill in it, so the number
    // on the screen is the number of slips to count down the pile.
    index: siblings.filter((r) => r.capturedAt < row.capturedAt).length + 1,
    total: siblings.length,
    url: front ? await ctx.storage.getUrl(front) : null,
  };
}

/**
 * Next slip off the stack: says whose it is and which slot to drop it in.
 *
 * This is the second walk, and the one the paper actually feels. The stack is
 * in the order it was photographed, so taking the oldest unplaced slip each
 * time means the top of the pile and the top of the screen stay in step — the
 * person never has to search for the slip being talked about.
 */
export const placeNext = mutation({
  args: { stack: v.optional(v.string()) },
  handler: async (ctx, { stack }) => {
    const all = await ctx.db.query("filing").collect();
    const mine = stack === undefined ? all : all.filter((r) => (r.stack ?? "") === stack);
    const row = mine
      .filter((r) => r.stage === "named")
      .sort((a, b) => a.capturedAt - b.capturedAt)[0];
    if (!row) return { done: true as const, card: null, left: 0 };

    // Decided at naming time. Only a slip named before that change, or one
    // named while a fixed table was full, still needs a number here.
    const slot = row.slot ?? (await slotFor(ctx, row.partyLedgerId));
    const change = {
      slot: slot ?? undefined,
      stage: (slot === null ? "waiting" : "slotted") as Doc<"filing">["stage"],
      at: Date.now(),
    };
    await ctx.db.patch(row._id, change);

    // The patched row, built here rather than read back. Nothing else can have
    // touched it inside this transaction, and the read was a round trip
    // standing between pressing Next and the bookmark reaching the screen.
    const fresh: Doc<"filing"> = { ...row, ...change };
    return {
      done: false as const,
      card: await card(ctx, fresh, mine),
      left: mine.filter((r) => r.stage === "named").length - 1,
    };
  },
});

/**
 * Puts the last slip back on the stack.
 *
 * For the ordinary slip of the hand — the number was read, the paper went into
 * the wrong slot, or Next was pressed twice. It goes back to named, keeping
 * its place in the stack, and comes up again on the next press.
 *
 * It keeps its bookmark. The number belongs to the customer from the moment
 * they were named, so clearing it here would hand the same number to somebody
 * else while this customer's paper is still on the table under it.
 */
export const unplace = mutation({
  args: { id: v.id("filing") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) throw new Error("That bill is not in the sorting queue");
    if (row.stage === "filed") throw new Error("That packet is already in its folder");
    await ctx.db.patch(id, { stage: "named", at: Date.now() });
    return { ok: true };
  },
});

/* ------------------------------------------------------------------ */
/* the table                                                           */
/* ------------------------------------------------------------------ */

/** Every slot, who is holding it, and how many of their bills are in it. */
export const slots = query({
  args: {},
  handler: async (ctx) => {
    const count = await slotCount(ctx);
    /**
     * Every bookmark that is spoken for, not only the ones with paper on them.
     *
     * A bookmark is given out at naming time, so between the two walks a
     * customer holds a number with nothing behind it yet. Leaving those out —
     * which is what reading only `slotted` did — showed a table with free
     * places on it that were not free, and on a fixed table that is the
     * difference between "four left" and running out mid-stack.
     *
     * `bills` is the paper actually on the table; `named` is what is still in
     * the stack, coming to it.
     */
    const rows = (await ctx.db.query("filing").collect()).filter(
      (r) => r.stage !== "filed" && r.slot !== undefined,
    );

    const bySlot = new Map<
      number,
      { partyLedgerId: Id<"ledgers">; bills: number; named: number; since: number }
    >();
    for (const r of rows) {
      const held = bySlot.get(r.slot!) ?? {
        partyLedgerId: r.partyLedgerId,
        bills: 0,
        named: 0,
        since: r.at,
      };
      if (r.stage === "named") held.named += 1;
      else held.bills += 1;
      held.since = Math.min(held.since, r.at);
      bySlot.set(r.slot!, held);
    }

    /**
     * How far the table is drawn.
     *
     * A fixed table is drawn in full, empty places included, because that is
     * what is sitting in front of the person. An unlimited one has no full to
     * draw, so it runs to the highest bookmark in use — which shows every
     * freed number below it as a gap waiting to be reused.
     */
    // Bookmarks given out by name, before any paper: on the table, empty so far.
    for (const h of await ctx.db.query("filingHolds").collect()) {
      if (!bySlot.has(h.slot)) bySlot.set(h.slot, { partyLedgerId: h.partyLedgerId, bills: 0, named: 0, since: h.at });
    }

    const highest = Math.max(0, ...bySlot.keys());
    const drawTo = count ?? highest;

    const out = [];
    for (let slot = 1; slot <= drawTo; slot += 1) {
      const held = bySlot.get(slot);
      const party = held ? await ctx.db.get(held.partyLedgerId) : null;
      out.push({
        slot,
        label: slotLabel(slot),
        partyLedgerId: held?.partyLedgerId ?? null,
        party: party?.name ?? null,
        folder: party?.folder ?? null,
        bills: held?.bills ?? 0,
        /** Named, bookmarked, still in the stack — coming to this place. */
        named: held?.named ?? 0,
        since: held?.since ?? null,
      });
    }

    const waiting = (
      await ctx.db
        .query("filing")
        .withIndex("by_stage_capturedAt", (q) => q.eq("stage", "waiting"))
        .collect()
    ).length;

    return {
      /** Null when there is no limit. */
      slotCount: count,
      unlimited: count === null,
      slots: out,
      used: bySlot.size,
      highest,
      // Nothing is "free" on a table that cannot run out — saying 0, or some
      // large invented number, would both read as a limit that is not there.
      free: count === null ? null : count - bySlot.size,
      // Named while a fixed table was full. With no limit set nothing can land
      // here, but rows left over from when there was one still can.
      waiting,
    };
  },
});

/**
 * Fixes the table at a number of bookmarks, or lifts the limit again.
 *
 * Omitting `slotCount` means unlimited, which is the default and what a shop
 * with a box of numbered bookmarks wants. A number is for a table that
 * genuinely cannot grow — a fixed rack — and then running out is a real event
 * the app has to be able to report.
 */
export const setSlotCount = mutation({
  args: { slotCount: v.optional(v.number()) },
  handler: async (ctx, { slotCount: wanted }) => {
    if (wanted !== undefined) {
      if (!Number.isInteger(wanted) || wanted < 2) {
        throw new Error("Lay out at least two bookmarks, or leave it unlimited");
      }
      const held = await slotsHeld(ctx);
      const highest = Math.max(0, ...held.values());
      if (wanted < highest) {
        throw new Error(
          `${slotLabel(highest)} is holding a packet — file it before taking the table down to ${wanted}`
        );
      }
    }
    const row = await planRow(ctx);
    // Written as absent rather than as a number, so "unlimited" is one state
    // and not a very large ceiling somebody has to reason about later.
    const doc = { key: PLAN_KEY, slotCount: wanted, madeAt: Date.now() };
    if (row) await ctx.db.patch(row._id, { slotCount: wanted, madeAt: Date.now() });
    else await ctx.db.insert("filingPlan", doc);
    return { slotCount: wanted ?? null, unlimited: wanted === undefined };
  },
});

/**
 * The packet in a slot has gone into its customer's folder.
 *
 * This is the step that frees the table, and the only one that says where the
 * paper ends up. The folder is remembered on the account, so the next time this
 * customer's packet is filed the same drawer is offered — and so "Raj Kumar ka
 * bill dikhao" has an answer.
 *
 * Every bill of theirs that was waiting for a slot comes onto the table in the
 * same breath, since the slot it would have wanted is the one just freed.
 */
export const fileToFolder = mutation({
  args: {
    slot: v.number(),
    cabinet: v.optional(v.string()),
    drawer: v.optional(v.string()),
    no: v.optional(v.number()),
  },
  handler: async (ctx, { slot, cabinet, drawer, no }) => {
    const rows = (
      await ctx.db
        .query("filing")
        .withIndex("by_slot", (q) => q.eq("slot", slot))
        .collect()
    ).filter((r) => r.stage === "slotted");
    if (!rows.length) throw new Error(`${slotLabel(slot)} is empty`);

    const partyLedgerId = rows[0].partyLedgerId;
    const party = await ctx.db.get(partyLedgerId);
    if (!party) throw new Error("That account is gone");

    const folder =
      cabinet || drawer || no !== undefined
        ? {
            cabinet: (cabinet ?? party.folder?.cabinet ?? "").trim(),
            drawer: (drawer ?? party.folder?.drawer ?? "").trim(),
            no: no ?? party.folder?.no ?? 0,
          }
        : party.folder;
    if (!folder) throw new Error("Say which folder this packet goes into");

    for (const r of rows) await ctx.db.patch(r._id, { stage: "filed" });
    // The packet goes to its folder; the customer keeps the number (every
    // customer holds one), so their next slip lands on the same bookmark.
    const hold = await holdOf(ctx, partyLedgerId);
    if (hold) await ctx.db.patch(hold._id, { slot, at: Date.now() });
    else await ctx.db.insert("filingHolds", { partyLedgerId, slot, at: Date.now() });
    await ctx.db.patch(partyLedgerId, { folder, updatedAt: Date.now() });

    // A bill of somebody else's that had nowhere to go now has somewhere.
    const seated = await seatWaiting(ctx);

    await record(
      ctx,
      "filing.file",
      `${party.name}: ${rows.length} bills from ${slotLabel(slot)} into ${folder.cabinet}/${folder.drawer}/${folder.no}`,
      { entity: "ledger", entityId: partyLedgerId }
    );
    return { party: party.name, bills: rows.length, folder, seated };
  },
});

/**
 * Puts bills that were named while the table was full into the slots that have
 * since come free, oldest first — so the queue drains by itself rather than
 * needing somebody to remember it exists.
 */
/**
 * Gives a bookmark to anything that is holding none.
 *
 * Two kinds of slip end up here.
 *
 * A **waiting** slip was placed while a fixed table was full: the paper is at
 * the table with nowhere to sit, so seating it moves it to `slotted`.
 *
 * A **named** slip has no number because it was named before bookmarks were
 * given out at naming time. Its paper is still in the stack, so it stays at
 * `named` — only the number is settled, which is exactly what naming would
 * have done for it today. This used to be refused on the grounds that a named
 * slip is not stranded and giving it a number would hold the table for paper
 * nobody has picked up. That was true of forty bookmarks; with no limit there
 * is nothing to hold, and leaving the backlog blank means a customer with four
 * bills in the stack shows no bookmark on the very screen opened to find one.
 *
 * Walked in stack order, so the numbers run the way the paper does.
 */
async function seatWaiting(ctx: MutationCtx) {
  const rows = (await ctx.db.query("filing").collect())
    .filter((r) => r.slot === undefined && (r.stage === "waiting" || r.stage === "named"))
    .sort((a, b) => a.capturedAt - b.capturedAt);

  /**
   * The held map is built once and carried through the loop.
   *
   * Asking `slotFor` per row re-read the whole filing table each time — a
   * hundred and forty slips against a few hundred rows is tens of thousands of
   * document reads, and Convex stops a function at thirty-two thousand. The
   * catch-up failed outright on the shop's real backlog. Nothing here needs a
   * fresh read: this loop is the only thing handing numbers out, so keeping
   * the map current as it goes is both correct and one read instead of N.
   */
  const [held, count] = await Promise.all([slotsHeld(ctx), slotCount(ctx)]);

  const seated: { party: string; slot: number; stage: string }[] = [];
  for (const row of rows) {
    const slot = nextFree(held, row.partyLedgerId, count);
    if (slot === null) break;              // a fixed table filled up again
    held.set(String(row.partyLedgerId), slot);
    // A waiting slip's paper is already at the table; a named one's is not.
    const stage = row.stage === "waiting" ? ("slotted" as const) : ("named" as const);
    await ctx.db.patch(row._id, { slot, stage });
    const party = await ctx.db.get(row.partyLedgerId);
    seated.push({ party: party?.name ?? "—", slot, stage });
  }
  return seated;
}

/** Puts a bill into a slot by hand, when the paper and the screen disagree. */
export const moveToSlot = mutation({
  args: { id: v.id("filing"), slot: v.number() },
  handler: async (ctx, { id, slot }) => {
    const row = await ctx.db.get(id);
    if (!row) throw new Error("That bill is not in the sorting queue");
    const count = await slotCount(ctx);
    // With no limit any number is a real bookmark, so only a fixed table can
    // refuse one. Below 1 is never a bookmark either way.
    if (slot < 1 || !Number.isInteger(slot) || (count !== null && slot > count)) {
      throw new Error(`There is no ${slotLabel(slot)} on the table`);
    }

    const held = await slotsHeld(ctx);
    for (const [partyId, at] of held) {
      if (at === slot && partyId !== String(row.partyLedgerId)) {
        const other = await ctx.db.get(partyId as Id<"ledgers">);
        throw new Error(`${slotLabel(slot)} is holding ${other?.name ?? "another customer"}`);
      }
    }
    await ctx.db.patch(id, { slot, stage: "slotted" });
    return { slot };
  },
});

/* ------------------------------------------------------------------ */
/* naming the paper                                                    */
/* ------------------------------------------------------------------ */

/**
 * The customers a slip can be filed to.
 *
 * Customers only. Every slip in this backlog is one the shop wrote out, so a
 * supplier on the list could only ever be picked by mistake — and a bill filed
 * to the wrong side of the book is worse than one not filed at all.
 */
export const parties = query({
  args: {},
  handler: async (ctx) => {
    const debtors = await ctx.db
      .query("groups")
      .withIndex("by_name", (q) => q.eq("name", "Sundry Debtors"))
      .unique();
    if (!debtors) return [];
    const ledgers = await ctx.db
      .query("ledgers")
      .withIndex("by_group", (q) => q.eq("groupId", debtors._id))
      .collect();
    return ledgers
      .filter((l) => l.active)
      .map((l) => ({ _id: l._id, name: l.name, place: l.place ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Which stacks have paper still waiting for a name, and how much. */
export const waiting = query({
  args: {},
  handler: async (ctx) => {
    const photos = await ctx.db.query("inbox").collect();
    const bills = new Map<string, Set<string>>();
    for (const p of photos) {
      const key = p.stack ?? "";
      const set = bills.get(key) ?? new Set<string>();
      set.add(p.groupId ? `g:${p.groupId}` : `p:${p._id}`);
      bills.set(key, set);
    }
    return [...bills]
      .map(([stack, set]) => ({ stack, bills: set.size }))
      .sort((a, b) => a.stack.localeCompare(b.stack));
  },
});

/** The next few bills with no name read yet, oldest first. */
export const unreadAhead = query({
  args: { stack: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { stack, limit }) => {
    const photos = await ctx.db.query("inbox").withIndex("by_at").order("asc").take(200);
    const readings = await ctx.db.query("readings").collect();
    // A failed read is not a read; it comes round again rather than sitting
    // unread for ever, which is the one state that cannot fix itself.
    const seen = new Set(
      readings.filter((r) => r.status !== "failed").map((r) => r.inboxId as string)
    );

    const out: string[] = [];
    const queued = new Set<string>();
    for (const photo of photos) {
      if (stack && photo.stack !== stack) continue;
      if (seen.has(photo._id as string)) continue;
      if (photo.groupId) {
        if (queued.has(photo.groupId)) continue;
        queued.add(photo.groupId);
      }
      out.push(photo._id as string);
      if (out.length >= (limit ?? 4)) break;
    }
    return out;
  },
});

/**
 * The next photographed slip waiting for a name, oldest first.
 *
 * `except` are slips somebody has passed over this sitting — an illegible name,
 * a slip they want to ask about. They are skipped rather than dealt with,
 * because a backlog stops dead the moment one difficult slip is allowed to
 * block the two hundred behind it. They stay in the tray and come round again
 * on the next sitting; nothing about them is changed or recorded.
 */
export const toName = query({
  args: { stack: v.optional(v.string()), except: v.optional(v.array(v.id("inbox"))) },
  handler: async (ctx, { stack, except }) => {
    const photos = await ctx.db.query("inbox").withIndex("by_at").order("asc").take(200);
    const wanted = stack ? photos.filter((p) => p.stack === stack) : photos;
    // A skipped slip takes its other sheets with it: they are one bill.
    const passed = new Set((except ?? []).map(String));
    const passedGroups = new Set(
      wanted.filter((p) => passed.has(String(p._id)) && p.groupId).map((p) => p.groupId)
    );
    const photo = wanted.find(
      (p) => !passed.has(String(p._id)) && !(p.groupId && passedGroups.has(p.groupId))
    );
    if (!photo) return { photo: null, left: 0, index: 0, total: 0 };

    const pages = photo.groupId
      ? await ctx.db
          .query("inbox")
          .withIndex("by_group", (q) => q.eq("groupId", photo.groupId))
          .collect()
      : [photo];

    const bills = new Set(wanted.map((p) => (p.groupId ? `g:${p.groupId}` : `p:${p._id}`)));

    /**
     * Where this slip sits in its stack, counted from the bottom over every
     * bill ever photographed into it — named or not. A number counted over only
     * what is left would always read "1", which finds no paper.
     */
    const named = await ctx.db.query("filing").collect();
    const namedBefore = named.filter(
      (r) => (stack ? r.stack === stack : true) && r.capturedAt < photo.at
    ).length;
    const namedAll = named.filter((r) => (stack ? r.stack === stack : true)).length;

    const firstSheets = new Map<string, number>();
    for (const p of wanted) {
      const key = p.groupId ? `g:${p.groupId}` : `p:${p._id}`;
      firstSheets.set(key, Math.min(firstSheets.get(key) ?? Infinity, p.at));
    }
    const waitingBefore = [...firstSheets.values()].filter((at) => at < photo.at).length;

    const reading = await ctx.db
      .query("readings")
      .withIndex("by_inbox", (q) => q.eq("inboxId", photo._id))
      .first();
    const guess =
      reading?.status === "ready" && typeof reading.draft?.party === "string"
        ? String(reading.draft.party).trim()
        : "";

    /**
     * The first sheets of the next few bills, so the browser can fetch them
     * while this one is being answered.
     *
     * A photograph that appears with the slip is the difference between naming
     * at a steady rhythm and waiting on every single one — and these are phone
     * cameras on a shop's wifi, where a cold fetch is seconds, not milliseconds.
     */
    const ahead: string[] = [];
    const queued = new Set<string>();
    for (const p of wanted) {
      if (ahead.length >= 4) break;
      if (String(p._id) === String(photo._id)) continue;
      if (photo.groupId && p.groupId === photo.groupId) continue;
      if (passed.has(String(p._id)) || (p.groupId && passedGroups.has(p.groupId))) continue;
      const key = p.groupId ? `g:${p.groupId}` : `p:${p._id}`;
      if (queued.has(key)) continue;
      queued.add(key);
      const url = await ctx.storage.getUrl(p.storageId);
      if (url) ahead.push(url);
    }

    return {
      ahead,
      photo: {
        id: photo._id,
        at: photo.at,
        stack: photo.stack ?? null,
        guess,
        reading: reading?.status ?? null,
        pages: await Promise.all(
          pages
            .sort((a, b) => a.at - b.at)
            .map(async (p) => ({ id: p._id, url: await ctx.storage.getUrl(p.storageId) }))
        ),
      },
      left: bills.size,
      index: namedBefore + waitingBefore + 1,
      total: namedAll + firstSheets.size,
    };
  },
});

/* ------------------------------------------------------------------ */
/* the phone works ahead: queues it walks on its own                   */
/* ------------------------------------------------------------------ */
// Saving a name or pressing Next used to wait on the server twice — the
// mutation, then the query re-running to say what comes next. The phone now
// holds the next few dozen slips and the bookmarks already given out, moves on
// the moment it is pressed, and sends the change behind it. The server stays
// the judge: what it answers replaces what the phone guessed.

const QUEUE = 30;

/** Rank of `at` among sorted times: how many come before it, plus one. */
function rankIn(sorted: number[], at: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < at) lo = mid + 1; else hi = mid; }
  return lo + 1;
}

/** The next bills to name, each with its sheets, plus what the phone needs to number them. */
export const nameQueue = query({
  args: { stack: v.optional(v.string()) },
  handler: async (ctx, { stack }) => {
    const photos = await ctx.db.query("inbox").withIndex("by_at").order("asc").take(400);
    const wanted = stack ? photos.filter((p) => p.stack === stack) : photos;
    const filing = await ctx.db.query("filing").collect();

    // One entry per bill (a two-sheet bill is one), in stack order.
    const bills = new Map<string, Doc<"inbox">[]>();
    for (const p of wanted) {
      const key = p.groupId ? `g:${p.groupId}` : `p:${p._id}`;
      bills.set(key, [...(bills.get(key) ?? []), p]);
    }
    const firsts = [...bills.values()].map((pages) => Math.min(...pages.map((p) => p.at)));
    const named = filing.filter((r) => (stack ? r.stack === stack : true)).map((r) => r.capturedAt);
    const times = [...firsts, ...named].sort((a, b) => a - b);

    const out = [];
    for (const pages of [...bills.values()].slice(0, QUEUE)) {
      pages.sort((a, b) => a.at - b.at);
      const photo = pages[0];
      const reading = await ctx.db
        .query("readings")
        .withIndex("by_inbox", (q) => q.eq("inboxId", photo._id))
        .first();
      out.push({
        id: photo._id,
        at: photo.at,
        stack: photo.stack ?? null,
        guess: reading?.status === "ready" && typeof reading.draft?.party === "string" ? String(reading.draft.party).trim() : "",
        reading: reading?.status ?? null,
        index: rankIn(times, photo.at),
        pages: await Promise.all(pages.map(async (p) => ({ id: p._id, url: await ctx.storage.getUrl(p.storageId) }))),
      });
    }
    const held = await slotsHeld(ctx);
    return {
      bills: out,
      left: bills.size,
      total: times.length,
      held: [...held].map(([partyLedgerId, slot]) => ({ partyLedgerId, slot })),
      count: await slotCount(ctx),
    };
  },
});

/** The next slips to place, in stack order, each already showing its bookmark. */
export const placeQueue = query({
  args: { stack: v.optional(v.string()) },
  handler: async (ctx, { stack }) => {
    const rows = await ctx.db.query("filing").collect();
    const byStack = new Map<string, { left: number; placed: number; total: number }>();
    for (const r of rows) {
      const key = r.stack ?? "";
      const tally = byStack.get(key) ?? { left: 0, placed: 0, total: 0 };
      tally.total += 1;
      if (r.stage === "named") tally.left += 1;
      else tally.placed += 1;
      byStack.set(key, tally);
    }
    const mine = stack === undefined ? rows : rows.filter((r) => (r.stack ?? "") === stack);
    const upNext = mine
      .filter((r) => r.stage === "named")
      .sort((a, b) => a.capturedAt - b.capturedAt)
      .slice(0, QUEUE);
    const last = mine
      .filter((r) => r.stage === "slotted" || r.stage === "waiting")
      .sort((a, b) => b.at - a.at)[0];
    return {
      queue: await Promise.all(upNext.map((r) => card(ctx, r, mine))),
      current: last ? await card(ctx, last, mine) : null,
      stacks: [...byStack]
        .map(([s, tally]) => ({ stack: s, ...tally }))
        .sort((a, b) => a.stack.localeCompare(b.stack)),
      left: mine.filter((r) => r.stage === "named").length,
      total: mine.length,
    };
  },
});

/**
 * This slip is in its bookmark. By id, not "the next one": the phone has
 * already shown which slip it was, and sending it again (a retry after a
 * dropped signal) changes nothing.
 */
export const placeRow = mutation({
  args: { id: v.id("filing") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row || row.stage !== "named") return { done: true, slot: row?.slot ?? null };
    const slot = row.slot ?? (await slotFor(ctx, row.partyLedgerId));
    await ctx.db.patch(id, {
      slot: slot ?? undefined,
      stage: slot === null ? "waiting" : "slotted",
      at: Date.now(),
    });
    return { done: true, slot };
  },
});

/**
 * "This one is Raj Kumar's." Files it unpriced and answers with its slot.
 *
 * The voucher is dated when the slip was photographed: nobody is asked for a
 * date, and a guessed one would be worse than an honest stand-in. The real date
 * is on the paper and goes in when the bill is priced.
 */
export const nameIt = mutation({
  args: {
    inboxId: v.id("inbox"),
    partyLedgerId: v.optional(v.id("ledgers")),
    partyName: v.optional(v.string()),
  },
  handler: async (ctx, { inboxId, partyLedgerId, partyName }) => {
    const photo = await ctx.db.get(inboxId);
    if (!photo) throw new Error("That photograph is gone");

    const ledgerId = partyLedgerId ?? (await partyByName(ctx, partyName ?? "", photo.at));

    const pages = photo.groupId
      ? await ctx.db
          .query("inbox")
          .withIndex("by_group", (q) => q.eq("groupId", photo.groupId))
          .collect()
      : [photo];

    const groups = await ctx.db.query("groups").collect();
    const ledgers = await ctx.db.query("ledgers").collect();
    const salesGroup = groups.find((g) => g.name === "Sales Accounts");
    const sales = salesGroup ? ledgers.find((l) => l.groupId === salesGroup._id) : undefined;
    if (!sales) throw new Error("No Sales account to post the other side of this to");

    // No amount: a pending voucher, carrying no entries, touching no balance.
    const voucherId: Id<"vouchers"> = await ctx.runMutation(api.vouchers.createSale, {
      date: photo.at,
      partyLedgerId: ledgerId,
      salesLedgerId: sales._id,
    });

    await ctx.runMutation(api.vouchers.addAttachments, {
      id: voucherId,
      documents: pages.map((p) => ({ storageId: p.storageId, kind: "bill" as const })),
    });

    const marks = pages.flatMap((p) => p.tags ?? []);
    if (marks.length) await ctx.db.patch(voucherId, { tags: [...new Set(marks)] });

    const filed = await enrol(ctx, {
      voucherId,
      partyLedgerId: ledgerId,
      capturedAt: Math.min(...pages.map((p) => p.at)),
      stack: pages.find((p) => p.stack)?.stack,
    });

    for (const page of pages) {
      const readings = await ctx.db
        .query("readings")
        .withIndex("by_inbox", (q) => q.eq("inboxId", page._id))
        .collect();
      for (const r of readings) await ctx.db.delete(r._id);
      await ctx.db.delete(page._id);
    }

    const party = await ctx.db.get(ledgerId);
    await record(ctx, "filing.name", `${party?.name ?? "A customer"}: an unpriced slip named`, {
      entity: "voucher",
      entityId: voucherId,
    });
    // The bookmark is decided here now, and handed straight back, so the
    // naming screen can show whose slip it is and where it will go in one
    // answer. The paper still does not move until the second walk.
    return {
      voucherId,
      party: party?.name ?? "",
      slot: filed.slot,
      slotLabel: filed.slot === null ? null : slotLabel(filed.slot),
    };
  },
});

/* ------------------------------------------------------------------ */
/* folders                                                             */
/* ------------------------------------------------------------------ */

/**
 * Every customer with paper, where it lives, and what state it is in.
 *
 * `unpriced` counts bills filed with no amount, which is what an unpriced slip
 * is in these books. There is deliberately nothing saying a particular bill is
 * paid: these are running accounts with no bill-to-receipt allocation, so only
 * the customer has a balance, never the slip.
 */
export const folders = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("filing").collect();
    const holds = new Map(
      (await ctx.db.query("filingHolds").collect()).map((h) => [h.partyLedgerId, h.slot] as const),
    );
    const byParty = new Map<Id<"ledgers">, Doc<"filing">[]>();
    for (const r of rows) {
      const list = byParty.get(r.partyLedgerId) ?? [];
      list.push(r);
      byParty.set(r.partyLedgerId, list);
    }

    /**
     * Every voucher and every customer in two batches.
     *
     * This used to fetch one voucher at a time inside a loop inside a loop —
     * one round trip per bill in the shop, in order, before the customer list
     * could be drawn at all. At a few hundred bills that is the whole wait on
     * opening this screen, and none of the reads depend on each other.
     */
    const voucherIds = [...new Set(rows.map((r) => r.voucherId))];
    const vouchers = new Map(
      (await Promise.all(voucherIds.map((id) => ctx.db.get(id)))).map((v, i) => [
        voucherIds[i],
        v,
      ]),
    );
    const partyIds = [...byParty.keys()];
    const parties = new Map(
      (await Promise.all(partyIds.map((id) => ctx.db.get(id)))).map((p, i) => [partyIds[i], p]),
    );

    const out = [];
    for (const [partyLedgerId, list] of byParty) {
      const party = parties.get(partyLedgerId);
      if (!party) continue;
      const unpriced = list.filter(
        (r) => vouchers.get(r.voucherId)?.status === "pending",
      ).length;
      const slot = heldSlot(list) ?? holds.get(partyLedgerId) ?? null;
      out.push({
        partyLedgerId,
        name: party.name,
        folder: party.folder ?? null,
        bills: list.length,
        filed: list.filter((r) => r.stage === "filed").length,
        unpriced,
        slot,
        slotLabel: slot === null ? null : slotLabel(slot),
      });
    }
    // Added by name with a bookmark, no paper named yet.
    for (const [partyLedgerId, slot] of holds) {
      if (byParty.has(partyLedgerId)) continue;
      const party = await ctx.db.get(partyLedgerId);
      if (!party) continue;
      out.push({
        partyLedgerId,
        name: party.name,
        folder: party.folder ?? null,
        bills: 0,
        filed: 0,
        unpriced: 0,
        slot,
        slotLabel: slotLabel(slot),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * A customer added by name, with no bill photographed: gives them a bookmark now.
 *
 * Picks an existing account or opens a new one, the same way naming a slip does.
 * A customer already holding a bookmark keeps it; otherwise they take the lowest
 * free number, which their slips will land on once they are named.
 */
export const addCustomer = mutation({
  args: { partyLedgerId: v.optional(v.id("ledgers")), name: v.optional(v.string()) },
  handler: async (ctx, { partyLedgerId, name }) => {
    const ledgerId = partyLedgerId ?? (await partyByName(ctx, name ?? "", Date.now()));
    const party = await ctx.db.get(ledgerId);
    if (!party) throw new Error("That account is gone");

    // Added from the Ledger: ticked off there too, so the new row shows green.
    await tick(ctx, ledgerId);

    const already = (await slotsHeld(ctx)).get(String(ledgerId));
    if (already !== undefined) {
      return { partyLedgerId: ledgerId, name: party.name, slot: already, slotLabel: slotLabel(already), already: true };
    }

    const slot = await slotFor(ctx, ledgerId);
    if (slot === null) throw new Error("Every bookmark on the table is taken");
    await ctx.db.insert("filingHolds", { partyLedgerId: ledgerId, slot, at: Date.now() });
    await record(ctx, "filing.hold", `${party.name}: added with bookmark ${slotLabel(slot)}`, {
      entity: "ledger",
      entityId: ledgerId,
    });
    return { partyLedgerId: ledgerId, name: party.name, slot, slotLabel: slotLabel(slot), already: false };
  },
});

/* ------------------------------------------------------------------ */
/* ticked off on the Ledger                                            */
/* ------------------------------------------------------------------ */
// Tapping a customer on the Ledger ticks them off for this round of sorting,
// so the row changes colour on every phone. Kept until Reset, not by day: a
// stack can take more than one sitting.

export const marks = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("sortMarks").collect()).map((m) => ({ partyLedgerId: m.partyLedgerId, at: m.at })),
});

/** Ticks a customer off (again: only the time moves, so the newest is "last"). */
async function tick(ctx: MutationCtx, partyLedgerId: Id<"ledgers">) {
  const row = await ctx.db
    .query("sortMarks")
    .withIndex("by_party", (q) => q.eq("partyLedgerId", partyLedgerId))
    .first();
  if (row) await ctx.db.patch(row._id, { at: Date.now() });
  else await ctx.db.insert("sortMarks", { partyLedgerId, at: Date.now() });
}

export const mark = mutation({
  args: { partyLedgerId: v.id("ledgers") },
  handler: async (ctx, { partyLedgerId }) => {
    await tick(ctx, partyLedgerId);
    return { ok: true };
  },
});

/** Clears every tick, for the next stack. */
export const resetMarks = mutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("sortMarks").collect();
    for (const m of all) await ctx.db.delete(m._id);
    await record(ctx, "filing.marks", `Ledger ticks reset (${all.length})`, {});
    return { cleared: all.length };
  },
});

/** Gives back a bookmark handed out by name, while no paper has been named to it. */
export const freeHold = mutation({
  args: { partyLedgerId: v.id("ledgers") },
  handler: async (ctx, { partyLedgerId }) => {
    const hold = await holdOf(ctx, partyLedgerId);
    if (!hold) return { freed: false };
    await ctx.db.delete(hold._id);
    const party = await ctx.db.get(partyLedgerId);
    await record(ctx, "filing.hold", `${party?.name ?? "A customer"}: bookmark ${slotLabel(hold.slot)} given back`, {
      entity: "ledger",
      entityId: partyLedgerId,
    });
    return { freed: true };
  },
});

/** Where one customer's paper is — for their account screen, and the search box. */
export const whereIs = query({
  args: { partyLedgerId: v.id("ledgers") },
  handler: async (ctx, { partyLedgerId }) => {
    const party = await ctx.db.get(partyLedgerId);
    if (!party) return null;
    const rows = await ctx.db
      .query("filing")
      .withIndex("by_party", (q) => q.eq("partyLedgerId", partyLedgerId))
      .collect();
    const onTable = rows.find((r) => r.stage === "slotted" && r.slot !== undefined);
    return {
      folder: party.folder ?? null,
      bills: rows.length,
      filed: rows.filter((r) => r.stage === "filed").length,
      // Mid-sort the packet is still on the table rather than in its folder,
      // so this is where to look today.
      slot: onTable?.slot ?? null,
      slotLabel: onTable?.slot === undefined ? null : slotLabel(onTable.slot),
    };
  },
});

/**
 * Everything one customer has, bill by bill.
 *
 * The list screens answer "how many"; this answers "which". It is what somebody
 * holding a packet at the table actually needs — the bookmark the paper is
 * sitting on, and every slip that belongs with it, so a bill in the hand can be
 * checked against the bills already gathered before the packet is stapled.
 *
 * Ordered by the day the bill was written rather than the day it was
 * photographed: a packet is read as a customer's history, not as the order a
 * heap happened to come off the shelf.
 */
/**
 * Throws away a photographed slip that should never have been shot.
 *
 * A blurred frame, the back of a sheet, the same bill twice, a thumb. Naming it
 * would put a bill in the books that does not exist, and skipping only hides it
 * until the next pass — so it goes, photograph and all.
 *
 * Every sheet of the bill goes together. Deleting the page in front of you and
 * leaving its second sheet behind would leave a half bill in the tray with
 * nothing to say what it belonged to, which is worse than either keeping or
 * dropping the whole thing.
 *
 * Only ever the tray. A photograph already filed against a voucher is evidence
 * behind an entry in the books and is not this button's to remove.
 */
export const discardShot = mutation({
  args: { inboxId: v.id("inbox") },
  handler: async (ctx, { inboxId }) => {
    const photo = await ctx.db.get(inboxId);
    if (!photo) return { gone: 0 };

    const pages = photo.groupId
      ? await ctx.db
          .query("inbox")
          .withIndex("by_group", (q) => q.eq("groupId", photo.groupId))
          .collect()
      : [photo];

    for (const page of pages) {
      const readings = await ctx.db
        .query("readings")
        .withIndex("by_inbox", (q) => q.eq("inboxId", page._id))
        .collect();
      for (const r of readings) await ctx.db.delete(r._id);
      await ctx.storage.delete(page.storageId).catch(() => {});
      await ctx.db.delete(page._id);
    }

    await record(
      ctx,
      "filing.discard",
      `Threw away a photographed slip (${pages.length} ${pages.length === 1 ? "sheet" : "sheets"})`
    );
    return { gone: pages.length };
  },
});

/**
 * Takes a named bill back out of the books.
 *
 * For the one that was filed to the wrong customer, or was never a bill at all
 * — a blurred frame or the back of a sheet that got a name by mistake. By the
 * time it is here the photograph is on a voucher, so this is not the tray's
 * delete: it is an entry in the books coming out.
 *
 * Which is why it asks for the code. Every function in this deployment answers
 * whoever has the URL, and naming is a thing anybody with a phone does all
 * afternoon; unnaming moves money on an account.
 *
 * The voucher goes to the trash rather than being destroyed, photograph and
 * all, so a wrong deletion is a restore in the panel rather than a bill gone
 * for good. The filing row goes with it — the paper is no longer anybody's to
 * place, and a row pointing at a binned voucher would hold a slot for a packet
 * nobody is gathering.
 */
export const deleteBill = mutation({
  args: { filingId: v.id("filing"), pin: v.string() },
  handler: async (ctx, { filingId, pin }) => {
    requirePin(pin);

    const row = await ctx.db.get(filingId);
    if (!row) return { gone: false };

    const party = await ctx.db.get(row.partyLedgerId);
    // Moves the voucher and its Dr/Cr lines to the trash whole, so a restore
    // puts every balance back exactly as it was.
    await ctx.runMutation(api.vouchers.remove, { id: row.voucherId });
    await ctx.db.delete(filingId);

    await record(
      ctx,
      "filing.deleteBill",
      `Took a bill of ${party?.name ?? "a customer"} back out of the books`,
      { entity: "voucher", entityId: row.voucherId }
    );
    return { gone: true };
  },
});

/** Return bill photos to Name at their original stack position and undo the entry. */
export const revertBill = mutation({
  args: { filingId: v.id("filing") },
  handler: async (ctx, { filingId }) => {
    const row = await ctx.db.get(filingId);
    if (!row) return { reverted: false as const, pages: 0 };

    const party = await ctx.db.get(row.partyLedgerId);
    const voucher = await ctx.db.get(row.voucherId);

    if (!voucher) throw new ConvexError("This bill entry is no longer available.");

    // Only bill photos return to Name; other documents stay with the archived entry.
    const shots = (voucher?.attachments ?? []).filter((a) =>
      typeof a === "string" ? true : a.kind === "bill"
    );
    const storageIds = shots.map((a) => (typeof a === "string" ? a : a.storageId));

    if (!storageIds.length) throw new ConvexError("This bill has no photos to send back to Name.");

    // Keep all pages together when the bill is named again.
    const groupId = storageIds.length > 1 ? `revert-${row.voucherId}` : undefined;

    for (const storageId of storageIds) {
      await ctx.db.insert("inbox", {
        storageId,
        // Preserve the original position in the stack.
        at: row.capturedAt,
        tags: voucher?.tags,
        groupId,
        stack: row.stack,
      });
    }

    // Trash purging must not delete photos now owned by the inbox.
    await ctx.db.patch(row.voucherId, {
      attachments: voucher.attachments.filter((a) => !shots.includes(a)),
      updatedAt: Date.now(),
    });

    await ctx.runMutation(api.vouchers.remove, { id: row.voucherId });
    await ctx.db.delete(filingId);

    await record(
      ctx,
      "filing.revertBill",
      `Sent a bill of ${party?.name ?? "a customer"} back to be named again`,
      { entity: "voucher", entityId: row.voucherId }
    );
    return { reverted: true as const, pages: storageIds.length };
  },
});

export const partyBills = query({
  args: { partyLedgerId: v.id("ledgers") },
  handler: async (ctx, { partyLedgerId }) => {
    const party = await ctx.db.get(partyLedgerId);
    if (!party) return null;

    const rows = await ctx.db
      .query("filing")
      .withIndex("by_party", (q) => q.eq("partyLedgerId", partyLedgerId))
      .collect();

    const bills = [];
    for (const r of rows) {
      const voucher = await ctx.db.get(r.voucherId);
      // Preserve attachment order across every page of the bill.
      const shots = (voucher?.attachments ?? []).filter((a) =>
        typeof a === "string" ? true : a.kind === "bill"
      );
      const photos = (
        await Promise.all(
          shots.map((a) =>
            ctx.storage.getUrl(typeof a === "string" ? a : a.previewStorageId ?? a.storageId)
          )
        )
      ).filter((url): url is string => Boolean(url));
      bills.push({
        id: r._id,
        voucherId: r.voucherId,
        date: voucher?.date ?? r.capturedAt,
        amount: voucher?.amount ?? null,
        refNo: voucher?.refNo ?? null,
        // A voucher with no amount is an unpriced slip — it touches no balance
        // until somebody prices it, which is the whole point of filing it.
        unpriced: voucher?.status === "pending",
        stage: r.stage,
        stack: r.stack ?? null,
        slot: r.slot ?? null,
        slotLabel: r.slot === undefined ? null : slotLabel(r.slot),
        photo: photos[0] ?? null,
        photos,
      });
    }
    bills.sort((a, b) => a.date - b.date);

    const hold = await holdOf(ctx, partyLedgerId);
    const slot = heldSlot(rows) ?? hold?.slot ?? null;
    return {
      name: party.name,
      place: party.place ?? "",
      folder: party.folder ?? null,
      slot,
      slotLabel: slot === null ? null : slotLabel(slot),
      /** Added by name with a bookmark and no paper yet: the hold can be freed. */
      heldOnly: !rows.some((r) => r.stage !== "filed") && Boolean(hold),
      counts: {
        all: rows.length,
        named: rows.filter((r) => r.stage === "named").length,
        slotted: rows.filter((r) => r.stage === "slotted").length,
        waiting: rows.filter((r) => r.stage === "waiting").length,
        filed: rows.filter((r) => r.stage === "filed").length,
        unpriced: bills.filter((b) => b.unpriced).length,
      },
      bills,
    };
  },
});

/** Gives a customer their permanent address: cabinet, drawer, folder number. */
export const setFolder = mutation({
  args: {
    partyLedgerId: v.id("ledgers"),
    cabinet: v.string(),
    drawer: v.string(),
    no: v.number(),
  },
  handler: async (ctx, { partyLedgerId, cabinet, drawer, no }) => {
    const party = await ctx.db.get(partyLedgerId);
    if (!party) throw new Error("No such party");
    await ctx.db.patch(partyLedgerId, {
      folder: { cabinet: cabinet.trim(), drawer: drawer.trim(), no },
      updatedAt: Date.now(),
    });
    await record(ctx, "filing.folder", `${party.name} filed at ${cabinet}/${drawer}/${no}`, {
      entity: "ledger",
      entityId: partyLedgerId,
    });
  },
});

/* ------------------------------------------------------------------ */
/* housekeeping                                                        */
/* ------------------------------------------------------------------ */

/** What is on the table and what is still to come, in numbers. */
export const state = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("filing").collect();
    const counts: Record<string, number> = { named: 0, slotted: 0, waiting: 0, filed: 0 };
    for (const r of rows) counts[r.stage] = (counts[r.stage] ?? 0) + 1;
    return {
      total: rows.length,
      counts,
      parties: new Set(rows.filter((r) => r.stage !== "filed").map((r) => r.partyLedgerId)).size,
      slotCount: await slotCount(ctx),
    };
  },
});

/**
 * Gives a bookmark to every slip that is holding none — the backlog named
 * before bookmarks were handed out at naming time, and anything left waiting
 * by a table that was once full.
 */
export const seatWaitingNow = mutation({
  args: {},
  handler: async (ctx) => {
    const seated = await seatWaiting(ctx);
    if (seated.length) {
      await record(ctx, "filing.seat", `${seated.length} bills given a bookmark`);
    }
    return { seated: seated.length, bookmarks: seated };
  },
});

/**
 * Empties the sorting queue.
 *
 * These rows are only ever a note of where paper goes — no voucher, no
 * photograph and no figure in the books is touched by removing them. Bills
 * already in a folder are kept unless `everything` is said, since their folder
 * is the record of where the paper went.
 */
export const clearQueue = mutation({
  args: { everything: v.optional(v.boolean()) },
  handler: async (ctx, { everything }) => {
    let removed = 0;
    for (const row of await ctx.db.query("filing").collect()) {
      if (!everything && row.stage === "filed") continue;
      await ctx.db.delete(row._id);
      removed += 1;
    }
    for (const hold of await ctx.db.query("filingHolds").collect()) await ctx.db.delete(hold._id);
    await record(ctx, "filing.clear", `${removed} bills taken out of the sorting queue`);
    return { removed };
  },
});

/**
 * Brings bills approved before any of this existed into the queue.
 *
 * Their photographs are long since on the voucher and the inbox rows are gone,
 * so the order they were photographed in cannot be recovered — the voucher's
 * own creation time stands in for it.
 */
export const backfill = internalMutation({
  args: {},
  handler: async (ctx) => {
    const already = new Set(
      (await ctx.db.query("filing").collect()).map((f) => f.voucherId)
    );
    let added = 0;
    for (const voucher of await ctx.db.query("vouchers").collect()) {
      if (already.has(voucher._id)) continue;
      if (!voucher.attachments?.length) continue;
      await enrol(ctx, {
        voucherId: voucher._id,
        partyLedgerId: voucher.partyLedgerId,
        capturedAt: voucher.createdAt,
      });
      added += 1;
    }
    if (added) {
      await record(ctx, "filing.backfill", `${added} photographed bills put in the sorting queue`);
    }
    return { added };
  },
});

/**
 * Throws away the camera test shots and the bills named from them.
 *
 * Everything photographed while the scanning screens were being built is a
 * picture of a laptop, not a slip, and the backlog is about to be shot again
 * properly. This clears the tray, the readings and the storage behind them.
 *
 * It is careful about the books. A named test shot became a *pending* voucher —
 * no amount, no entries, no effect on any balance — and only that kind is
 * removed. A voucher that has been priced, or that carries so much as one
 * entry, is left exactly where it is and its filing row with it; the count of
 * those comes back in `kept` so nothing disappears quietly.
 */
export const wipeTestShots = internalMutation({
  args: { confirm: v.literal("yes, they are all test shots") },
  handler: async (ctx) => {
    let photos = 0;
    let readings = 0;
    let bills = 0;
    let kept = 0;

    for (const r of await ctx.db.query("readings").collect()) {
      await ctx.db.delete(r._id);
      readings += 1;
    }

    for (const p of await ctx.db.query("inbox").collect()) {
      await ctx.storage.delete(p.storageId);
      await ctx.db.delete(p._id);
      photos += 1;
    }

    for (const row of await ctx.db.query("filing").collect()) {
      const voucher = await ctx.db.get(row.voucherId);
      if (voucher) {
        const entries = await ctx.db
          .query("voucherEntries")
          .withIndex("by_voucher", (q) => q.eq("voucherId", voucher._id))
          .collect();
        // Anything with a figure against it is somebody's real bill.
        if (voucher.status !== "pending" || entries.length > 0) {
          kept += 1;
          continue;
        }
        for (const a of voucher.attachments ?? []) {
          const storageId = typeof a === "string" ? a : a.storageId;
          if (storageId) await ctx.storage.delete(storageId);
        }
        await ctx.db.delete(voucher._id);
      }
      await ctx.db.delete(row._id);
      bills += 1;
    }

    await record(
      ctx,
      "filing.wipe",
      `${photos} test photographs and ${bills} bills named from them removed` +
        (kept ? `; ${kept} priced bills left alone` : "")
    );
    return { photos, readings, bills, kept };
  },
});
