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
 * The arrangement is the shop's own: one tray of unsorted paper, and thirty or
 * forty slots on the table beside it. A slip is photographed, its customer is
 * named, and the app answers with a slot number — the same number every time
 * for that customer, so their bills gather in one place however scattered they
 * were in the tray. When a customer's packet is done it goes into their folder
 * and the slot comes free for the next customer.
 *
 * So the slots are not one per customer. They are a working surface, reused all
 * day; the folders are where paper actually lives.
 */

const PLAN_KEY = "current";
const SLOTS_BY_DEFAULT = 40;

const planRow = (ctx: QueryCtx | MutationCtx) =>
  ctx.db
    .query("filingPlan")
    .withIndex("by_key", (q) => q.eq("key", PLAN_KEY))
    .unique();

async function slotCount(ctx: QueryCtx | MutationCtx) {
  return (await planRow(ctx))?.slotCount ?? SLOTS_BY_DEFAULT;
}

/** S07 — how a slot is written on the table and on the screen. */
export const slotLabel = (slot: number) => `S${String(slot).padStart(2, "0")}`;

/**
 * Which slot each customer is holding at the moment.
 *
 * Derived from the rows rather than stored: one source of truth, and no slot
 * table that can drift out of step with where the paper actually is.
 */
async function slotsHeld(ctx: QueryCtx | MutationCtx) {
  const rows = await ctx.db
    .query("filing")
    .withIndex("by_stage_capturedAt", (q) => q.eq("stage", "slotted"))
    .collect();
  const byParty = new Map<string, number>();
  for (const r of rows) {
    if (r.slot !== undefined) byParty.set(String(r.partyLedgerId), r.slot);
  }
  return byParty;
}

/**
 * The slot this customer's bill goes in.
 *
 * A customer already on the table keeps their slot, which is the whole point —
 * it is what gathers their slips together. A customer new to the table takes
 * the lowest free slot, so the table fills from one end and the eye knows where
 * to look. Nothing free means the table is full and a packet has to go into its
 * folder before sorting can go on; that is said rather than guessed around.
 */
async function slotFor(
  ctx: MutationCtx,
  partyLedgerId: Id<"ledgers">
): Promise<number | null> {
  const held = await slotsHeld(ctx);
  const already = held.get(String(partyLedgerId));
  if (already !== undefined) return already;

  const taken = new Set(held.values());
  const count = await slotCount(ctx);
  for (let slot = 1; slot <= count; slot += 1) if (!taken.has(slot)) return slot;
  return null;
}

/**
 * Records that this bill has been named. It does not move any paper.
 *
 * Naming and placing are two separate walks through the stack, and this is the
 * end of the first one: the slip goes back where it came from, in order, and
 * the books now know whose it is. No slot is given out here — see `slot` on the
 * filing table for why giving one out at this moment empties the table.
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
): Promise<{ rowId: Id<"filing"> }> {
  const existing = await ctx.db
    .query("filing")
    .withIndex("by_voucher", (q) => q.eq("voucherId", args.voucherId))
    .first();
  if (existing) return { rowId: existing._id };

  const rowId = await ctx.db.insert("filing", {
    voucherId: args.voucherId,
    partyLedgerId: args.partyLedgerId,
    capturedAt: args.capturedAt,
    stack: args.stack,
    stage: "named",
    at: Date.now(),
  });
  return { rowId };
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

    // The next few slips' photographs, fetched before Next is pressed.
    const ahead: string[] = [];
    for (const row of mine.filter((r) => r.stage === "named").sort((a, b) => a.capturedAt - b.capturedAt)) {
      if (ahead.length >= 4) break;
      const voucher = await ctx.db.get(row.voucherId);
      const first = voucher?.attachments?.[0];
      const storageId = typeof first === "string" ? first : first?.storageId;
      const url = storageId ? await ctx.storage.getUrl(storageId) : null;
      if (url) ahead.push(url);
    }

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
  const party = await ctx.db.get(row.partyLedgerId);
  const voucher = await ctx.db.get(row.voucherId);
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

    const slot = await slotFor(ctx, row.partyLedgerId);
    await ctx.db.patch(row._id, {
      slot: slot ?? undefined,
      stage: slot === null ? "waiting" : "slotted",
      at: Date.now(),
    });

    const fresh = (await ctx.db.get(row._id))!;
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
 * the wrong slot, or Next was pressed twice. It goes back to named, keeping its
 * place in the stack, and comes up again on the next press.
 */
