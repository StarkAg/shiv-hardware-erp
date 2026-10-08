import { mutation } from "./lib/guarded";
import { v } from "convex/values";
import { fyOf, round2 } from "./lib/money";
import type { Id } from "./_generated/dataModel";
import { requirePin } from "./lib/pin";

const D = (m: number, d: number) => Date.UTC(2026, m - 1, d);
const OPENING_AS_OF = D(8, 1);

const GROUPS = [
  { name: "Sundry Creditors", nature: "liability", normalSide: "Cr", sort: 1 },
  { name: "Sundry Debtors", nature: "asset", normalSide: "Dr", sort: 2 },
  { name: "Purchase Accounts", nature: "expense", normalSide: "Dr", sort: 3 },
  { name: "Sales Accounts", nature: "income", normalSide: "Cr", sort: 4 },
  { name: "Cash-in-Hand", nature: "asset", normalSide: "Dr", sort: 5 },
  { name: "Bank Accounts", nature: "asset", normalSide: "Dr", sort: 6 },
] as const;

const TYPES = [
  { name: "Purchase", abbr: "PUR", sort: 1 },
  { name: "Payment", abbr: "PAY", sort: 2 },
  { name: "Sale", abbr: "SAL", sort: 3 },
  { name: "Receipt", abbr: "RCT", sort: 4 },
];

const SUPPLIERS = [
  { name: "M/s SRT", place: "Ratu, Ranchi", opening: 865934.16,
    notes: "Statement received only to 24-Aug-26 — ask for 25–31 Aug." },
  { name: "M/s Mahadev Sales", place: "Upper Bazar, Ranchi", opening: 216880 },
  { name: "M/s Orpet Laminates", place: "Bara Talab, Ranchi", opening: 69460,
    notes: "Bills to account 'Shiv Hardware Ramgarh 1' — check for a Ramgarh 2." },
  { name: "M/s Rajat Hardware Delhi", place: "Delhi", opening: 0,
    notes: "Non-GST. Challan carries no bill number — no input credit." },
  { name: "M/s Modi Hardware", place: "—", opening: 300000,
    notes: "Carried from the old sheet — no ledger or invoice seen yet." },
];

const PAY_LEDGERS = [
  { name: "Cash", group: "Cash-in-Hand" },
  { name: "Bank", group: "Bank Accounts" },
];

type Txn =
  | ["pur", number, string, string, number]
  | ["pay", number, string, string, number, string];

const BOOK: Record<string, Txn[]> = {
  "M/s SRT": [
    ["pur", D(8, 5), "2758", "SALES A/C", 56535.0],
    ["pay", D(8, 5), "1417", "Against account", 60000, "Bank"],
    ["pay", D(8, 5), "1418", "Against account", 97000, "Bank"],
    ["pur", D(8, 6), "2776", "SALES A/C", 89400.0],
    ["pur", D(8, 10), "2853", "SALES A/C", 39744.58],
    ["pay", D(8, 10), "1473", "Against account", 43000, "Bank"],
    ["pay", D(8, 12), "1492", "Against account", 49000, "Bank"],
    ["pur", D(8, 13), "2904", "SALES A/C", 42784.0],
    ["pur", D(8, 16), "2959", "SALES A/C", 87748.8],
    ["pay", D(8, 16), "1517", "Against account", 90000, "Cash"],
    ["pur", D(8, 19), "3031", "SALES A/C", 56360.4],
    ["pay", D(8, 19), "1542", "Against account", 50000, "Cash"],
    ["pur", D(8, 20), "3060", "SALES A/C", 57384.0],
    ["pay", D(8, 20), "1558", "Against account", 50000, "Cash"],
    ["pur", D(8, 24), "3146", "SALES A/C", 33600.0],
    ["pay", D(8, 24), "1585", "Against account", 30000, "Cash"],
  ],
  "M/s Mahadev Sales": [
    ["pur", D(8, 1), "MS/1794/26-27", "SALES @ 18%", 7110],
    ["pur", D(8, 3), "MS/1819/26-27", "SALES @ 18%", 2370],
    ["pur", D(8, 5), "MS/1852/26-27", "SALES @ 18%", 4740],
    ["pur", D(8, 6), "MS/1866/26-27", "SALES @ 18%", 11060],
    ["pur", D(8, 8), "MS/1904/26-27", "SALES @ 18%", 1580],
    ["pay", D(8, 8), "659", "Against account", 98000, "Bank"],
    ["pur", D(8, 13), "MS/1978/26-27", "SALES @ 18%", 5530],
    ["pur", D(8, 15), "MS/1999/26-27", "SALES @ 18%", 13160],
    ["pur", D(8, 17), "MS/2014/26-27", "SALES @ 18%", 7990],
    ["pur", D(8, 26), "MS/2147/26-27", "SALES @ 18%", 1580],
    ["pur", D(8, 29), "MS/2169/26-27", "SALES @ 18%", 1580],
    ["pur", D(8, 29), "MS/2173/26-27", "SALES @ 18%", 12640],
  ],
  "M/s Orpet Laminates": [
    ["pur", D(8, 1), "1977/26-27", "TAX INVOICE", 15600],
    ["pur", D(8, 3), "1990/26-27", "TAX INVOICE", 7900],
    ["pur", D(8, 8), "2095/26-27", "TAX INVOICE", 5400],
    ["pur", D(8, 10), "2121/26-27", "TAX INVOICE", 11700],
    ["pur", D(8, 12), "2173/26-27", "TAX INVOICE", 2700],
    ["pur", D(8, 17), "2218/26-27", "TAX INVOICE", 12020],
    ["pur", D(8, 20), "2290/26-27", "TAX INVOICE", 13500],
    ["pay", D(8, 21), "726", "Against account", 45000, "Bank"],
    ["pur", D(8, 22), "2328/26-27", "TAX INVOICE", 3600],
    ["pur", D(8, 24), "2354/26-27", "TAX INVOICE", 7200],
  ],
  "M/s Rajat Hardware Delhi": [
    ["pur", D(8, 22), "", "Acer hinges / handles / aldrops — challan, delivered 3-Sep", 204702],
    ["pur", D(8, 22), "", "Packing, cartage & postage", 980],
    ["pur", D(8, 22), "", "Booking + NGT", 300],
  ],
  "M/s Modi Hardware": [],
};

