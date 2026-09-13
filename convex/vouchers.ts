import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { round2, fyOf } from "./lib/money";
import { record, money, day } from "./lib/history";
import { nextVoucherNo, voucherCounterName } from "./lib/numbering";
import { writeLines, clearLines } from "./lib/entries";
import { requirePin } from "./lib/pin";

const attachmentKind = v.union(
  v.literal("bill"),
  v.literal("challan"),
  v.literal("estimate"),
  v.literal("receipt"),
  v.literal("other")
);

const attachmentDoc = v.object({
  storageId: v.id("_storage"),
  previewStorageId: v.optional(v.id("_storage")),
  kind: attachmentKind,
});

const attachmentsArg = v.optional(v.array(attachmentDoc));

/** How a voucher is named in the history: "PUR-0035 · Mahadev Sales · 1,580.00". */
async function describe(
  ctx: MutationCtx,
  abbr: string,
  no: number,
  partyId: Id<"ledgers">,
  amount?: number
) {
  const party = await ctx.db.get(partyId);
  return `${abbr}-${String(no).padStart(4, "0")} · ${party?.name ?? "—"} · ${money(amount)}`;
}

/** The same, for a voucher already on the books. */
async function describeVoucher(ctx: MutationCtx, id: Id<"vouchers">) {
  const voucher = await ctx.db.get(id);
  if (!voucher) return String(id);
  const type = await ctx.db.get(voucher.typeId);
  return describe(ctx, type?.abbr ?? "VCH", voucher.voucherNo, voucher.partyLedgerId, voucher.amount);
}

async function typeByName(ctx: MutationCtx, name: string) {
  const type = await ctx.db
    .query("voucherTypes")
    .withIndex("by_name", (q) => q.eq("name", name))
    .unique();
  if (!type) throw new Error(`Voucher type "${name}" is not set up`);
  return type;
}

/**
 * Purchase: Dr Purchase Accounts, Cr the supplier — the supplier is a Sundry
 * Creditor, so buying from them grows a credit balance.
 *
 * With no amount the voucher is filed as pending: no lines, no effect on any
 * balance, and it sits in the pending queue until it is priced.
 */
export const createPurchase = mutation({
  args: {
    date: v.number(),
    partyLedgerId: v.id("ledgers"),
    purchaseLedgerId: v.id("ledgers"),
    amount: v.optional(v.number()),
    refNo: v.optional(v.string()),
    narration: v.optional(v.string()),
    attachments: attachmentsArg,
  },
  handler: async (ctx, args) => {
    const type = await typeByName(ctx, "Purchase");
    const fy = fyOf(args.date);
    const now = Date.now();
    const voucherNo = await nextVoucherNo(ctx, type, fy);
    const pending = args.amount === undefined || args.amount === null;

    const voucherId = await ctx.db.insert("vouchers", {
      typeId: type._id,
      voucherNo,
      fy,
      date: args.date,
      partyLedgerId: args.partyLedgerId,
      refNo: args.refNo,
      narration: args.narration,
      status: pending ? "pending" : "final",
      amount: pending ? undefined : round2(args.amount!),
      attachments: args.attachments ?? [],
      createdAt: now,
      updatedAt: now,
    });

    if (!pending) {
      await writeLines(ctx, voucherId, args.date, [
        { ledgerId: args.purchaseLedgerId, side: "Dr", amount: args.amount! },
        { ledgerId: args.partyLedgerId, side: "Cr", amount: args.amount! },
      ]);
    }
    await record(
      ctx,
      "voucher.create",
      `Purchase ${await describe(ctx, type.abbr, voucherNo, args.partyLedgerId, args.amount)} on ${day(args.date)}`,
      { entity: "voucher", entityId: voucherId }
    );
    return voucherId;
  },
});