export const unplace = mutation({
  args: { id: v.id("filing") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) throw new Error("That bill is not in the sorting queue");
    if (row.stage === "filed") throw new Error("That packet is already in its folder");
    await ctx.db.patch(id, { slot: undefined, stage: "named", at: Date.now() });
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
    const rows = await ctx.db
      .query("filing")
      .withIndex("by_stage_capturedAt", (q) => q.eq("stage", "slotted"))
      .collect();

    const bySlot = new Map<number, { partyLedgerId: Id<"ledgers">; bills: number; since: number }>();
    for (const r of rows) {
      if (r.slot === undefined) continue;
      const held = bySlot.get(r.slot) ?? {
        partyLedgerId: r.partyLedgerId,
        bills: 0,
        since: r.at,
      };
      held.bills += 1;
      held.since = Math.min(held.since, r.at);
      bySlot.set(r.slot, held);
    }

    const out = [];
    for (let slot = 1; slot <= count; slot += 1) {
      const held = bySlot.get(slot);
      const party = held ? await ctx.db.get(held.partyLedgerId) : null;
      out.push({
        slot,
        label: slotLabel(slot),
        partyLedgerId: held?.partyLedgerId ?? null,
        party: party?.name ?? null,
        folder: party?.folder ?? null,
        bills: held?.bills ?? 0,
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
      slotCount: count,
      slots: out,
      used: bySlot.size,
      free: count - bySlot.size,
      // Named while the table was full. They have nowhere to go until a packet
      // is filed, and saying so is the only honest thing to do about it.
      waiting,
    };
  },
});

/** Lays out more slots, or fewer. */
export const setSlotCount = mutation({
  args: { slotCount: v.number() },
  handler: async (ctx, { slotCount: wanted }) => {
    if (!Number.isInteger(wanted) || wanted < 2 || wanted > 200) {
      throw new Error("Between 2 and 200 slots");
    }
    const held = await slotsHeld(ctx);
    const highest = Math.max(0, ...held.values());
    if (wanted < highest) {
      throw new Error(
        `${slotLabel(highest)} is holding a packet — file it before taking the table down to ${wanted}`
      );
    }
    const row = await planRow(ctx);
    if (row) await ctx.db.patch(row._id, { slotCount: wanted, madeAt: Date.now() });
    else await ctx.db.insert("filingPlan", { key: PLAN_KEY, slotCount: wanted, madeAt: Date.now() });
    return { slotCount: wanted };
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
async function seatWaiting(ctx: MutationCtx) {
  const waiting = (
    await ctx.db
      .query("filing")
      .withIndex("by_stage_capturedAt", (q) => q.eq("stage", "waiting"))
      .collect()
  ).sort((a, b) => a.capturedAt - b.capturedAt);

  const seated: { party: string; slot: number }[] = [];
  for (const row of waiting) {
    const slot = await slotFor(ctx, row.partyLedgerId);
    if (slot === null) break;              // the table filled up again
    await ctx.db.patch(row._id, { slot, stage: "slotted" });
    const party = await ctx.db.get(row.partyLedgerId);
    seated.push({ party: party?.name ?? "—", slot });
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
    if (slot < 1 || slot > count) throw new Error(`There is no ${slotLabel(slot)} on the table`);

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

    let ledgerId = partyLedgerId;
    if (!ledgerId) {
      const wanted = (partyName ?? "").trim();
      if (!wanted) throw new Error("Say whose bill this is");
      const all = await ctx.db.query("ledgers").collect();
      const exact = all.find((l) => l.name.toLowerCase() === wanted.toLowerCase());
      if (exact) ledgerId = exact._id;
      else {
        const group = await ctx.db
          .query("groups")
          .withIndex("by_name", (q) => q.eq("name", "Sundry Debtors"))
          .unique();
        if (!group) throw new Error("The Sundry Debtors group is missing");
        const now = Date.now();
        ledgerId = await ctx.db.insert("ledgers", {
          name: properText(wanted),
          groupId: group._id,
          openingBalance: 0,
          openingSide: "Dr",
          openingAsOf: photo.at,
          active: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

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

    await enrol(ctx, {
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
    // No slot here on purpose: the slip goes back on the stack, and the slot is
    // given out on the second walk, when the paper actually reaches the table.
    return { voucherId, party: party?.name ?? "" };
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
    const byParty = new Map<Id<"ledgers">, Doc<"filing">[]>();
    for (const r of rows) {
      const list = byParty.get(r.partyLedgerId) ?? [];
      list.push(r);
      byParty.set(r.partyLedgerId, list);
    }

    const out = [];
    for (const [partyLedgerId, list] of byParty) {
      const party = await ctx.db.get(partyLedgerId);
      if (!party) continue;
      let unpriced = 0;
      for (const r of list) {
        const voucher = await ctx.db.get(r.voucherId);
        if (voucher && voucher.status === "pending") unpriced += 1;
      }
      const onTable = list.find((r) => r.stage === "slotted" && r.slot !== undefined);
      out.push({
        partyLedgerId,
        name: party.name,
        folder: party.folder ?? null,
        bills: list.length,
        filed: list.filter((r) => r.stage === "filed").length,
        unpriced,
        slot: onTable?.slot ?? null,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
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

    const onTable = rows.find((r) => r.stage === "slotted" && r.slot !== undefined);
    return {
      name: party.name,
      place: party.place ?? "",
      folder: party.folder ?? null,
      slot: onTable?.slot ?? null,
      slotLabel: onTable?.slot === undefined ? null : slotLabel(onTable.slot),
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
 * Seats anything that was placed while the table was full.
 *
 * Only those — a bill still sitting in the stack as "named" is not stranded, it
 * simply has not been placed yet, and giving it a slot from here would hold the
 * table for paper nobody has picked up.
 */
export const seatWaitingNow = mutation({
  args: {},
  handler: async (ctx) => {
    const seated = await seatWaiting(ctx);
    if (seated.length) await record(ctx, "filing.seat", `${seated.length} bills given a slot`);
    return { seated };
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
