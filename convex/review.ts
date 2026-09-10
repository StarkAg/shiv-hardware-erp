import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { record } from "./lib/history";
import type { Doc } from "./_generated/dataModel";

/* ------------------------------------------------------------------ */
/* what the reader needs                                               */
/* ------------------------------------------------------------------ */

export const photoUrls = internalQuery({
  args: { inboxId: v.id("inbox") },
  handler: async (ctx, { inboxId }) => {
    const row = await ctx.db.get(inboxId);
    if (!row) return null;

    // Pages shot as one bill are read together, or the total on the last
    // sheet belongs to items the model never saw.
    const pageRows = row.groupId
      ? (
          await ctx.db
            .query("inbox")
            .withIndex("by_group", (q) => q.eq("groupId", row.groupId))
            .collect()
        ).sort((a, b) => a.at - b.at)
      : [row];

    const pages: string[] = [];
    for (const page of pageRows) {
      // A query cannot open the file itself — it hands back a URL and the
      // action fetches it.
      const url = await ctx.storage.getUrl(page.storageId);
      if (url) pages.push(url);
    }
    return pages.length ? { pages } : null;
  },
});

export const partyNames = internalQuery({
  args: {},
  handler: async (ctx) => {
    const groups = await ctx.db.query("groups").collect();
    const parties = new Set(
      groups
        .filter((g) => g.name === "Sundry Creditors" || g.name === "Sundry Debtors")
        .map((g) => g._id as string)
    );
    const ledgers = await ctx.db.query("ledgers").collect();
    return ledgers
      .filter((l) => parties.has(l.groupId as string) && l.active)
      .map((l) => (l.place ? `${l.name} (${l.place})` : l.name))
      .sort();
  },
});

export const activeLessons = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("lessons").withIndex("by_at").order("desc").take(120);
    return rows
      .filter((l) => l.active)
      .map((l) => {
        if (l.kind === "rule") return l.note ?? "";
        if (l.kind === "alias") return `"${l.wrong}" on paper means the account "${l.right}"`;
        return `${l.field}: read as "${l.wrong}", should have been "${l.right}"`;
      })
      .filter(Boolean);
  },
});

/* ------------------------------------------------------------------ */
/* reading lifecycle                                                   */
/* ------------------------------------------------------------------ */

/**
 * The one reading a bill is allowed to have.
 *
 * Keyed to the bill, not the sheet. A bill photographed over four pages is
 * four rows in the inbox sharing a groupId, and reading any one of them must
 * find the reading the others already made — otherwise the same bill sits in
 * the queue twice, on two cards, and can be approved into the books twice.
 * `unread` will not hand out a second page of a group, but nothing stopped a
 * re-read aimed straight at one, which is exactly what a retry does.
 */
async function readingFor(ctx: any, inboxId: Id<"inbox">) {
  const direct = await ctx.db
    .query("readings")
    .withIndex("by_inbox", (q: any) => q.eq("inboxId", inboxId))
    .unique();
  if (direct) return direct;

  const row = await ctx.db.get(inboxId);
  if (!row?.groupId) return null;

  // Asked of the sheets rather than of readings.groupId: a reading saved
  // before its page was joined to the others carries no group of its own, and
  // it is still this bill's reading.
  const pages = await ctx.db
    .query("inbox")
    .withIndex("by_group", (q: any) => q.eq("groupId", row.groupId))
    .collect();
  for (const page of pages) {
    if (page._id === inboxId) continue;
    const held = await ctx.db
      .query("readings")
      .withIndex("by_inbox", (q: any) => q.eq("inboxId", page._id))
      .unique();
    if (held) return held;
  }
  return null;
}

export const markReading = internalMutation({
  args: { inboxId: v.id("inbox") },
  handler: async (ctx, { inboxId }) => {
    const existing = await readingFor(ctx, inboxId);
    const row = await ctx.db.get(inboxId);
    if (existing) {
      await ctx.db.patch(existing._id, { status: "reading", error: undefined, at: Date.now() });
      return;
    }
    await ctx.db.insert("readings", {
      inboxId,
      groupId: row?.groupId,
      status: "reading",
      at: Date.now(),
    });
  },
});

export const saveReading = internalMutation({
  args: { inboxId: v.id("inbox"), draft: v.any(), model: v.string(), ms: v.number() },
  handler: async (ctx, { inboxId, draft, model, ms }) => {
    const existing = await readingFor(ctx, inboxId);
    const fields = { status: "ready" as const, draft, model, ms, error: undefined, at: Date.now() };
    if (existing) await ctx.db.patch(existing._id, fields);
    // The group goes on with it. `unread` and `counts` both read a group as
    // done from the reading's own groupId, so a reading that lost it would
    // leave its bill looking unread for ever — offered, read, offered again.
    else await ctx.db.insert("readings", { inboxId, groupId: (await ctx.db.get(inboxId))?.groupId, ...fields });
  },
});

export const failReading = internalMutation({
  args: { inboxId: v.id("inbox"), error: v.string() },
  handler: async (ctx, { inboxId, error }) => {
    const existing = await readingFor(ctx, inboxId);
    const fields = { status: "failed" as const, error, at: Date.now() };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("readings", { inboxId, groupId: (await ctx.db.get(inboxId))?.groupId, ...fields });
  },
});

/* ------------------------------------------------------------------ */
/* the queue                                                           */
/* ------------------------------------------------------------------ */

/** Inbox photos nobody has read yet — one id per bill, not per sheet. */
export const unread = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const photos = await ctx.db.query("inbox").withIndex("by_at").order("desc").take(200);
    const readings = await ctx.db.query("readings").collect();
    const seen = new Set(readings.map((r) => r.inboxId as string));
    const groupsDone = new Set(readings.map((r) => r.groupId).filter(Boolean));

    const out: string[] = [];
    const groupsQueued = new Set<string>();
    for (const photo of photos) {
      if (seen.has(photo._id as string)) continue;
      if (photo.groupId) {
        if (groupsDone.has(photo.groupId) || groupsQueued.has(photo.groupId)) continue;
        groupsQueued.add(photo.groupId);
      }
      out.push(photo._id as string);
      if (out.length >= (limit ?? 25)) break;
    }
    return out;
  },
});