/** Payment: Dr the supplier, Cr whatever it was paid from. */
export const createPayment = mutation({
  args: {
    date: v.number(),
    partyLedgerId: v.id("ledgers"),
    paidFromLedgerId: v.id("ledgers"),
    amount: v.number(),
    refNo: v.optional(v.string()),
    narration: v.optional(v.string()),
    attachments: attachmentsArg,
  },
  handler: async (ctx, args) => {
    if (!(args.amount > 0)) throw new Error("A payment needs an amount");
    const type = await typeByName(ctx, "Payment");
    const fy = fyOf(args.date);
    const now = Date.now();
    const voucherNo = await nextVoucherNo(ctx, type, fy);

    const voucherId = await ctx.db.insert("vouchers", {
      typeId: type._id,
      voucherNo,
      fy,
      date: args.date,
      partyLedgerId: args.partyLedgerId,
      refNo: args.refNo,
      narration: args.narration,
      status: "final",
      amount: round2(args.amount),
      attachments: args.attachments ?? [],
      createdAt: now,
      updatedAt: now,
    });

    await writeLines(ctx, voucherId, args.date, [
      { ledgerId: args.partyLedgerId, side: "Dr", amount: args.amount },
      { ledgerId: args.paidFromLedgerId, side: "Cr", amount: args.amount },
    ]);
    await record(
      ctx,
      "voucher.create",
      `Payment ${await describe(ctx, type.abbr, voucherNo, args.partyLedgerId, args.amount)} on ${day(args.date)}`,
      { entity: "voucher", entityId: voucherId }
    );
    return voucherId;
  },
});

/**
 * Sale on credit: Dr the customer, Cr Sales. The customer is a Sundry Debtor,
 * so selling to them grows a debit balance — the mirror of a purchase.
 *
 * Goods often leave the shop on a slip that lists quantities and no prices, so
 * like a purchase this can be filed with no amount at all: no lines, no effect
 * on any balance, and it waits in the pending queue until it is priced.
 */
export const createSale = mutation({
  args: {
    date: v.number(),
    partyLedgerId: v.id("ledgers"),
    salesLedgerId: v.id("ledgers"),
    amount: v.optional(v.number()),
    refNo: v.optional(v.string()),
    narration: v.optional(v.string()),
    attachments: attachmentsArg,
  },
  handler: async (ctx, args) => {
    if (args.amount !== undefined && !(args.amount > 0)) {
      throw new Error("Enter an amount above zero");
    }
    const pending = args.amount === undefined || args.amount === null;
    const type = await typeByName(ctx, "Sale");
    const fy = fyOf(args.date);
    const now = Date.now();
    const voucherNo = await nextVoucherNo(ctx, type, fy);

    const voucherId = await ctx.db.insert("vouchers", {
      typeId: type._id,
      voucherNo,
      fy,
      date: args.date,
      partyLedgerId: args.partyLedgerId,
      refNo: args.refNo,
      narration: args.narration,
      status: pending ? "pending" : "final",
      amount: pending ? undefined : round2(args.amount!),
      attachments: args.attachments ?? [],
      createdAt: now,
      updatedAt: now,
    });

    if (!pending) {
      await writeLines(ctx, voucherId, args.date, [
        { ledgerId: args.partyLedgerId, side: "Dr", amount: args.amount! },
        { ledgerId: args.salesLedgerId, side: "Cr", amount: args.amount! },
      ]);
    }
    await record(
      ctx,
      "voucher.create",
      `Sale ${await describe(ctx, type.abbr, voucherNo, args.partyLedgerId, args.amount)} on ${day(args.date)}`,
      { entity: "voucher", entityId: voucherId }
    );
    return voucherId;
  },
});

