import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

type Attachment =
  | Id<"_storage">
  | { storageId: Id<"_storage">; kind: string; previewStorageId?: Id<"_storage"> };

/** The oldest vouchers hold a bare storage id where later ones hold a record. */
const flatten = (docs: Attachment[]) =>
  docs.map((d) =>
    typeof d === "string"
      ? { storageId: d, kind: "bill", previewStorageId: undefined }
      : d
  );

const vchLabel = (abbr: string, no: number) => `${abbr}-${String(no).padStart(4, "0")}`;

type Source = {
  storageId: Id<"_storage">;
  previewStorageId?: Id<"_storage">;
  kind: string;
  filed: "voucher" | "inbox" | "trash";
  voucherId: Id<"vouchers"> | null;
  partyLedgerId: Id<"ledgers"> | null;
  vchLabel: string | null;
  party: string | null;
  date: number | null;
  amount: number | null;
  refNo: string;
  note: string;
};

/**
 * Every photograph the shop has taken, in the order the camera took them.
 *
 * The clock is the file's own creation time in storage, not the voucher's
 * date. A bill dated the 3rd can be photographed on the 9th, and what this
 * page is for is the order the camera saw them: a run of taps on the phone
 * comes back as a run down the page, whatever dates were typed against them
 * afterwards. It is the one view where a bill shot twice sits next to itself.
 *
 * Three places hold photos and all three are here — a photo filed against a
 * voucher, one still waiting in the phone's inbox, and one on a voucher that
 * has since been deleted, which is still a picture somebody took and is
 * marked as such rather than quietly dropped.
 */
export const taken = query({
  args: {},
  handler: async (ctx) => {
    const [vouchers, types, ledgers, inbox, trash] = await Promise.all([
      ctx.db.query("vouchers").collect(),
      ctx.db.query("voucherTypes").collect(),
      ctx.db.query("ledgers").collect(),
      ctx.db.query("inbox").collect(),
      ctx.db.query("trash").collect(),
    ]);
    const typeById = new Map(types.map((t) => [t._id, t]));
    const nameOf = new Map(ledgers.map((l) => [l._id, l.name]));

    const sources: Source[] = [];

    for (const vch of vouchers) {
      for (const doc of flatten(vch.attachments)) {
        sources.push({
          ...doc,
          filed: "voucher",
          voucherId: vch._id,
          partyLedgerId: vch.partyLedgerId,
          vchLabel: vchLabel(typeById.get(vch.typeId)?.abbr ?? "VCH", vch.voucherNo),
          party: nameOf.get(vch.partyLedgerId) ?? "—",
          date: vch.date,
          amount: vch.amount ?? null,
          refNo: vch.refNo ?? "",
          // A pending voucher says so here, because on this page an unpriced
          // bill and a priced one look exactly alike.
          note: vch.status === "pending" ? "awaiting an amount" : "",
        });
      }
    }

    for (const row of trash) {
      for (const doc of flatten(row.attachments)) {
        sources.push({
          ...doc,
          filed: "trash",
          voucherId: null,
          partyLedgerId: row.partyLedgerId,
          vchLabel: vchLabel(typeById.get(row.typeId)?.abbr ?? "VCH", row.voucherNo),
          party: nameOf.get(row.partyLedgerId) ?? "—",
          date: row.date,
          amount: row.amount ?? null,
          refNo: row.refNo ?? "",
          note: "deleted",
        });
      }
    }

    for (const row of inbox) {
      sources.push({
        storageId: row.storageId,
        previewStorageId: undefined,
        kind: "bill",
        filed: "inbox",
        voucherId: null,
        partyLedgerId: null,
        vchLabel: null,
        party: null,
        date: null,
        amount: null,
        refNo: "",
        note: row.note ?? "",
      });
    }

    const shots = await Promise.all(
      sources.map(async (src) => {
        // Convex storage URLs carry no file extension, so the store itself is
        // the only honest source for what a file is and when it landed.
        const meta = await ctx.db.system.get(src.storageId);
        if (!meta) return null;                 // the file is gone; nothing to show
        const isPdf = (meta.contentType ?? "").includes("pdf");
        // A PDF is shown through the picture rendered for it, where there is
        // one; without one there is nothing to put on a page of photographs.
        const shown = isPdf ? src.previewStorageId : src.storageId;
        if (!shown) return null;

        const { previewStorageId, ...rest } = src;
        return {
          ...rest,
          at: meta._creationTime,
          size: meta.size,
          contentType: meta.contentType ?? null,
          isPdf,
          url: await ctx.storage.getUrl(shown),
          fileUrl: await ctx.storage.getUrl(src.storageId),
        };
      })
    );

    return shots
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => a.at - b.at);
  },
});
