"use node";

import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";

/**
 * Read through MeshAPI, which speaks Anthropic's own /v1/messages and fronts
 * several providers — so the official SDK is still the client, just pointed
 * elsewhere, and model ids carry a provider prefix.
 *
 * Two things it does not do that the first-party API does:
 *   - `output_config` structured outputs are accepted and then ignored, so the
 *     schema is enforced with a forced tool call instead. Silently returning
 *     prose where JSON was asked for is worse than an error, so this is not
 *     something to leave to chance.
 *   - no prompt caching, so the system prompt is sent whole each time.
 */
// No trailing /v1 — the SDK adds `/v1/messages` itself.
const BASE_URL = process.env.MESH_BASE_URL ?? "https://api.meshapi.ai";
const MODEL = process.env.MESH_VISION_MODEL ?? "anthropic/claude-sonnet-5";

const BILL_TOOL: Anthropic.Tool = {
  name: "file_bill",
  description: "Record what this slip says, field by field.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["sale", "purchase", "receipt", "payment", "unclear"] },
      party: { type: "string" },
      place: { type: "string" },
      date: { type: "string" },
      refNo: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            desc: { type: "string" },
            qty: { type: "string" },
            rate: { type: "string" },
            amount: { type: ["number", "null"] },
          },
          required: ["desc", "qty", "rate", "amount"],
          additionalProperties: false,
        },
      },
      total: { type: ["number", "null"] },
      goodsReturn: { type: ["number", "null"] },
      carriedForward: { type: ["number", "null"] },
      isContinuation: { type: "boolean" },
      paid: { type: ["number", "null"] },
      paidBy: { type: "string" },
      marks: { type: "string" },
      settlement: { type: "string", enum: ["on_account", "settled", "unknown"] },
      notes: { type: "string" },
      confidence: { type: "number" },
    },
    required: [
      "kind", "party", "place", "date", "refNo", "items",
      "total", "goodsReturn", "carriedForward", "isContinuation", "paid", "paidBy",
      "marks", "settlement", "notes", "confidence",
    ],
    additionalProperties: false,
  } as any,
};