/** Receipt: Dr wherever the money landed, Cr the customer it came from. */
export const createReceipt = mutation({
  args: {
    date: v.number(),
    partyLedgerId: v.id("ledgers"),
    receivedIntoLedgerId: v.id("ledgers"),
    amount: v.number(),
    refNo: v.optional(v.string()),
    narration: v.optional(v.string()),
    attachments: attachmentsArg,
  },
  handler: async (ctx, args) => {
    if (!(args.amount > 0)) throw new Error("A receipt needs an amount");
    const type = await typeByName(ctx, "Receipt");
    const fy = fyOf(args.date);
    const now = Date.now();
    const voucherNo = await nextVoucherNo(ctx, type, fy);

    const voucherId = await ctx.db.insert("vouchers", {
      typeId: type._id,
      voucherNo,
      fy,
      date: args.date,
      partyLedgerId: args.partyLedgerId,
      refNo: args.refNo,
      narration: args.narration,
      status: "final",
      amount: round2(args.amount),
      attachments: args.attachments ?? [],
      createdAt: now,
      updatedAt: now,
    });

    await writeLines(ctx, voucherId, args.date, [
      { ledgerId: args.receivedIntoLedgerId, side: "Dr", amount: args.amount },
      { ledgerId: args.partyLedgerId, side: "Cr", amount: args.amount },
    ]);
    await record(
      ctx,
      "voucher.create",
      `Receipt ${await describe(ctx, type.abbr, voucherNo, args.partyLedgerId, args.amount)} on ${day(args.date)}`,
      { entity: "voucher", entityId: voucherId }
    );
    return voucherId;
  },
});

/**
 * Which ledger sits on which side, by voucher type. The party is a creditor on
 * a purchase and a debtor on a sale, so the two sides swap with the type — and
 * an edit has to know that to rewrite the lines correctly.
 */
const SIDES: Record<string, { party: "Dr" | "Cr"; account: "Dr" | "Cr" }> = {
  Purchase: { party: "Cr", account: "Dr" },
  Payment: { party: "Dr", account: "Cr" },
  Sale: { party: "Dr", account: "Cr" },
  Receipt: { party: "Cr", account: "Dr" },
  // Goods handed back. On the sales side the customer owes less, so the party
  // is credited and the value lands in Sales Return — kept as its own account
  // rather than netted into Sales, or a month of returns becomes invisible.
  "Goods Return": { party: "Cr", account: "Dr" },
  "Purchase Return": { party: "Dr", account: "Cr" },
  // Money knocked off a bill. Like a return it credits the customer, but the
  // goods never came back — so it lands in its own account and never pretends
  // to be stock.
  Discount: { party: "Cr", account: "Dr" },
  // Money spent on the shop itself — fare, cartage, tea, repairs. The expense
  // account takes the debit and the cash or bank it came out of takes the
  // credit; there is no customer or supplier involved.
  Expense: { party: "Dr", account: "Cr" },
};

/**
 * Fill in the amount on a bill filed without one. The sides come from the
 * voucher's own type — pricing a sale the way a purchase is priced would post
 * it backwards and grow the debt instead of the debtor.
 */
export const price = mutation({
  args: {
    id: v.id("vouchers"),
    amount: v.number(),
    accountLedgerId: v.id("ledgers"),
    refNo: v.optional(v.string()),
  },
  handler: async (ctx, { id, amount, accountLedgerId, refNo }) => {
    if (!(amount > 0)) throw new Error("Enter an amount above zero");
    const voucher = await ctx.db.get(id);
    if (!voucher) throw new Error("Voucher not found");
    const type = await ctx.db.get(voucher.typeId);
    const sides = SIDES[type?.name ?? ""];
    if (!sides) throw new Error(`Cannot price a ${type?.name ?? "unknown"} voucher`);

    await clearLines(ctx, id);
    await writeLines(ctx, id, voucher.date, [
      { ledgerId: voucher.partyLedgerId, side: sides.party, amount },
      { ledgerId: accountLedgerId, side: sides.account, amount },
    ]);
    await ctx.db.patch(id, {
      amount: round2(amount),
      status: "final",
      ...(refNo ? { refNo } : {}),
      updatedAt: Date.now(),
    });
    await record(ctx, "voucher.price", `Priced ${await describeVoucher(ctx, id)}`, {
      entity: "voucher",
      entityId: id,
      detail: { amount: round2(amount), refNo },
    });
  },
});