export const run = mutation({
  args: { pin: v.string(), force: v.optional(v.boolean())},
  handler: async (ctx, { pin, force }) => {
    requirePin(pin);
    const already = await ctx.db.query("ledgers").collect();
    if (already.length > 0 && !force) {
      return { skipped: true, ledgers: already.length };
    }

    const now = Date.now();
    const groupIds: Record<string, Id<"groups">> = {};
    for (const g of GROUPS) {
      groupIds[g.name] = await ctx.db.insert("groups", { ...g });
    }
    const typeIds: Record<string, { id: Id<"voucherTypes">; abbr: string }> = {};
    for (const t of TYPES) {
      typeIds[t.name] = { id: await ctx.db.insert("voucherTypes", t), abbr: t.abbr };
    }

    const ledgerIds: Record<string, Id<"ledgers">> = {};
    const makeLedger = async (
      name: string,
      group: string,
      opening: number,
      side: "Dr" | "Cr",
      extra: Record<string, unknown> = {}
    ) => {
      ledgerIds[name] = await ctx.db.insert("ledgers", {
        name,
        groupId: groupIds[group],
        openingBalance: opening,
        openingSide: side,
        openingAsOf: OPENING_AS_OF,
        active: true,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    };

    await makeLedger("Purchases", "Purchase Accounts", 0, "Dr");
    await makeLedger("Sales", "Sales Accounts", 0, "Cr");
    for (const p of PAY_LEDGERS) await makeLedger(p.name, p.group, 0, "Dr");
    for (const s of SUPPLIERS) {
      await makeLedger(s.name, "Sundry Creditors", s.opening, "Cr", {
        place: s.place,
        notes: s.notes,
      });
    }

    // Vouchers are numbered per type in date order, the way Tally numbers them,
    // so the whole month is flattened and sorted before anything is written.
    const flat: Array<{ party: string; txn: Txn }> = [];
    for (const [party, txns] of Object.entries(BOOK)) {
      for (const txn of txns) flat.push({ party, txn });
    }
    flat.sort((a, b) => a.txn[1] - b.txn[1]);

    const counters: Record<string, number> = {};
    const nextNo = (abbr: string, fy: string) => {
      const key = `vno:${abbr}:${fy}`;
      counters[key] = (counters[key] ?? 0) + 1;
      return counters[key];
    };

    let vouchers = 0;
    for (const { party, txn } of flat) {
      const [kind, date, ref, narration, amount] = txn;
      const fy = fyOf(date);
      const type = kind === "pur" ? typeIds.Purchase : typeIds.Payment;
      const voucherId = await ctx.db.insert("vouchers", {
        typeId: type.id,
        voucherNo: nextNo(type.abbr, fy),
        fy,
        date,
        partyLedgerId: ledgerIds[party],
        refNo: ref || undefined,
        narration,
        status: "final",
        amount: round2(amount),
        attachments: [],
        createdAt: now,
        updatedAt: now,
      });

      const lines =
        kind === "pur"
          ? [
              { ledgerId: ledgerIds["Purchases"], side: "Dr" as const, amount },
              { ledgerId: ledgerIds[party], side: "Cr" as const, amount },
            ]
          : [
              { ledgerId: ledgerIds[party], side: "Dr" as const, amount },
              { ledgerId: ledgerIds[(txn as any)[5]], side: "Cr" as const, amount },
            ];
      for (const line of lines) {
        await ctx.db.insert("voucherEntries", { voucherId, date, ...line });
      }
      vouchers++;
    }

    for (const [name, value] of Object.entries(counters)) {
      await ctx.db.insert("counters", { name, value });
    }

    return { skipped: false, ledgers: Object.keys(ledgerIds).length, vouchers };
  },
});