/**
 * Bills already read, whose reading is older than a given moment.
 *
 * The reader's instructions get corrected as the shop teaches it, and every
 * slip read before a correction still carries the old mistake — the queue does
 * not re-read itself. This is the list to put through again.
 *
 * `before` is what lets a long run finish. A re-read stamps the reading with
 * the time it completed, so it drops out of this list and the caller can keep
 * asking for the next chunk until nothing comes back. Without it the same ten
 * bills would be handed out for ever.
 *
 * Slips set aside as doubtful are left where they are — somebody put them
 * there on purpose, and a fresh guess is not what they were waiting for.
 */
export const stale = query({
  args: { before: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { before, limit }) => {
    const readings = await ctx.db.query("readings").collect();
    return readings
      .filter((r) => (r.status === "ready" || r.status === "failed") && r.at < before)
      .sort((a, b) => a.at - b.at)
      .slice(0, limit ?? 10)
      .map((r) => r.inboxId as string);
  },
});

/** Everything waiting to be looked at, with its bill and its draft. */
export const queue = query({
  args: { only: v.optional(v.union(v.literal("open"), v.literal("doubt"))) },
  handler: async (ctx, { only }) => {
    const all = await ctx.db.query("readings").collect();
    const readings =
      only === "doubt"
        ? all.filter((r) => r.status === "doubt")
        : all.filter((r) => r.status !== "doubt");
    readings.sort((a, b) => b.at - a.at);

    const out = [];
    for (const reading of readings) {
      const photo = await ctx.db.get(reading.inboxId);
      if (!photo) continue;

      const pageRows = photo.groupId
        ? (
            await ctx.db
              .query("inbox")
              .withIndex("by_group", (q) => q.eq("groupId", photo.groupId))
              .collect()
          ).sort((a, b) => a.at - b.at)
        : [photo];

      out.push({
        _id: reading._id,
        inboxId: reading.inboxId,
        status: reading.status,
        draft: reading.draft ?? null,
        error: reading.error ?? null,
        doubtNote: reading.doubtNote ?? null,
        model: reading.model ?? null,
        ms: reading.ms ?? null,
        at: reading.at,
        // When the first sheet was photographed — the order the pile was
        // actually worked through, which is not the order it was read in.
        shotAt: pageRows[0]?.at ?? reading.at,
        // The marks on the bill, which live on the photograph while it is in
        // the pile and move onto the voucher when it is approved.
        tags: photo.tags ?? [],
        anchorId: photo._id,
        pages: await Promise.all(
          pageRows.map(async (p) => ({
            _id: p._id,
            at: p.at,
            url: await ctx.storage.getUrl(p.storageId),
          }))
        ),
      });
    }
    return out;
  },
});

export const counts = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("readings").collect();
    const photos = await ctx.db.query("inbox").collect();

    // A reading whose photograph has been deleted is not a bill any more. The
    // queue skips it — it has no card to draw — so counting it here put a
    // number on the screen with nothing behind it: a "1 failed" that no amount
    // of retrying could ever bring down, because there was nothing to retry.
    const stillThere = new Set(photos.map((p) => p._id as string));
    const readings = all.filter((r) => stillThere.has(r.inboxId as string));

    // Read from every reading, not the filtered ones: a group that has been
    // read stays read whichever of its sheets was later thrown away, and
    // `unread` decides the same way. Disagreeing with it would light the "read
    // all" button for bills it then refuses to hand out.
    const read = new Set(all.map((r) => r.inboxId as string));
    const groupsRead = new Set(all.map((r) => r.groupId).filter(Boolean));

    // Counted in bills, not sheets — the queue reads a five-page bill once, so
    // counting its other four pages as unread leaves a button offering work
    // that does not exist.
    const bills = new Set<string>();
    for (const photo of photos) {
      if (photo.groupId) {
        if (groupsRead.has(photo.groupId)) continue;
        bills.add(`g:${photo.groupId}`);
      } else if (!read.has(photo._id as string)) {
        bills.add(`p:${photo._id}`);
      }
    }

    return {
      doubt: readings.filter((r) => r.status === "doubt").length,
      ready: readings.filter((r) => r.status === "ready").length,
      reading: readings.filter((r) => r.status === "reading").length,
      failed: readings.filter((r) => r.status === "failed").length,
      unread: bills.size,
    };
  },
});

/**
 * Proof that no bill is in two places at once.
 *
 * The buckets are meant to be exclusive — a bill is waiting to be read, or in
 * the queue, or set aside in doubt, or in the books, or in the trash, and
 * never two of those. Nothing in the schema says so, though: the exclusivity
 * comes from each mutation deleting what it moved out of, and a mutation that
 * ever half-finishes leaves a bill in both. This counts the ways that can show
 * up, so it is seen rather than assumed.
 *
 * Everything it returns is a fault. `ok` means the books and the pile agree.
 */