/** One voucher with everything an edit needs: both ledgers, and its photos. */
export const detail = query({
  args: { id: v.id("vouchers") },
  handler: async (ctx, { id }) => {
    const voucher = await ctx.db.get(id);
    if (!voucher) return null;
    const type = await ctx.db.get(voucher.typeId);
    const lines = await ctx.db
      .query("voucherEntries")
      .withIndex("by_voucher", (q) => q.eq("voucherId", id))
      .collect();
    const other = lines.find((l) => l.ledgerId !== voucher.partyLedgerId);

    return {
      _id: voucher._id,
      kind: (type?.name ?? "Purchase").toLowerCase(),
      vchLabel: `${type?.abbr ?? "VCH"}-${String(voucher.voucherNo).padStart(4, "0")}`,
      date: voucher.date,
      partyLedgerId: voucher.partyLedgerId,
      // The name as well as the id: the bill builder files a voucher against
      // the party by name, the way a bill written at the counter does.
      partyName: (await ctx.db.get(voucher.partyLedgerId))?.name ?? "",
      accountLedgerId: other?.ledgerId ?? null,
      amount: voucher.amount,
      refNo: voucher.refNo ?? "",
      narration: voucher.narration ?? "",
      status: voucher.status,
      attachments: await Promise.all(
        voucher.attachments.map(async (doc) => {
          const storageId = typeof doc === "string" ? doc : doc.storageId;
          const meta = await ctx.db.system.get(storageId);
          const preview = typeof doc === "string" ? undefined : doc.previewStorageId;
          return {
            storageId,
            kind: typeof doc === "string" ? "bill" : doc.kind,
            contentType: meta?.contentType ?? null,
            url: await ctx.storage.getUrl(storageId),
            previewUrl: preview ? await ctx.storage.getUrl(preview) : null,
          };
        })
      ),
    };
  },
});

/**
 * Rewrites a voucher in place. The number and the type never change — Tally
 * would not renumber a corrected entry either — but both ledgers, the amount,
 * the date and the wording can all be put right, and the Dr/Cr lines are
 * written again from scratch so no balance is left describing the old version.
 *
 * Clearing the amount on a purchase files it back into the pending queue.
 */
export const edit = mutation({
  args: {
    id: v.id("vouchers"),
    date: v.number(),
    partyLedgerId: v.id("ledgers"),
    accountLedgerId: v.id("ledgers"),
    amount: v.optional(v.number()),
    refNo: v.optional(v.string()),
    narration: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const voucher = await ctx.db.get(args.id);
    if (!voucher) throw new Error("Voucher not found");
    const type = await ctx.db.get(voucher.typeId);
    const sides = SIDES[type?.name ?? ""];
    if (!sides) throw new Error(`Cannot edit a ${type?.name ?? "unknown"} voucher`);

    /**
     * This form writes exactly two lines, so it must not be handed a voucher
     * that has more than two. A sale that took part of its money at the
     * counter carries three — the customer, the drawer and Sales — and
     * rewriting it as a pair would move the cash silently back onto the
     * customer and out of the drawer, still balanced, still wrong.
     */
    const existingLines = await ctx.db
      .query("voucherEntries")
      .withIndex("by_voucher", (q) => q.eq("voucherId", args.id))
      .collect();
    if (existingLines.length > 2) {
      throw new Error(
        "This voucher has more than two lines — open the bill it came from and edit it there."
      );
    }

    const pending = args.amount === undefined || args.amount === null;
    if (pending && type?.name !== "Purchase" && type?.name !== "Sale") {
      throw new Error(`A ${type?.name?.toLowerCase()} needs an amount`);
    }
    if (!pending && !(args.amount! > 0)) throw new Error("Enter an amount above zero");

    await clearLines(ctx, args.id);
    if (!pending) {
      await writeLines(ctx, args.id, args.date, [
        { ledgerId: args.partyLedgerId, side: sides.party, amount: args.amount! },
        { ledgerId: args.accountLedgerId, side: sides.account, amount: args.amount! },
      ]);
    }

    await ctx.db.patch(args.id, {
      date: args.date,
      partyLedgerId: args.partyLedgerId,
      refNo: args.refNo,
      narration: args.narration,
      amount: pending ? undefined : round2(args.amount!),
      status: pending ? "pending" : "final",
      updatedAt: Date.now(),
    });

    // Only what actually moved, so the history reads as a list of changes
    // rather than a dump of every field.
    const changes: string[] = [];
    if (voucher.date !== args.date) changes.push(`date ${day(voucher.date)} → ${day(args.date)}`);
    if (voucher.amount !== (pending ? undefined : round2(args.amount!)))
      changes.push(`amount ${money(voucher.amount)} → ${pending ? "—" : money(round2(args.amount!))}`);
    if (voucher.partyLedgerId !== args.partyLedgerId) {
      const before = await ctx.db.get(voucher.partyLedgerId);
      const after = await ctx.db.get(args.partyLedgerId);
      changes.push(`party ${before?.name ?? "—"} → ${after?.name ?? "—"}`);
    }
    if ((voucher.refNo ?? "") !== (args.refNo ?? ""))
      changes.push(`ref ${voucher.refNo || "—"} → ${args.refNo || "—"}`);
    if ((voucher.narration ?? "") !== (args.narration ?? ""))
      changes.push(`particulars ${voucher.narration || "—"} → ${args.narration || "—"}`);

    await record(
      ctx,
      "voucher.edit",
      `Edited ${await describeVoucher(ctx, args.id)}${changes.length ? `: ${changes.join(", ")}` : ""}`,
      { entity: "voucher", entityId: args.id, detail: changes }
    );
  },
});