const SYSTEM = `You read handwritten counter slips for a hardware shop in Ramgarh, Jharkhand, and turn them into ledger entries.

What these slips look like:
- One party per slip, written at the top, usually "M/s <name> jee" with the locality after a comma. Names are Indian; the honorific "jee"/"ji" is part of how they are written, not a surname.

A slip with NO NAME at the top is not a nameless customer — it is the second
sheet of somebody else's bill, and the first sheet is elsewhere in the pile:
- Say so with isContinuation: true, and leave party empty rather than guessing
  or answering UNKNOWN.
- Such a sheet opens with a figure carried over from the bottom of the first
  sheet. Put that opening figure in carriedForward. It is what identifies the
  bill this belongs to — the first sheet's total is the same number.
- carriedForward is not a sale. Do not add it into the item lines.

When several pages are given they are ONE bill, front to back:
- The party is written at the top of the FIRST page only. Later pages carry more item lines, a carried-forward total, and any payment — often after a "P.T.O". Never answer UNKNOWN for the party when an earlier page names them.
- A figure at the top of a later page that repeats the bottom of the earlier one is a carried-forward total, not a second sale. Count it once.
- total is the final figure on the LAST page, after everything carried forward, any goods return and any payment shown.

Whose slip is it? This matters more than anything else on the page:
- SHIV HARDWARE (also written Shiv H/Ware, Shiv Hardware Store, M/s Shiv Hardware) IS THIS SHOP. It is never the party. If you see it, it is either the letterhead of our own slip or the customer line on somebody else's.
- A slip on a PRINTED letterhead belonging to another business — a printed shop name, GSTIN, phone numbers across the top — is that business billing us. The party is the printed business, and kind is "purchase". The handwritten name under "Name" on such a slip is us, the buyer, and must be ignored.
- A slip on our own pad or plain paper, with the customer written in by hand at the top, is us billing them: the party is that handwritten name, and kind is "sale".
- A date at the top right, written like 12/8/26 or 13-8-26. The year is 2026 and the financial year runs April to March.
- Item lines: description, quantity, sometimes a rate, and an amount in the right-hand column. Sizes appear as 12mm, 8x4, 19x20x6, 6". Common goods: hinges, aldrops, handles, telescopic channels, tower bolts, Fevicol, screws, plywood, laminate, glass.
- A total, usually underlined at the bottom right.
- "GR" written against a line means GOODS RETURN: that stock came back, so its value is subtracted, not added. A slip reading 960, then GR 720, is a bill of 240 — the shop is owed the net, never the gross and never the returned figure on its own. Put the returned value in goodsReturn and the net in total.
- Underneath a net total there is often a payment and then what is left: 240, then 200, then 40 means 200 was handed over and 40 is still owed. Put what was handed over in paid. Where nothing was paid, paid is null.
- Slips that say "Received <amount>" with a PAID stamp are money coming in, not goods going out.

The two marks that decide what happens to a slip:
- A circled "O/A" means ON ACCOUNT. This customer keeps a running account with the shop — the sale goes on their ledger and stays owing until they pay. settlement: "on_account".
- A PAID stamp (often red, usually with a date) means the bill is closed: the goods went out and the money came in, in full, at the same time. Nothing is left owing. settlement: "settled".
- If neither mark is there, or you cannot make it out, settlement: "unknown" — do not guess, someone will look.
- A slip can carry BOTH an O/A circle and a PAID stamp. That is a part payment on a running account, not a closed bill: settlement stays "on_account", and what was handed over goes in paid.
- Circled initials that are not O/A are the writer signing the slip, not an instruction. Put whatever mark you see in "marks", exactly as written.

Rules:
- Read the amounts column exactly. These are rupees; never invent a digit you cannot see, and never round.
- If a figure is genuinely unreadable, use null rather than a guess.
- kind: "sale" when goods go out to a customer, "receipt" when money comes in from one, "purchase" when goods come in from a supplier, "payment" when money goes out. Use "unclear" if you cannot tell.
- date: return as YYYY-MM-DD. A slip marked 12/8/26 is 2026-08-12 (day first).
- carriedForward: the figure brought over from a previous sheet, when this
  sheet opens with one; null otherwise.
- total: the value of the GOODS ON THIS BILL — the sum of the lines, net of any goods return. It is the bill, not the balance. Never subtract a payment from it: a bill of 113,086 with 80,000 handed over still has total 113,086, paid 80,000. The figure left at the bottom of the slip after a payment is what remains owing, and it is not the total.
- goodsReturn: the value returned, when a GR line appears; null otherwise.
- paid: the amount handed over on this slip, when the slip shows one; null otherwise. Do not assume the total was paid because a PAID stamp is present — read the figures. If you can see a payment anywhere on the slip — a figure struck off the total, a line reading "paid", a balance carried below — it belongs in this field. Writing it into notes instead of paid is a failure: notes are not read by the books.
- Where a payment leaves a balance, settlement is "on_account", whatever stamp is on the page. A PAID stamp beside a written balance means part paid, not closed.
- notes: one short line at most — a plain description of what was bought or sold, the kind of thing that goes in a ledger narration. Do not describe the handwriting or speculate about what the items might be. Leave it empty rather than padding it.
- confidence: 0 to 1, your honest read on whether this needs a human to check it.

Nothing you return is posted to the books. A person reads every one of these and approves it first, so say what you actually see and flag what you are unsure of rather than producing something tidy.

You will be shown what this shop has already corrected. Follow it - it is the shop's own knowledge of its handwriting and its customers, and it outranks your first instinct.`;