export const audit = query({
  args: {},
  handler: async (ctx) => {
    const [readings, photos, vouchers, binned, papers] = await Promise.all([
      ctx.db.query("readings").collect(),
      ctx.db.query("inbox").collect(),
      ctx.db.query("vouchers").collect(),
      ctx.db.query("trash").collect(),
      ctx.db.query("papers").collect(),
    ]);

    const photoById = new Map(photos.map((p) => [p._id as string, p]));

    // One bill, two cards. A bill is its group where it has one, and the sheet
    // itself where it does not.
    const owner = new Map<string, string[]>();
    for (const r of readings) {
      const page = photoById.get(r.inboxId as string);
      if (!page) continue;
      const bill = page.groupId ? `g:${page.groupId}` : `p:${page._id}`;
      owner.set(bill, [...(owner.get(bill) ?? []), r._id as string]);
    }
    const twoCards = [...owner.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([bill, readingIds]) => ({ bill, readingIds }));

    // A reading whose photograph is gone. In no bucket rather than two, but it
    // is still a row nothing can ever clear.
    const orphans = readings
      .filter((r) => !photoById.has(r.inboxId as string))
      .map((r) => ({ readingId: r._id as string, status: r.status }));

    // A photograph in the pile and in the books at the same time: approving
    // attaches it to the voucher and deletes the inbox row, so one of the two
    // did not happen.
    const filed = new Map<string, string[]>();
    const note = (id: string, where: string) =>
      filed.set(id, [...(filed.get(id) ?? []), where]);
    for (const v of vouchers)
      for (const d of v.attachments)
        note(typeof d === "string" ? d : (d.storageId as string), `voucher:${v._id}`);
    for (const t of binned)
      for (const d of t.attachments)
        note(typeof d === "string" ? d : (d.storageId as string), `trash:${t._id}`);
    for (const w of papers)
      for (const d of w.documents)
        note(typeof d === "string" ? d : (d.storageId as string), `paper:${w._id}`);
    for (const p of photos) note(p.storageId as string, `inbox:${p._id}`);

    const twoPlaces = [...filed.entries()]
      .filter(([, wheres]) => wheres.length > 1)
      .map(([storageId, wheres]) => ({ storageId, wheres }));

    const faults = twoCards.length + orphans.length + twoPlaces.length;
    return {
      ok: faults === 0,
      faults,
      twoCards,
      orphans,
      twoPlaces,
      counted: {
        readings: readings.length,
        photos: photos.length,
        vouchers: vouchers.length,
        trash: binned.length,
        papers: papers.length,
      },
    };
  },
});

/**
 * Clears what `audit` calls an orphan: a reading whose photograph is gone.
 *
 * Nothing can reach these from the screen — the queue draws no card for a
 * reading it has no photograph for — so they are rows that sit there for ever,
 * and until `counts` was taught to skip them they put a number on the toolbar
 * that no amount of retrying could bring down. Deliberately not automatic:
 * a reading with no photograph is evidence that something went wrong
 * elsewhere, and quietly tidying it away loses that.
 */
export const sweepOrphans = mutation({
  args: {},
  handler: async (ctx) => {
    const readings = await ctx.db.query("readings").collect();
    const swept: string[] = [];
    for (const r of readings) {
      if (await ctx.db.get(r.inboxId)) continue;
      swept.push(`${r.status}`);
      await ctx.db.delete(r._id);
    }
    if (swept.length) {
      await record(ctx, "review.sweep", `Cleared ${swept.length} reading(s) whose photograph was gone`);
    }
    return { swept: swept.length, statuses: swept };
  },
});

/**
 * Drops a slip that is the same slip as another one, photograph and all.
 *
 * Skip is not this. Skip deletes the reading and leaves the photograph in the
 * inbox, so the bill goes back to being unread and the next run reads it
 * again — which for a duplicate means the second card returns, every time.
 * This takes the photograph with it, so the pile actually gets shorter.
 *
 * Every sheet of the bill goes, not just the one the reading was keyed to.
 * Leaving the other pages behind would put them back in the queue as a bill
 * of their own, which is a worse mess than the one being cleaned up.
 */
export const dropDuplicate = mutation({
  args: { readingId: v.id("readings"), twinOf: v.optional(v.id("readings")) },
  handler: async (ctx, { readingId, twinOf }) => {
    const reading = await ctx.db.get(readingId);
    if (!reading) throw new Error("That slip is no longer in the queue");

    const photo = await ctx.db.get(reading.inboxId);
    const pages = photo
      ? photo.groupId
        ? await ctx.db
            .query("inbox")
            .withIndex("by_group", (q) => q.eq("groupId", photo.groupId))
            .collect()
        : [photo]
      : [];

    for (const page of pages) {
      await ctx.storage.delete(page.storageId).catch(() => {});
      await ctx.db.delete(page._id);
    }
    await ctx.db.delete(readingId);

    const said = (reading.draft as any)?.party ?? "a slip";
    await record(
      ctx,
      "review.duplicate",
      `Dropped ${pages.length} sheet(s) of ${said} as a duplicate` +
        (twinOf ? " of another slip in the queue" : ""),
      { detail: { readingId, twinOf, draft: reading.draft } }
    );
    return { pages: pages.length };
  },
});

/**
 * Files a paper that is not a voucher — a supplier's statement of account.
 *
 * Nothing is posted. The statement lists bills and payments that belong in the
 * books from the shop's own papers, and entering them from here would double
 * every one of them the day the real bill turns up. What it is good for is
 * checking an account and having something to point at while doing it, so the
 * photograph is filed against the party and the closing figure kept beside it.
 */
export const fileStatement = mutation({
  args: {
    readingId: v.id("readings"),
    ledgerId: v.id("ledgers"),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    closing: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const reading = await ctx.db.get(args.readingId);
    if (!reading) throw new Error("That slip is no longer in the queue");
    const ledger = await ctx.db.get(args.ledgerId);
    if (!ledger) throw new Error("That account no longer exists");

    const photo = await ctx.db.get(reading.inboxId);
    const pages = photo
      ? photo.groupId
        ? (
            await ctx.db
              .query("inbox")
              .withIndex("by_group", (q) => q.eq("groupId", photo.groupId))
              .collect()
          ).sort((a, b) => a.at - b.at)
        : [photo]
      : [];

    const paperId = await ctx.db.insert("papers", {
      ledgerId: args.ledgerId,
      kind: "statement",
      documents: pages.map((p) => ({ storageId: p.storageId, kind: "other" as const })),
      from: args.from,
      to: args.to,
      closing: args.closing,
      note: args.note,
      at: Date.now(),
    });

    // Out of the pile, the same way approving takes a bill out of it — the
    // paper is filed, so it has no business still being in the queue.
    for (const page of pages) await ctx.db.delete(page._id);
    await ctx.db.delete(args.readingId);

    await record(
      ctx,
      "review.statement",
      `Filed a statement against ${ledger.name}` +
        (args.closing != null ? `, closing ${args.closing}` : ""),
      { entity: "ledger", entityId: args.ledgerId as string }
    );
    return { paperId, pages: pages.length };
  },
});