export const update = mutation({
  args: {
    id: v.id("vouchers"),
    date: v.optional(v.number()),
    refNo: v.optional(v.string()),
    narration: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });
    if (patch.date !== undefined) {
      const lines = await ctx.db
        .query("voucherEntries")
        .withIndex("by_voucher", (q) => q.eq("voucherId", id))
        .collect();
      for (const line of lines) await ctx.db.patch(line._id, { date: patch.date });
    }
    await record(ctx, "voucher.update", `Updated ${await describeVoucher(ctx, id)}`, {
      entity: "voucher",
      entityId: id,
      detail: patch,
    });
  },
});

/**
 * Refuses anything that is still a PDF.
 *
 * Rendering happens in the browser on the way in, but that is a convention a
 * new code path can forget — and a PDF that slips through is invisible until
 * somebody opens a voucher months later and finds a viewer that cannot show
 * it. Cheaper to make it impossible than to sweep up again.
 */
async function refusePdfs(ctx: MutationCtx, storageIds: Id<"_storage">[]) {
  for (const storageId of storageIds) {
    const meta = await ctx.db.system.get(storageId);
    if (meta?.contentType === "application/pdf") {
      throw new Error(
        "PDFs are not stored — render the pages to images before attaching them"
      );
    }
  }
}

export const addAttachments = mutation({
  args: {
    id: v.id("vouchers"),
    documents: v.array(attachmentDoc),
  },
  handler: async (ctx, { id, documents }) => {
    await refusePdfs(ctx, documents.map((d) => d.storageId));
    const voucher = await ctx.db.get(id);
    if (!voucher) throw new Error("Voucher not found");
    await ctx.db.patch(id, {
      attachments: [...voucher.attachments, ...documents],
      updatedAt: Date.now(),
    });
    await record(
      ctx,
      "attachment.add",
      `Attached ${documents.map((d) => d.kind).join(", ")} to ${await describeVoucher(ctx, id)}`,
      { entity: "voucher", entityId: id }
    );
  },
});

