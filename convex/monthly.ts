import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { fyOf, round2, signed } from "./lib/money";
import { record, money } from "./lib/history";
import { nextVoucherNo } from "./lib/numbering";
import { writeLines } from "./lib/entries";
import { properText } from "./lib/text";

/**
 * Salaries and rents — the money that falls due every month whether a bill
 * arrives or not.
 *
 * Wages are handed over daily from the drawer. The cash book posts each note
 * against the account its name matches, so a note for Anup lands on Anup's
 * account here, and what is left on it is the month's salary less what he has
 * been given.
 *
 * Each member of staff and each rented premises is an account of its own, the
 * way Tally keeps them: a month falling due credits the account (Journal, Dr
 * Salary or Rent), and paying it debits the account (an ordinary Payment, Cr
 * Cash or Bank). What is left on the account is what is still owed, so arrears
 * carry from month to month without anyone adding them up by hand.
 */

const KIND = v.union(v.literal("staff"), v.literal("rent"));
type Kind = "staff" | "rent";

const GROUP: Record<Kind, string> = { staff: "Staff", rent: "Rent Payable" };
const EXPENSE: Record<Kind, string> = { staff: "Salary", rent: "Rent" };
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-09" → "Sep 2026", which is what the ledger shows as the ref. */
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
/** A month's charge is dated the 1st — rent is owed from the day it starts. */
const monthStart = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, 1);
};
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

async function groupNamed(ctx: QueryCtx, name: string) {
  return ctx.db
    .query("groups")
    .withIndex("by_name", (q) => q.eq("name", name))
    .unique();
}

async function ledgerNamed(ctx: QueryCtx, name: string) {
  return ctx.db
    .query("ledgers")
    .withIndex("by_name", (q) => q.eq("name", name))
    .unique();
}

/**
 * Opens whatever this screen needs and is not there yet: the two groups, the
 * Salary and Rent expense accounts, and the Journal voucher type. Safe to run
 * any number of times.
 */