/** Statements and the like filed against one account. */
export const papersFor = query({
  args: { ledgerId: v.id("ledgers") },
  handler: async (ctx, { ledgerId }) => {
    const rows = await ctx.db
      .query("papers")
      .withIndex("by_ledger", (q) => q.eq("ledgerId", ledgerId))
      .collect();
    rows.sort((a, b) => (b.to ?? b.at) - (a.to ?? a.at));
    return Promise.all(
      rows.map(async (r) => ({
        _id: r._id,
        kind: r.kind,
        from: r.from ?? null,
        to: r.to ?? null,
        closing: r.closing ?? null,
        note: r.note ?? null,
        at: r.at,
        pages: await Promise.all(
          r.documents.map(async (d) => {
            const storageId = typeof d === "string" ? d : d.storageId;
            return { storageId, url: await ctx.storage.getUrl(storageId) };
          })
        ),
      }))
    );
  },
});

/**
 * Slips in the queue that say exactly the same thing as another slip.
 *
 * The same bill gets photographed twice often enough — a sheet that did not
 * look like it came out, a pile worked from both ends. The two reads then
 * disagree on the ref by a digit and agree on everything that matters, and
 * approving both bills the account twice.
 *
 * Matched on the party, the date and the total, the trio that does not
 * coincide by accident. The ref is deliberately left out of the key: a
 * misread digit there is exactly how these pairs give themselves away.
 *
 * Asked of every bucket at once, not of the screen. A duplicate whose twin was
 * set aside in doubt is the one most likely to be approved by mistake — the
 * card in front of you looks perfectly ordinary and its twin is on another
 * screen entirely.
 */