/** Says what a document is — the challan, the bill, a receipt. */
export const setAttachmentKind = mutation({
  args: { id: v.id("vouchers"), storageId: v.id("_storage"), kind: attachmentKind },
  handler: async (ctx, { id, storageId, kind }) => {
    const voucher = await ctx.db.get(id);
    if (!voucher) throw new Error("Voucher not found");
    await ctx.db.patch(id, {
      attachments: voucher.attachments.map((a) =>
        typeof a !== "string" && a.storageId === storageId ? { ...a, kind } : a
      ),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Deleting a voucher moves it to the trash rather than destroying it. The
 * books stop counting it immediately — its lines are gone — but the voucher,
 * its lines and its bill photos are kept whole until someone purges them, so a
 * mistake costs one click to undo.
 */
/** Attaches a rendered picture to a document that cannot be shown directly. */
export const setPreview = mutation({
  args: {
    id: v.id("vouchers"),
    storageId: v.id("_storage"),
    previewStorageId: v.id("_storage"),
  },
  handler: async (ctx, { id, storageId, previewStorageId }) => {
    const voucher = await ctx.db.get(id);
    if (!voucher) throw new Error("Voucher not found");
    await ctx.db.patch(id, {
      attachments: voucher.attachments.map((a) =>
        typeof a !== "string" && a.storageId === storageId
          ? { ...a, previewStorageId }
          : a
      ),
      updatedAt: Date.now(),
    });
    await record(ctx, "attachment.preview", `Preview rendered for ${await describeVoucher(ctx, id)}`, {
      entity: "voucher",
      entityId: id,
    });
  },
});

/**
 * Swaps one document for another — a straightened, cropped, smaller copy of
 * the same photo — keeping its type and its place in the order, and destroying
 * the file it replaces.
 */
export const replaceAttachment = mutation({
  args: {
    id: v.id("vouchers"),
    storageId: v.id("_storage"),
    newStorageId: v.id("_storage"),
  },
  handler: async (ctx, { id, storageId, newStorageId }) => {
    const voucher = await ctx.db.get(id);
    if (!voucher) throw new Error("Voucher not found");
    await ctx.db.patch(id, {
      attachments: voucher.attachments.map((a) => {
        const current = typeof a === "string" ? a : a.storageId;
        if (current !== storageId) return a;
        return { storageId: newStorageId, kind: typeof a === "string" ? "bill" : a.kind };
      }),
      updatedAt: Date.now(),
    });
    await record(ctx, "attachment.replace", `Document replaced on ${await describeVoucher(ctx, id)}`, {
      entity: "voucher",
      entityId: id,
    });
    await ctx.storage.delete(storageId).catch(() => {});
  },
});

/** Detaches one photo from a voucher and destroys the file behind it. */
export const removeAttachment = mutation({
  args: { id: v.id("vouchers"), storageId: v.id("_storage") },
  handler: async (ctx, { id, storageId }) => {
    const voucher = await ctx.db.get(id);
    if (!voucher) throw new Error("Voucher not found");
    await ctx.db.patch(id, {
      attachments: voucher.attachments.filter((a) =>
        typeof a === "string" ? a !== storageId : a.storageId !== storageId
      ),
      updatedAt: Date.now(),
    });
    await ctx.storage.delete(storageId).catch(() => {});
  },
});

export const remove = mutation({
  args: { id: v.id("vouchers") },
  handler: async (ctx, { id }) => {
    const voucher = await ctx.db.get(id);
    if (!voucher) return null;

    const lines = await ctx.db
      .query("voucherEntries")
      .withIndex("by_voucher", (q) => q.eq("voucherId", id))
      .collect();

    const { _id, _creationTime, ...fields } = voucher;
    const trashId = await ctx.db.insert("trash", {
      ...fields,
      entries: lines.map((l) => ({
        ledgerId: l.ledgerId,
        side: l.side,
        amount: l.amount,
      })),
      deletedAt: Date.now(),
    });

    const named = await describeVoucher(ctx, id);
    for (const line of lines) await ctx.db.delete(line._id);
    await ctx.db.delete(id);
    await record(ctx, "voucher.delete", `Deleted ${named} → Trash`, {
      entity: "voucher",
      entityId: id,
    });
    return trashId;
  },
});

/**
 * Changes what kind of voucher this is, and rewrites its sides to match.
 *
 * A sale booked against a supplier is not a small mistake — it makes them a
 * debtor, so the bills and the payments both push the balance the same way and
 * the account runs away from you. Editing cannot fix it: a voucher's type
 * decides which side the party sits on, so the type itself has to change, and
 * the voucher takes a new number in its new series.
 */
export const retype = mutation({
  args: {
    id: v.id("vouchers"),
    to: v.union(
      v.literal("Purchase"),
      v.literal("Payment"),
      v.literal("Sale"),
      v.literal("Receipt")
    ),
    accountLedgerId: v.optional(v.id("ledgers")),
  },
  handler: async (ctx, { id, to, accountLedgerId }) => {
    const voucher = await ctx.db.get(id);
    if (!voucher) throw new Error("Voucher not found");

    const was = await ctx.db.get(voucher.typeId);
    if (was?.name === to) return { changed: false };

    const type = await ctx.db
      .query("voucherTypes")
      .withIndex("by_name", (q) => q.eq("name", to))
      .unique();
    if (!type) throw new Error(`There is no ${to} voucher type`);

    const sides = SIDES[to];
    // The other side of the entry: whatever was named, else the account the
    // old voucher used, which is right whenever only the direction was wrong.
    const existing = await ctx.db
      .query("voucherEntries")
      .withIndex("by_voucher", (q) => q.eq("voucherId", id))
      .collect();
    const contra =
      accountLedgerId ??
      existing.find((l) => l.ledgerId !== voucher.partyLedgerId)?.ledgerId;
    if (!contra) throw new Error("Nothing to post the other side against");
    // Same reason as `edit`: retyping rewrites the voucher as a pair, and a
    // voucher that carries a counter payment is three lines, not two.
    if (existing.length > 2) {
      throw new Error(
        "This voucher has more than two lines — open the bill it came from and change it there."
      );
    }

    await clearLines(ctx, id);
    if (voucher.status === "final" && voucher.amount) {
      await writeLines(ctx, id, voucher.date, [
        { ledgerId: voucher.partyLedgerId, side: sides.party, amount: voucher.amount },
        { ledgerId: contra, side: sides.account, amount: voucher.amount },
      ]);
    }

    await ctx.db.patch(id, {
      typeId: type._id,
      voucherNo: await nextVoucherNo(ctx, type, voucher.fy),
      updatedAt: Date.now(),
    });

    const named = await describeVoucher(ctx, id);
    await record(ctx, "voucher.retype", `${was?.name ?? "Voucher"} → ${to}: ${named}`, {
      entity: "voucher",
      entityId: id,
    });
    return { changed: true, from: was?.name, to };
  },
});

/** Goods a customer handed back: their account owes that much less. */
export const createGoodsReturn = mutation({
  args: {
    date: v.number(),
    partyLedgerId: v.id("ledgers"),
    returnLedgerId: v.id("ledgers"),
    amount: v.number(),
    refNo: v.optional(v.string()),
    narration: v.optional(v.string()),
    attachments: attachmentsArg,
    typeName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"vouchers">> => {
    if (!(args.amount > 0)) throw new Error("A goods return needs an amount");
    const type = await typeByName(ctx, args.typeName ?? "Goods Return");
    const fy = fyOf(args.date);
    const now = Date.now();
    const voucherNo = await nextVoucherNo(ctx, type, fy);

    const voucherId = await ctx.db.insert("vouchers", {
      typeId: type._id,
      voucherNo,
      fy,
      date: args.date,
      partyLedgerId: args.partyLedgerId,
      refNo: args.refNo,
      narration: args.narration,
      status: "final",
      amount: round2(args.amount),
      attachments: args.attachments ?? [],
      createdAt: now,
      updatedAt: now,
    });

    await writeLines(ctx, voucherId, args.date, [
      { ledgerId: args.returnLedgerId, side: "Dr", amount: args.amount },
      { ledgerId: args.partyLedgerId, side: "Cr", amount: args.amount },
    ]);

    const named = await describe(ctx, type.abbr, voucherNo, args.partyLedgerId, args.amount);
    await record(ctx, "voucher.create", `${type.name} ${named}`, {
      entity: "voucher",
      entityId: voucherId,
    });
    return voucherId;
  },
});

/** Sets up the return voucher types and the account they post into. */
export const setUpReturns = mutation({
  args: { pin: v.string() },
  handler: async (ctx, { pin }) => {
    requirePin(pin);
    const made: string[] = [];
    // The slips say GR, so the vouchers say GR — a label nobody has to
    // translate back into the shop's own shorthand.
    const gr = await ctx.db
      .query("voucherTypes")
      .withIndex("by_name", (q) => q.eq("name", "Goods Return"))
      .unique();
    if (gr && gr.abbr !== "GR") {
      await ctx.db.patch(gr._id, { abbr: "GR" });
      made.push("Goods Return renamed to GR");
    }
    for (const t of [
      { name: "Goods Return", abbr: "GR", sort: 5 },
      { name: "Discount", abbr: "DIS", sort: 7 },
      { name: "Expense", abbr: "EXP", sort: 8 },
      { name: "Purchase Return", abbr: "PRN", sort: 6 },
    ]) {
      const has = await ctx.db
        .query("voucherTypes")
        .withIndex("by_name", (q) => q.eq("name", t.name))
        .unique();
      if (!has) {
        await ctx.db.insert("voucherTypes", t);
        made.push(t.name);
      }
    }

    let groups = await ctx.db.query("groups").collect();
    if (!groups.some((g) => g.name === "Indirect Expenses")) {
      await ctx.db.insert("groups", {
        name: "Indirect Expenses",
        nature: "expense",
        normalSide: "Dr",
        sort: 7,
      });
      made.push("Indirect Expenses");
      groups = await ctx.db.query("groups").collect();
    }
    const ledgers = await ctx.db.query("ledgers").collect();
    const now = Date.now();
    for (const [name, groupName] of [
      ["Sales Return", "Sales Accounts"],
      ["Discount Allowed", "Sales Accounts"],
      ["Fare & Cartage", "Indirect Expenses"],
      ["Shop Expenses", "Indirect Expenses"],
      ["Purchase Return", "Purchase Accounts"],
      // The other half of a settlement discount: what a supplier knocked off
      // when the shop paid them. Credit side, like a purchase return.
      ["Discount Received", "Purchase Accounts"],
    ] as const) {
      if (ledgers.some((l) => l.name === name)) continue;
      const group = groups.find((g) => g.name === groupName);
      if (!group) continue;
      await ctx.db.insert("ledgers", {
        name,
        groupId: group._id,
        openingBalance: 0,
        openingSide: groupName === "Purchase Accounts" ? "Cr" : "Dr",
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

/**
 * Puts a voucher series back in order after its abbreviation changed.
 *
 * Numbering is counted per abbreviation, so renaming a type mid-year starts a
 * fresh count under the new name and two vouchers end up wearing the same
 * number. This walks the type's vouchers in date order, renumbers them, and
 * leaves the counter where the next one should carry on.
 */
export const renumberSeries = mutation({
  args: { pin: v.string(), typeName: v.string(), fy: v.string()},
  handler: async (ctx, { pin, typeName, fy }) => {
    requirePin(pin);
    const type = await ctx.db
      .query("voucherTypes")
      .withIndex("by_name", (q) => q.eq("name", typeName))
      .unique();
    if (!type) throw new Error(`No voucher type called ${typeName}`);

    const rows = (
      await ctx.db
        .query("vouchers")
        .withIndex("by_type_fy", (q) => q.eq("typeId", type._id).eq("fy", fy))
        .collect()
    ).sort((a, b) => a.date - b.date || a.createdAt - b.createdAt);

    let no = 0;
    for (const row of rows) {
      no += 1;
      if (row.voucherNo !== no) await ctx.db.patch(row._id, { voucherNo: no });
    }

    const name = voucherCounterName(type.abbr, fy);
    const counter = await ctx.db
      .query("counters")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (counter) await ctx.db.patch(counter._id, { value: no });
    else await ctx.db.insert("counters", { name, value: no });

    return { renumbered: rows.length, nextIs: no + 1 };
  },
});