async function ensure(ctx: MutationCtx) {
  const groupFor = async (
    name: string,
    nature: "liability" | "expense",
    normalSide: "Dr" | "Cr",
    sort: number
  ) => {
    const found = await groupNamed(ctx, name);
    if (found) return found._id;
    return ctx.db.insert("groups", { name, nature, normalSide, sort });
  };
  const expenses = await groupFor("Indirect Expenses", "expense", "Dr", 7);
  const groups: Record<Kind, Id<"groups">> = {
    // Wages are paid by the day, so a staff account is where that expense is
    // kept, person by person — not a debt that a month falls due into.
    staff: await groupFor(GROUP.staff, "expense", "Dr", 8),
    rent: await groupFor(GROUP.rent, "liability", "Cr", 9),
  };

  const now = Date.now();
  const expenseFor = async (name: string) => {
    const found = await ledgerNamed(ctx, name);
    if (found) return found._id;
    return ctx.db.insert("ledgers", {
      name,
      groupId: expenses,
      openingBalance: 0,
      openingSide: "Dr",
      openingAsOf: now,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  };
  const expense: Record<Kind, Id<"ledgers">> = {
    staff: await expenseFor(EXPENSE.staff),
    rent: await expenseFor(EXPENSE.rent),
  };

  let type = await ctx.db
    .query("voucherTypes")
    .withIndex("by_name", (q) => q.eq("name", "Journal"))
    .unique();
  if (!type) {
    const id = await ctx.db.insert("voucherTypes", { name: "Journal", abbr: "JRN", sort: 9 });
    type = (await ctx.db.get(id))!;
  }
  return { groups, expense, type };
}

type Setup = Awaited<ReturnType<typeof ensure>>;

/** The month's charge on one account, unless it is already on the books. */
async function charge(
  ctx: MutationCtx,
  setup: Setup,
  kind: Kind,
  account: Doc<"ledgers">,
  month: string,
  amount = account.monthly
) {
  if (!(amount && amount > 0)) return "no-amount" as const;
  const label = monthLabel(month);
  const existing = await ctx.db
    .query("vouchers")
    .withIndex("by_party", (q) => q.eq("partyLedgerId", account._id))
    .collect();
  if (existing.some((vch) => vch.typeId === setup.type._id && vch.refNo === label)) {
    return "already" as const;
  }

  const date = monthStart(month);
  const fy = fyOf(date);
  const now = Date.now();
  const voucherNo = await nextVoucherNo(ctx, setup.type, fy);
  const voucherId = await ctx.db.insert("vouchers", {
    typeId: setup.type._id,
    voucherNo,
    fy,
    date,
    partyLedgerId: account._id,
    refNo: label,
    status: "final",
    amount: round2(amount),
    attachments: [],
    createdAt: now,
    updatedAt: now,
  });
  await writeLines(ctx, voucherId, date, [
    { ledgerId: setup.expense[kind], side: "Dr", amount },
    { ledgerId: account._id, side: "Cr", amount },
  ]);
  return "posted" as const;
}

async function accountsOf(ctx: QueryCtx, kind: Kind) {
  const group = await groupNamed(ctx, GROUP[kind]);
  if (!group) return [];
  const list = await ctx.db
    .query("ledgers")
    .withIndex("by_group", (q) => q.eq("groupId", group._id))
    .collect();
  return list.filter((l) => l.active).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Everyone and everything paid monthly, with what has fallen due, what has been
 * paid and what is still owed — and which months have been charged, so a
 * missed month shows as a gap rather than a smaller number.
 */
export const board = query({
  args: { month: v.optional(v.string()) },
  handler: async (ctx, { month }) => {
    // What was paid in the month being looked at; this month unless one is asked for.
    const ist = new Date(Date.now() + 5.5 * 3_600_000);
    const key = month && MONTH_KEY.test(month)
      ? month
      : `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
    const from = monthStart(key);
    const [y, m] = key.split("-").map(Number);
    const until = Date.UTC(y, m, 1);
    const journal = await ctx.db
      .query("voucherTypes")
      .withIndex("by_name", (q) => q.eq("name", "Journal"))
      .unique();

    const rowsFor = async (kind: Kind) =>
      Promise.all(
        (await accountsOf(ctx, kind)).map(async (account) => {
          const lines = await ctx.db
            .query("voucherEntries")
            .withIndex("by_ledger", (q) => q.eq("ledgerId", account._id))
            .collect();
          const vouchers = await ctx.db
            .query("vouchers")
            .withIndex("by_party", (q) => q.eq("partyLedgerId", account._id))
            .collect();
          const months = vouchers
            .filter((vch) => journal && vch.typeId === journal._id && vch.refNo)
            .sort((a, b) => a.date - b.date)
            .map((vch) => ({ label: vch.refNo!, date: vch.date }));

          // On these accounts a credit is a month falling due and a debit is
          // money handed over; nothing else is ever posted to them.
          const charged = lines.filter((l) => l.side === "Cr").reduce((t, l) => t + l.amount, 0);
          const paid = lines.filter((l) => l.side === "Dr").reduce((t, l) => t + l.amount, 0);
          const paidInMonth = lines
            .filter((l) => l.side === "Dr" && l.date >= from && l.date < until)
            .reduce((t, l) => t + l.amount, 0);
          const net =
            signed(account.openingSide, account.openingBalance) +
            lines.reduce((t, l) => t + signed(l.side, l.amount), 0);
          return {
            ledgerId: account._id,
            name: account.name,
            payee: account.payee ?? null,
            phone: account.phone ?? null,
            tags: account.tags ?? [],
            monthly: account.monthly ?? 0,
            // Owed before the first month this screen charged.
            // `+ 0` so an empty account reads 0, not -0.
            opening: round2(-signed(account.openingSide, account.openingBalance)) + 0,
            charged: round2(charged),
            paid: round2(paid),
            paidInMonth: round2(paidInMonth),
            // Positive: the shop owes. Negative: paid ahead.
            due: round2(-net) + 0,
            months,
          };
        })
      );

    const staff = await rowsFor("staff");
    const rent = await rowsFor("rent");
    const sum = (rows: typeof staff, field: "monthly" | "due" | "paid" | "charged" | "paidInMonth") =>
      round2(rows.reduce((t, r) => t + r[field], 0));

    return {
      ready: Boolean(journal) && Boolean(await groupNamed(ctx, GROUP.staff)),
      month: key,
      staff,
      rent,
      totals: {
        staff: {
          monthly: sum(staff, "monthly"),
          due: sum(staff, "due"),
          paid: sum(staff, "paid"),
          paidInMonth: sum(staff, "paidInMonth"),
        },
        rent: { monthly: sum(rent, "monthly"), due: sum(rent, "due"), paid: sum(rent, "paid") },
      },
    };
  },
});

/** Puts one month's salary, or one month's rent, on every account that has a figure. */
export const chargeMonth = mutation({
  args: { kind: KIND, month: v.string() },
  handler: async (ctx, { kind, month }) => {
    if (!MONTH_KEY.test(month)) throw new Error(`Not a month: ${month}`);
    // Wages are paid daily and recorded as they are paid; a month is never
    // charged to staff as a debt.
    if (kind === "staff") throw new Error("Salaries are paid daily — nothing is charged for a month.");
    const setup = await ensure(ctx);
    const posted: string[] = [];
    const already: string[] = [];
    let total = 0;
    for (const account of await accountsOf(ctx, kind)) {
      const result = await charge(ctx, setup, kind, account, month);
      if (result === "posted") {
        posted.push(account.name);
        total += account.monthly!;
      } else if (result === "already") {
        already.push(account.name);
      }
    }
    if (posted.length) {
      await record(
        ctx,
        "monthly.charge",
        `Rent for ${monthLabel(month)} fell due — ` +
          `${posted.length} ${posted.length === 1 ? "account" : "accounts"}, ${money(total)}`,
        { entity: "monthly", detail: { kind, month, posted } }
      );
    }
    return { posted, already };
  },
});

/** A new member of staff, or a newly rented premises. */
export const addAccount = mutation({
  args: {
    kind: KIND,
    name: v.string(),
    monthly: v.number(),
    payee: v.optional(v.string()),
    phone: v.optional(v.string()),
    // Owed from before the first month charged here.
    owed: v.optional(v.number()),
    owedAsOf: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(args.monthly > 0)) throw new Error("Enter the monthly amount");
    const setup = await ensure(ctx);
    const name = properText(args.name);
    if (!name) throw new Error("Give it a name");
    if (await ledgerNamed(ctx, name)) throw new Error(`"${name}" already exists`);
    const now = Date.now();
    const id = await ctx.db.insert("ledgers", {
      name,
      groupId: setup.groups[args.kind],
      monthly: round2(args.monthly),
      payee: args.payee?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      // Nothing is ever owed to staff here — wages are paid as they are earned.
      openingBalance: args.kind === "staff" ? 0 : round2(args.owed ?? 0),
      openingSide: args.kind === "staff" ? "Dr" : "Cr",
      openingAsOf: args.owedAsOf,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await record(
      ctx,
      "ledger.create",
      `Opened ${args.kind === "staff" ? "staff account" : "rent account"} ${name}, ` +
        `${money(args.monthly)} a month` +
        (args.owed ? `, ${money(args.owed)} owed before` : ""),
      { entity: "ledger", entityId: id }
    );
    return id;
  },
});

/**
 * The sheet the shop kept by hand, September 2026: six staff, three premises,
 * and the rent that had fallen due on each since July. Run once —
 *
 *   npx convex run --prod monthly:loadSheet
 *
 * — and it skips anything already there, so running it twice does nothing.
 */
export const loadSheet = internalMutation({
  args: {},
  handler: async (ctx) => {
    const setup = await ensure(ctx);
    const asOf = Date.UTC(2026, 6, 1);
    const now = Date.now();
    const made: string[] = [];

    const open = async (
      kind: Kind,
      name: string,
      monthly: number,
      extra: { payee?: string; phone?: string; owed?: number } = {}
    ) => {
      const found = await ledgerNamed(ctx, name);
      if (found) return found;
      const id = await ctx.db.insert("ledgers", {
        name,
        groupId: setup.groups[kind],
        monthly,
        payee: extra.payee,
        phone: extra.phone,
        openingBalance: extra.owed ?? 0,
        openingSide: kind === "staff" ? "Dr" : "Cr",
        openingAsOf: asOf,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      made.push(name);
      return (await ctx.db.get(id))!;
    };

    for (const [name, monthly] of [
      ["Anup", 19500],
      ["Vijay", 25200],
      ["Anand", 21300],
      ["Vicky", 19500],
      ["Sonu", 16500],
      ["Dharmendra", 19800],
    ] as const) {
      await open("staff", name, monthly);
    }

    const shop = await open("rent", "Shop + Back Down Godown", 29350, {
      payee: "Advo Pramod Singh",
      phone: "9431391663",
    });
    // The sheet names no landlord over this column.
    const upper = await open("rent", "Back Upper Godown", 31000, { owed: 28050 });
    const front = await open("rent", "Front Godown", 26200, {
      payee: "Sangam Shoes",
      phone: "7838428429",
      owed: 25000,
    });

    const posted: string[] = [];
    const due: Array<[Doc<"ledgers">, string]> = [
      [shop, "2026-07"], [shop, "2026-08"], [shop, "2026-09"],
      [upper, "2026-07"], [upper, "2026-08"], [upper, "2026-09"],
      // The front godown was not charged for July on the sheet.
      [front, "2026-08"], [front, "2026-09"],
    ];
    for (const [account, month] of due) {
      if ((await charge(ctx, setup, "rent", account, month)) === "posted") {
        posted.push(`${account.name} ${monthLabel(month)}`);
      }
    }

    if (made.length || posted.length) {
      await record(
        ctx,
        "monthly.load",
        `Loaded the salary and rent sheet — ${made.length} accounts, ${posted.length} months of rent`,
        { entity: "monthly", detail: { made, posted } }
      );
    }
    return { made, posted };
  },
});

/**
 * Staff accounts as the record of wages paid, not of wages owed. Run once on a
 * deployment set up before wages were known to be paid daily.
 *
 *   npx convex run --prod monthly:staffPaidDaily
 */
export const staffPaidDaily = internalMutation({
  args: {},
  handler: async (ctx) => {
    const group = await groupNamed(ctx, GROUP.staff);
    if (!group) return { changed: false };
    const charged = [];
    const journal = await ctx.db
      .query("voucherTypes")
      .withIndex("by_name", (q) => q.eq("name", "Journal"))
      .unique();
    for (const account of await accountsOf(ctx, "staff")) {
      const vouchers = await ctx.db
        .query("vouchers")
        .withIndex("by_party", (q) => q.eq("partyLedgerId", account._id))
        .collect();
      if (journal && vouchers.some((vch) => vch.typeId === journal._id)) charged.push(account.name);
    }
    // A month already charged to someone would read as money paid out once
    // the account is an expense. None should exist; stop rather than guess.
    if (charged.length) throw new Error(`Salary months are charged to ${charged.join(", ")} — remove them first.`);
    if (group.nature === "expense" && group.normalSide === "Dr") return { changed: false };
    await ctx.db.patch(group._id, { nature: "expense", normalSide: "Dr" });
    for (const account of await accountsOf(ctx, "staff")) {
      if (account.openingBalance === 0 && account.openingSide !== "Dr") {
        await ctx.db.patch(account._id, { openingSide: "Dr", updatedAt: Date.now() });
      }
    }
    await record(ctx, "monthly.staff-daily", "Staff accounts now record wages paid (paid daily), not wages owed", {
      entity: "monthly",
    });
    return { changed: true };
  },
});