export const read = action({
  args: { inboxId: v.id("inbox") },
  handler: async (ctx, { inboxId }): Promise<{ ok: boolean; error?: string }> => {
    const started = Date.now();
    await ctx.runMutation(internal.review.markReading, { inboxId });

    try {
      const photo = await ctx.runQuery(internal.review.photoUrls, { inboxId });
      if (!photo) throw new Error("That photo is no longer in the inbox");

      const pageData: string[] = [];
      for (const url of photo.pages) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not fetch the photo (${res.status})`);
        pageData.push(Buffer.from(await res.arrayBuffer()).toString("base64"));
      }

      const [ledgers, lessons] = await Promise.all([
        ctx.runQuery(internal.review.partyNames, {}),
        ctx.runQuery(internal.review.activeLessons, {}),
      ]);

      const apiKey = process.env.MESH_API_KEY ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("no api key");
      const client = new Anthropic({ apiKey, baseURL: BASE_URL });

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM,
        tools: [BILL_TOOL],
        tool_choice: { type: "tool", name: "file_bill" },
        messages: [
          {
            role: "user",
            content: [
              ...pageData.map((data: string) => ({
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: "image/jpeg" as const,
                  data,
                },
              })),
              {
                type: "text" as const,
                text: [
                  "Accounts already open in this shop's books. These slips are handwritten, so the same customer turns up spelled several ways — Nilesh and Nitesh are one pen-stroke apart and are the same shop. When the name on the slip is plainly one of these people, return that account's spelling exactly as listed.",
                  "",
                  "What makes it the same person is the NAME. Sanjay Prasad and Vishal Prasad are two customers, not one badly written one, and no amount of shared surname or shared village joins them. Read the given name; if it is a different given name, it is a different person and you return what is written on the slip, even when the rest of the line matches an account here exactly.",
                  "The locality after the comma never makes a match — it only confirms one already made on the name. Two people in Chainpur are still two people.",
                  "Where a name is struck out and rewritten, the rewritten one is the customer.",
                  "Return the name as written whenever it matches nobody here. A name this shop does not recognise is a new customer or a misreading, and either is easier to fix at the counter than a bill filed to the wrong man's account:",
                  ledgers.map((l: string) => `  - ${l}`).join("\n") || "  (none yet)",
                  "",
                  lessons.length
                    ? ["What this shop has corrected before:", ...lessons.map((l: string) => `  - ${l}`)].join("\n")
                    : "",
                  "",
                  pageData.length > 1
                    ? `This is one bill of ${pageData.length} pages. Read them together and return a single entry.`
                    : "Read this slip.",
                ].join("\n"),
              },
            ],
          },
        ],
      });

      const call = response.content.find((b) => b.type === "tool_use");
      if (!call) throw new Error("The reader did not fill the form in");
      const draft = (call as Anthropic.ToolUseBlock).input;

      await ctx.runMutation(internal.review.saveReading, {
        inboxId,
        draft,
        model: MODEL,
        ms: Date.now() - started,
      });
      return { ok: true };
    } catch (err: any) {
      const message =
        err?.status === 401 || /no api key|api[_ ]?key|authentication/i.test(err?.message ?? "")
          ? "No key on the deployment — run: npx convex env set MESH_API_KEY <key>"
          : err?.message ?? String(err);
      await ctx.runMutation(internal.review.failReading, { inboxId, error: message });
      return { ok: false, error: message };
    }
  },
});

/**
 * Reads a chunk of the pile, four bills at a time.
 *
 * Deliberately not the whole pile in one call: a hundred bills at a dozen
 * seconds each would outlast the time an action is allowed to run, and lose
 * everything it had done. The screen calls this over and over until the pile
 * is empty, so a long run is just a series of short ones and stopping halfway
 * keeps whatever was read.
 */
export const readPending = action({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }): Promise<{ started: number }> => {
    const waiting: string[] = await ctx.runQuery(api.review.unread, {
      limit: limit ?? 10,
    });
    await inLanes(ctx, waiting);
    return { started: waiting.length };
  },
});

/**
 * Reads bills that have already been read, once the instructions have changed.
 *
 * A correction taught today does nothing for the slips read yesterday — their
 * drafts were written under the old rules and sit in the queue still saying
 * the gross where a goods return was taken off, or naming this shop as the
 * party. Putting them back through the reader applies every rule since, in one
 * pass, and costs a fresh read of each bill.
 *
 * Chunked for the same reason as readPending, and `before` is fixed by the
 * caller at the start of a run: each bill re-read is stamped with the time it
 * finished, so it falls out of the next chunk and the loop reaches an end.
 * Whatever has been re-read when a run is stopped halfway is already saved.
 */
export const readAgain = action({
  args: { before: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { before, limit }): Promise<{ started: number }> => {
    const waiting: string[] = await ctx.runQuery(api.review.stale, {
      before,
      limit: limit ?? 10,
    });
    await inLanes(ctx, waiting);
    return { started: waiting.length };
  },
});

/**
 * Four bills at a time down the same list. Four because the reader takes a
 * dozen seconds a bill and the pile is hundreds long, and because rather more
 * than four at once is how a rate limit is met.
 */
async function inLanes(ctx: any, ids: string[]) {
  const LANES = 4;
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(LANES, ids.length) }, async () => {
    while (cursor < ids.length) {
      const next = ids[cursor++];
      await ctx.runAction(api.ai.read, { inboxId: next as any });
    }
  });
  await Promise.all(lanes);
}