export const twins = query({
  args: {},
  handler: async (ctx) => {
    const readings = await ctx.db.query("readings").collect();

    const bare = (raw: unknown) =>
      String(raw ?? "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .toLowerCase()
        .split(",")[0]
        .replace(/[^a-z\s]/g, " ")
        .replace(/\b(m\/s|ms|jee|ji|shri|sri|store|stores)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const byKey = new Map<string, string[]>();
    for (const r of readings) {
      const d = r.draft as any;
      if (!d || d.total == null || !d.date) continue;
      const key = `${bare(d.party)}|${d.date}|${d.total}`;
      byKey.set(key, [...(byKey.get(key) ?? []), r._id as string]);
    }

    // Returned as a flat list of pairs-and-more, each id to its others, so the
    // screen can look up a card without walking the groups.
    const out: Record<string, string[]> = {};
    for (const ids of byKey.values()) {
      if (ids.length < 2) continue;
      for (const id of ids) out[id] = ids.filter((other) => other !== id);
    }
    return out;
  },
});

/**
 * Undoes a filing: a bill in the books goes back to the pile to be read again.
 *
 * Only ever a pending voucher, and only one that carries no Dr and no Cr. A
 * pending voucher is a bill filed without an amount — it touches no balance by
 * design, which is the only reason this is safe to do at all. The guard is not
 * decoration: pointed at a real voucher this would silently withdraw money
 * from the books, so it refuses rather than trusting the caller to have picked
 * the right one.
 *
 * The photographs go back to the inbox and the voucher row is deleted outright
 * rather than moved to Trash. Trash keeps the photographs with it, and a
 * photograph in the trash and in the pile at once is exactly the two-bucket
 * fault `audit` exists to catch. What the voucher said — the account somebody
 * picked, the date, the ref — is written into the history instead, because a
 * re-read starts again from the paper and will not know any of it.
 */
export const sendBackToReview = mutation({
  args: { voucherId: v.id("vouchers") },
  handler: async (ctx, { voucherId }) => {
    const voucher = await ctx.db.get(voucherId);
    if (!voucher) throw new Error("That voucher no longer exists");
    if (voucher.status !== "pending") {
      throw new Error("Only a bill still awaiting an amount can go back to the queue");
    }

    const lines = await ctx.db
      .query("voucherEntries")
      .withIndex("by_voucher", (q) => q.eq("voucherId", voucherId))
      .collect();
    if (lines.length > 0) {
      throw new Error("That voucher has entries against it — it is in the books properly");
    }

    const docs = voucher.attachments.map((d) =>
      typeof d === "string" ? { storageId: d } : { storageId: d.storageId }
    );
    if (docs.length === 0) throw new Error("No photograph to put back in the pile");

    // Sheets of one bill keep company. Stamped with when the bill was filed
    // rather than now: the moment it was photographed is not recoverable, and
    // dating it today would sort it to the top of the roll as if just shot.
    const groupId = docs.length > 1 ? `u${Date.now().toString(36)}` : undefined;
    for (const doc of docs) {
      await ctx.db.insert("inbox", {
        storageId: doc.storageId,
        at: voucher.createdAt,
        groupId,
        tags: voucher.tags,
      });
    }

    const party = await ctx.db.get(voucher.partyLedgerId);
    const type = await ctx.db.get(voucher.typeId);
    const label = `${type?.abbr ?? "VCH"}-${String(voucher.voucherNo).padStart(4, "0")}`;
    await ctx.db.delete(voucherId);

    await record(
      ctx,
      "voucher.unfile",
      `Withdrew ${label} (${party?.name ?? "—"}) back to the reading queue`,
      {
        entity: "ledger",
        entityId: voucher.partyLedgerId as string,
        detail: {
          label,
          party: party?.name,
          date: voucher.date,
          refNo: voucher.refNo,
          narration: voucher.narration,
          sheets: docs.length,
        },
      }
    );
    return { label, sheets: docs.length };
  },
});

/* ------------------------------------------------------------------ */
/* approving into the books                                            */
/* ------------------------------------------------------------------ */

/**
 * The account a slip with no name on it goes to.
 *
 * Plenty of counter sales are written on a blank leaf, paid there and then,
 * and never carry a name — there is nobody to put them under, and refusing to
 * file them at all left the money out of the books entirely. They go here
 * instead, and when one is paid in full the receipt brings this account
 * straight back to nought, so it only ever carries what an unnamed customer
 * still owes.
 *
 * Opened the first time one is approved rather than seeded, so a shop that
 * never files an unnamed bill never grows the account.
 */
const WALK_IN = "W/B";

/**
 * The walk-in account's id, opening it if this is the first unnamed slip.
 *
 * Matched on the exact name and nothing looser: the name resolver `approve`
 * uses for a party read off a slip matches on a substring, which is right for
 * handwriting and quite wrong for a fixed account — one customer named with a
 * "w/b" in it and every counter sale in the shop would land on them.
 */
async function walkInAccount(ctx: MutationCtx, date: number): Promise<Id<"ledgers">> {
  const existing = (await ctx.db.query("ledgers").collect()).find(
    (l) => l.name === WALK_IN
  );
  if (existing) return existing._id;

  const group = await ctx.db
    .query("groups")
    .withIndex("by_name", (q) => q.eq("name", "Sundry Debtors"))
    .unique();
  if (!group) throw new Error("The Sundry Debtors group is missing");

  const now = Date.now();
  return ctx.db.insert("ledgers", {
    name: WALK_IN,
    groupId: group._id,
    openingBalance: 0,
    openingSide: "Dr",
    openingAsOf: date,
    active: true,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Turns an approved draft into a real voucher.
 *
 * Whatever was changed on the way through is kept as a lesson, so the next
 * bill in the same hand is read better than this one was.
 */
export const approve = mutation({
  args: {
    readingId: v.id("readings"),
    kind: v.union(
      v.literal("sale"),
      v.literal("purchase"),
      v.literal("receipt"),
      v.literal("payment"),
      v.literal("goods_return"),
      v.literal("discount"),
      v.literal("expense")
    ),
    partyLedgerId: v.optional(v.id("ledgers")),
    // No name on the slip. Said as a flag rather than by passing the account's
    // name, so the name of the account lives in the books and here, and not in
    // every caller that ever files a counter sale.
    walkIn: v.optional(v.boolean()),
    // Name the party instead of looking its id up first. Working a pile from a
    // terminal, resolving the account and opening a new one were two more
    // round trips before the one that mattered — and the network is nearly all
    // of what a command costs.
    partyName: v.optional(v.string()),
    openAs: v.optional(
      v.union(v.literal("customer"), v.literal("supplier"), v.literal("expense"))
    ),
    date: v.number(),
    amount: v.optional(v.number()),
    refNo: v.optional(v.string()),
    narration: v.optional(v.string()),
    contraLedgerId: v.optional(v.id("ledgers")),
    // What was actually handed over on this slip, which is not always the whole
    // bill: a slip can net to 240 after a goods return, carry 200 in cash, and
    // leave 40 owing. An amount rather than a tick, because "paid" and "paid in
    // full" are different things and a tick could not say which.
    paidNow: v.optional(v.number()),
    // Goods on one day, money on another — a bill stamped PAID a fortnight
    // later is two events, and dating the receipt to the sale hides that.
    paidDate: v.optional(v.number()),
    moneyLedgerId: v.optional(v.id("ledgers")),
    moneyName: v.optional(v.string()),
    // Stock that came back. `amount` above is already net of it; this is kept
    // so the return itself is on the record rather than inferred from a gap.
    goodsReturn: v.optional(v.number()),
    documentKind: v.optional(
      v.union(
        v.literal("bill"),
        v.literal("challan"),
        v.literal("estimate"),
        v.literal("receipt"),
        v.literal("other")
      )
    ),
    corrections: v.optional(
      v.array(v.object({ field: v.string(), wrong: v.string(), right: v.string() }))
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    voucherId: Id<"vouchers">;
    settledBy?: Id<"vouchers">;
    lines: number;
  }> => {
    const reading = await ctx.db.get(args.readingId);
    if (!reading) throw new Error("That reading is gone");

    // Resolve the party: an id if given, else a name — opening the account
    // here when it is new and `openAs` says which side of the book it is on.
    let partyLedgerId = args.partyLedgerId;
    if (!partyLedgerId && args.walkIn) {
      partyLedgerId = await walkInAccount(ctx, args.date);
    }
    if (!partyLedgerId) {
      if (!args.partyName) throw new Error("Name the party, or give its id");
      const wanted = args.partyName.trim().toLowerCase();
      const all = await ctx.db.query("ledgers").collect();
      const hits = all.filter((l) => l.name.toLowerCase().includes(wanted));
      const exact = hits.find((l) => l.name.toLowerCase() === wanted);
      if (exact) partyLedgerId = exact._id;
      else if (hits.length === 1) partyLedgerId = hits[0]._id;
      else if (hits.length > 1) {
        throw new Error(`"${args.partyName}" matches ${hits.map((h) => h.name).join(", ")}`);
      } else {
        if (!args.openAs) {
          throw new Error(`No account called "${args.partyName}" — pass openAs to open one`);
        }
        const wants =
          args.openAs === "supplier"
            ? "Sundry Creditors"
            : args.openAs === "expense"
              ? "Indirect Expenses"
              : "Sundry Debtors";
        const group = await ctx.db
          .query("groups")
          .withIndex("by_name", (qq) => qq.eq("name", wants))
          .unique();
        if (!group) throw new Error(`The ${wants} group is missing`);
        const now2 = Date.now();
        partyLedgerId = await ctx.db.insert("ledgers", {
          name: args.partyName.trim(),
          groupId: group._id,
          openingBalance: 0,
          openingSide: args.openAs === "supplier" ? "Cr" : "Dr",
          openingAsOf: args.date,
          active: true,
          createdAt: now2,
          updatedAt: now2,
        });
      }
    }

    // Each kind of voucher names its other side differently, so the contra
    // account is resolved here rather than guessed at by the caller.
    const groups = await ctx.db.query("groups").collect();
    const ledgers = await ctx.db.query("ledgers").collect();
    const inGroup = (groupName: string) => {
      const group = groups.find((g) => g.name === groupName);
      return group ? ledgers.find((l) => l.groupId === group._id) : undefined;
    };
    const byName = (name: string) => ledgers.find((l) => l.name === name);

    const contra =
      (args.contraLedgerId ? await ctx.db.get(args.contraLedgerId) : null) ??
      (args.kind === "expense"
        ? (args.moneyName ? byName(args.moneyName) : null) ?? byName("Cash")
        : args.kind === "discount"
        ? byName("Discount Allowed") ?? inGroup("Sales Accounts")
        : args.kind === "goods_return"
        ? byName("Sales Return") ?? inGroup("Sales Accounts")
        : args.kind === "sale"
        ? inGroup("Sales Accounts")
        : args.kind === "purchase"
          ? inGroup("Purchase Accounts")
          : byName("Cash"));
    if (!contra) throw new Error("No account to post the other side of this to");

    let voucherId: Id<"vouchers">;
    if (args.kind === "goods_return" || args.kind === "discount") {
      if (!(args.amount! > 0)) throw new Error("A goods return needs an amount");
      voucherId = await ctx.runMutation(api.vouchers.createGoodsReturn, {
        date: args.date,
        partyLedgerId,
        returnLedgerId: contra._id,
        amount: args.amount!,
        refNo: args.refNo,
        narration: args.narration,
        typeName: args.kind === "discount" ? "Discount" : "Goods Return",
      });
    } else if (args.kind === "sale") {
      voucherId = await ctx.runMutation(api.vouchers.createSale, {
        date: args.date,
        partyLedgerId,
        salesLedgerId: contra._id,
        amount: args.amount,
        refNo: args.refNo,
        narration: args.narration,
      });
    } else if (args.kind === "purchase") {
      voucherId = await ctx.runMutation(api.vouchers.createPurchase, {
        date: args.date,
        partyLedgerId,
        purchaseLedgerId: contra._id,
        amount: args.amount,
        refNo: args.refNo,
        narration: args.narration,
      });
    } else if (args.kind === "expense") {
      if (!(args.amount! > 0)) throw new Error("An expense needs an amount");
      voucherId = await ctx.runMutation(api.vouchers.createPayment, {
        date: args.date,
        partyLedgerId,
        paidFromLedgerId: contra._id,
        amount: args.amount!,
        refNo: args.refNo,
        narration: args.narration,
      });
    } else if (args.kind === "receipt") {
      if (!(args.amount! > 0)) throw new Error("A receipt needs an amount");
      voucherId = await ctx.runMutation(api.vouchers.createReceipt, {
        date: args.date,
        partyLedgerId,
        receivedIntoLedgerId: contra._id,
        amount: args.amount!,
        refNo: args.refNo,
        narration: args.narration,
      });
    } else {
      if (!(args.amount! > 0)) throw new Error("A payment needs an amount");
      voucherId = await ctx.runMutation(api.vouchers.createPayment, {
        date: args.date,
        partyLedgerId,
        paidFromLedgerId: contra._id,
        amount: args.amount!,
        refNo: args.refNo,
        narration: args.narration,
      });
    }

    // Whatever was handed over gets its own voucher, for exactly the amount
    // handed over. Anything not covered stays owing, which is the whole point
    // of a running account.
    let settledBy: Id<"vouchers"> | undefined;
    const paid = args.paidNow ?? 0;
    if (paid > 0) {
      const into =
        (args.moneyLedgerId ? await ctx.db.get(args.moneyLedgerId) : null) ??
        (args.moneyName ? byName(args.moneyName) : null) ??
        byName("Cash");
      if (!into) throw new Error("No cash or bank account to put this through");

      if (args.kind === "sale") {
        settledBy = await ctx.runMutation(api.vouchers.createReceipt, {
          date: args.paidDate ?? args.date,
          partyLedgerId,
          receivedIntoLedgerId: into._id,
          amount: paid,
          refNo: args.refNo,
        });
      } else if (args.kind === "purchase") {
        settledBy = await ctx.runMutation(api.vouchers.createPayment, {
          date: args.paidDate ?? args.date,
          partyLedgerId,
          paidFromLedgerId: into._id,
          amount: paid,
          refNo: args.refNo,
        });
      }
    }

    // Move the photos onto the voucher and out of the inbox.
    const photo = await ctx.db.get(reading.inboxId);
    if (photo) {
      const pageRows = photo.groupId
        ? await ctx.db
            .query("inbox")
            .withIndex("by_group", (q) => q.eq("groupId", photo.groupId))
            .collect()
        : [photo];
      // The photo is the evidence for the entry — it goes onto the voucher,
      // which is what makes the printed packet possible later.
      await ctx.runMutation(api.vouchers.addAttachments, {
        id: voucherId,
        documents: pageRows.map((p) => ({
          storageId: p.storageId,
          kind: args.documentKind ?? "bill",
        })),
      });
      // The marks come with it. A mark that stopped at the queue would be no
      // use at all for telling this week's pile from the backlog afterwards,
      // which is the whole reason for putting one on.
      const marks = pageRows.flatMap((p) => p.tags ?? []);
      if (marks.length) {
        await ctx.db.patch(voucherId, { tags: [...new Set(marks)] });
      }
      for (const page of pageRows) await ctx.db.delete(page._id);
    }

    // The lines the slip actually carried, kept with the voucher. The ledger
    // needs one figure; stock and price history need these.
    const now = Date.now();
    const lines = Array.isArray(reading.draft?.items) ? reading.draft.items : [];
    let lineNo = 0;
    for (const line of lines) {
      const desc = String(line?.desc ?? "").trim();
      if (!desc) continue;
      lineNo += 1;
      const amount = typeof line?.amount === "number" ? line.amount : undefined;
      await ctx.db.insert("billLines", {
        voucherId,
        partyLedgerId,
        date: args.date,
        lineNo,
        desc,
        qty: line?.qty ? String(line.qty).trim() : undefined,
        rate: line?.rate ? String(line.rate).trim() : undefined,
        amount,
        source: "read",
        createdAt: now,
      });
    }

    if (args.goodsReturn && args.goodsReturn > 0) {
      lineNo += 1;
      await ctx.db.insert("billLines", {
        voucherId,
        partyLedgerId,
        date: args.date,
        lineNo,
        desc: "Goods return (GR)",
        amount: -args.goodsReturn,
        source: "read",
        createdAt: now,
      });
    }

    for (const fix of args.corrections ?? []) {
      if (!fix.wrong && !fix.right) continue;
      await ctx.db.insert("lessons", {
        kind: fix.field === "party" ? "alias" : "correction",
        field: fix.field,
        wrong: fix.wrong,
        right: fix.right,
        ledgerId: fix.field === "party" ? partyLedgerId : undefined,
        active: true,
        at: now,
      });
    }

    await ctx.db.delete(args.readingId);
    await record(ctx, "review.approve", "Approved a read bill into the books", {
      entity: "voucher",
      entityId: voucherId,
    });
    return { voucherId, settledBy, lines: lineNo };
  },
});

export const discard = mutation({
  args: { readingId: v.id("readings"), alsoPhoto: v.optional(v.boolean()) },
  handler: async (ctx, { readingId, alsoPhoto }) => {
    const reading = await ctx.db.get(readingId);
    if (!reading) return;
    if (alsoPhoto) {
      const photo = await ctx.db.get(reading.inboxId);
      if (photo) {
        await ctx.storage.delete(photo.storageId).catch(() => {});
        await ctx.db.delete(photo._id);
      }
    }
    await ctx.db.delete(readingId);
  },
});

/* ------------------------------------------------------------------ */
/* teaching                                                            */
/* ------------------------------------------------------------------ */

export const lessons = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("lessons").withIndex("by_at").order("desc").take(200);
    return rows;
  },
});

/** A sentence typed by hand — the shop teaching the reader something. */
export const teach = mutation({
  args: { note: v.string() },
  handler: async (ctx, { note }) => {
    const text = note.trim();
    if (!text) throw new Error("Nothing to teach");
    return await ctx.db.insert("lessons", {
      kind: "rule",
      note: text,
      active: true,
      at: Date.now(),
    });
  },
});

export const setLesson = mutation({
  args: { id: v.id("lessons"), active: v.boolean() },
  handler: async (ctx, { id, active }) => {
    await ctx.db.patch(id, { active });
  },
});

export const forget = mutation({
  args: { id: v.id("lessons") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

/* ------------------------------------------------------------------ */
/* what was on the bills                                               */
/* ------------------------------------------------------------------ */

/** The lines behind one voucher. */
export const linesFor = query({
  args: { voucherId: v.id("vouchers") },
  handler: async (ctx, { voucherId }) => {
    const rows = await ctx.db
      .query("billLines")
      .withIndex("by_voucher", (q) => q.eq("voucherId", voucherId))
      .collect();
    return rows.sort((a, b) => a.lineNo - b.lineNo);
  },
});

/**
 * Everything sold or bought under one description, newest first — the seed of
 * a stock or price-history report. Descriptions are as written on the slips,
 * so this groups on what was actually put on paper, not on a tidy catalogue
 * nobody keeps.
 */
export const goods = query({
  args: { search: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { search, limit }) => {
    const rows = await ctx.db.query("billLines").withIndex("by_date").order("desc").take(1500);
    const needle = (search ?? "").trim().toLowerCase();
    const matched = needle
      ? rows.filter((r) => r.desc.toLowerCase().includes(needle))
      : rows;

    const byDesc = new Map<string, { desc: string; times: number; value: number; last: number }>();
    for (const row of matched) {
      const key = row.desc.toLowerCase();
      const seen = byDesc.get(key) ?? { desc: row.desc, times: 0, value: 0, last: 0 };
      seen.times += 1;
      seen.value += row.amount ?? 0;
      seen.last = Math.max(seen.last, row.date);
      byDesc.set(key, seen);
    }

    return {
      lines: matched.slice(0, limit ?? 200),
      goods: [...byDesc.values()].sort((a, b) => b.times - a.times).slice(0, limit ?? 200),
    };
  },
});

/**
 * Joins two slips that turn out to be one bill.
 *
 * Pages get grouped on the phone at the moment of shooting, but a second sheet
 * is easy to miss — and a continuation page on its own has no name on it, only
 * a carried-forward total. This puts the photos under one group and drops both
 * readings, so the pair comes back through the queue as a single bill and is
 * read front to back with the name on page one.
 */
export const join = mutation({
  args: { readingIds: v.array(v.id("readings")) },
  handler: async (ctx, { readingIds }) => {
    if (readingIds.length < 2) throw new Error("Pick at least two slips to join");

    const readings = [];
    for (const id of readingIds) {
      const row = await ctx.db.get(id);
      if (row) readings.push(row);
    }
    if (readings.length < 2) throw new Error("Those slips are no longer in the queue");

    // Every page of every slip involved, oldest first — which is the order they
    // were photographed, and so the order they read.
    const photos: Doc<"inbox">[] = [];
    for (const reading of readings) {
      const photo = await ctx.db.get(reading.inboxId);
      if (!photo) continue;
      const pages = photo.groupId
        ? await ctx.db
            .query("inbox")
            .withIndex("by_group", (q) => q.eq("groupId", photo.groupId))
            .collect()
        : [photo];
      for (const page of pages) {
        if (!photos.some((p) => p._id === page._id)) photos.push(page);
      }
    }
    if (photos.length === 0) throw new Error("No photos left to join");
    photos.sort((a, b) => a.at - b.at);

    const groupId = photos[0].groupId ?? `j${Date.now().toString(36)}`;
    for (const page of photos) {
      if (page.groupId !== groupId) await ctx.db.patch(page._id, { groupId });
    }
    for (const reading of readings) await ctx.db.delete(reading._id);

    await record(ctx, "review.join", `Joined ${photos.length} pages into one bill`);
    return { groupId, pages: photos.length };
  },
});

/**
 * Splits a bill back into separate slips.
 *
 * The counterpart to `join`. Pages get grouped on the phone in a run, and a
 * run sometimes covers two customers — one tap too many and two bills are
 * welded together. This takes the group off, drops the reading, and each sheet
 * returns to the queue as its own bill to be read on its own.
 */
export const split = mutation({
  args: { readingId: v.id("readings") },
  handler: async (ctx, { readingId }) => {
    const reading = await ctx.db.get(readingId);
    if (!reading) throw new Error("That reading is gone");

    const photo = await ctx.db.get(reading.inboxId);
    if (!photo) throw new Error("Its photos are gone");

    const pages = photo.groupId
      ? await ctx.db
          .query("inbox")
          .withIndex("by_group", (q) => q.eq("groupId", photo.groupId))
          .collect()
      : [photo];

    for (const page of pages) {
      if (page.groupId) await ctx.db.patch(page._id, { groupId: undefined });
    }
    await ctx.db.delete(readingId);

    await record(ctx, "review.split", `Split a bill back into ${pages.length} slips`);
    return { pages: pages.length };
  },
});

/**
 * Sets a slip aside as doubtful.
 *
 * Not a rejection and not a skip: the reading, its photos and its draft all
 * stay, out of the working queue, until somebody can say what the slip
 * actually means. Nothing here is ever posted by accident.
 */
export const markDoubt = mutation({
  args: { readingId: v.id("readings"), note: v.optional(v.string()) },
  handler: async (ctx, { readingId, note }) => {
    const reading = await ctx.db.get(readingId);
    if (!reading) throw new Error("That reading is gone");
    await ctx.db.patch(readingId, { status: "doubt", doubtNote: note, at: Date.now() });
    await record(ctx, "review.doubt", note ? `Set aside: ${note}` : "Set aside as doubtful");
    return { ok: true };
  },
});

/** Puts a doubtful slip back in the working queue. */
export const clearDoubt = mutation({
  args: { readingId: v.id("readings") },
  handler: async (ctx, { readingId }) => {
    const reading = await ctx.db.get(readingId);
    if (!reading) throw new Error("That reading is gone");
    // The note stays. It says why somebody set this aside, which is worth
    // more once the slip is back in the working queue than it was while it sat
    // out of the way — and throwing it away made bringing a bill back lose the
    // only record of what was wrong with it.
    await ctx.db.patch(readingId, {
      status: reading.draft ? "ready" : "failed",
      at: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Files a loose slip onto a voucher that already exists.
 *
 * The second sheet of a bill is often photographed on its own, and if the
 * first sheet has already been approved there is nothing left to join it to —
 * it would sit in the queue for ever, nameless, or get posted a second time as
 * a bill of its own. This moves its photographs onto the voucher the pages
 * belong to and takes it out of the queue: consumed, not duplicated.
 */
export const attachTo = mutation({
  args: { readingId: v.id("readings"), voucherId: v.id("vouchers") },
  handler: async (ctx, { readingId, voucherId }) => {
    const reading = await ctx.db.get(readingId);
    if (!reading) throw new Error("That slip is no longer in the queue");
    const voucher = await ctx.db.get(voucherId);
    if (!voucher) throw new Error("That voucher no longer exists");

    const photo = await ctx.db.get(reading.inboxId);
    const pages = photo
      ? photo.groupId
        ? await ctx.db
            .query("inbox")
            .withIndex("by_group", (q) => q.eq("groupId", photo.groupId))
            .collect()
        : [photo]
      : [];

    if (pages.length) {
      await ctx.runMutation(api.vouchers.addAttachments, {
        id: voucherId,
        documents: pages.map((pg) => ({ storageId: pg.storageId, kind: "bill" as const })),
      });
      for (const pg of pages) await ctx.db.delete(pg._id);
    }
    await ctx.db.delete(readingId);

    const named = await describeVoucherLabel(ctx, voucherId);
    await record(ctx, "review.attach", `Filed ${pages.length} sheet(s) onto ${named}`, {
      entity: "voucher",
      entityId: voucherId,
    });
    return { pages: pages.length };
  },
});

async function describeVoucherLabel(ctx: any, voucherId: Id<"vouchers">) {
  const voucher = await ctx.db.get(voucherId);
  if (!voucher) return "a voucher";
  const type = await ctx.db.get(voucher.typeId);
  return `${type?.abbr ?? "VCH"}-${String(voucher.voucherNo).padStart(4, "0")}`;
}
