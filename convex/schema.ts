import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

const printJobStatus = v.union(
  v.literal('pending'),
  v.literal('claimed'),
  v.literal('printing'),
  v.literal('printed'),
  v.literal('failed'),
  v.literal('cancelled'),
)

// ── Shared validators for the ledger tables ───────────────────────────────
const attachment = v.object({
  storageId: v.id("_storage"),
  // A picture of the document, for the screens and the printer. A PDF cannot
  // be shown on a ledger row or embedded in a printed packet, so one is
  // rendered and kept beside it. The PDF stays the document; this is its face.
  previewStorageId: v.optional(v.id("_storage")),
  kind: v.union(
    v.literal("bill"),
    v.literal("challan"),
    v.literal("estimate"),
    v.literal("receipt"),
    v.literal("other")
  ),
});

// While the old bare-id form is being migrated away, both shapes are accepted.
const attachments = v.array(v.union(v.id("_storage"), attachment));

export default defineSchema({
  // ── Bills backup (single-row snapshot; all bills incl. drafts) ────────────
  billsStore: defineTable({
    bills:   v.array(v.any()),
    billSeq: v.number(),
    savedAt: v.number(),
  }),

  /**
   * Bills that were deleted, kept whole so they can be put back.
   *
   * The panel used to delete a bill by leaving it out of the next snapshot,
   * which meant there was nothing to restore and no record it had existed —
   * and the voucher it had posted stayed in the books, an amount with no bill
   * behind it. Deleting writes here instead, and the voucher goes to the
   * ledger's own trash at the same time.
   */
  billsTrash: defineTable({
    billId: v.string(),
    bill: v.any(),
    deletedAt: v.number(),
    // The ledger voucher that went with it, so a restore can say what happened
    // to the books as well as to the bill.
    voucherRef: v.optional(v.string()),
    voucherTrashId: v.optional(v.id('trash')),
  }).index('by_bill', ['billId']),

  /**
   * Bills that were deleted, as a fact that outlives the copy.
   *
   * `billsTrash` holds the bill so it can be restored; emptying the bin throws
   * that row away, and with it the only evidence the bill was ever deleted —
   * after which any device still holding a copy pushes it straight back in.
   * A tombstone is small, permanent, and the thing every sync checks against.
   */
  billTombstones: defineTable({
    billId: v.string(),
    number: v.optional(v.string()),
    deletedAt: v.number(),
  }).index('by_bill', ['billId']),

  // ── Soft locks: who is currently typing which bill ────────────────────────
  billLocks: defineTable({
    billId: v.string(),
    deviceId: v.string(),
    deviceName: v.string(),
    heldAt: v.number(),      // refreshed while the editor is open; stale = free
  }).index('by_bill', ['billId']),

  // ── Toto driver contacts (single-row snapshot) ────────────────────────────
  totoStore: defineTable({
    drivers: v.array(v.any()),
    savedAt: v.number(),
  }),

  // ── Catalog backup (single-row snapshot) ──────────────────────────────────
  catalogStore: defineTable({
    hardwareCatalog: v.any(),
    customCatalog:   v.array(v.any()),
    sets:            v.array(v.any()),
    savedAt:         v.number(),
  }),

  customers: defineTable({
    localId: v.optional(v.string()),
    name: v.string(),
    mobile: v.optional(v.string()),
    altMobile: v.optional(v.string()),
    uid: v.optional(v.string()),
    address: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('by_mobile', ['mobile'])
    .index('by_local_id', ['localId']),

  quotations: defineTable({
    localId: v.string(),
    number: v.string(),
    customer: v.any(),
    document: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_number', ['number'])
    .index('by_local_id', ['localId'])
    .index('by_created_at', ['createdAt']),

  guaranteeDocuments: defineTable({
    localId: v.string(),
    number: v.string(),
    /**
     * The secret in the card's QR.
     *
     * The card is read by a customer with no account, so the page behind the
     * QR answers to anyone who holds the link. Card numbers run in a sequence,
     * which made the whole file walkable from GC-2026-0001 — names, mobiles,
     * Aadhaar numbers and what each person paid. The number says which card;
     * this says you are holding it.
     *
     * Optional only so the rows written before it existed still validate. A
     * card without one cannot be opened.
     */
    token: v.optional(v.string()),
    customer: v.any(),
    document: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_number', ['number'])
    .index('by_local_id', ['localId'])
    .index('by_created_at', ['createdAt']),

  // One row per WhatsApp send attempt. Meta's API only returns "accepted" —
  // whether a message actually landed arrives later over the webhook — so this
  // is the shop's record of what was tried, for which card, and why it failed.
  whatsappSends: defineTable({
    number: v.string(),
    to: v.string(),
    status: v.union(v.literal('sent'), v.literal('failed')),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    // Filled in later by the webhook — Meta reports delivery asynchronously,
    // so these stay empty until the customer's phone acknowledges.
    deliveryStatus: v.optional(v.string()), // sent | delivered | read | failed
    deliveredAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
  })
    .index('by_number', ['number'])
    .index('by_created_at', ['createdAt'])
    .index('by_message_id', ['messageId']),

  // Small key/value scratchpad for background jobs — currently only the
  // template-approval watcher, so it can tell "already notified" from
  // "not approved yet" across cron runs.
  watcherState: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index('by_key', ['key']),

  // Customer replies. Any inbound message opens a 24-hour service window, so
  // this is also how the shop knows it may answer in free-form text.
  whatsappInbox: defineTable({
    from: v.string(),
    text: v.optional(v.string()),
    messageId: v.optional(v.string()),
    receivedAt: v.number(),
  }).index('by_received_at', ['receivedAt']),

  printJobs: defineTable({
    status: printJobStatus,
    kind: v.union(v.literal('quotation'), v.literal('guarantee'), v.literal('raw-file')),
    source: v.union(v.literal('android'), v.literal('web'), v.literal('whatsapp'), v.literal('server')),
    payload: v.any(),
    copies: v.number(),
    requestedBy: v.optional(v.string()),
    assignedPrinterId: v.optional(v.string()),
    claimedBy: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
    leaseExpiresAt: v.optional(v.number()),
    printedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_status_created_at', ['status', 'createdAt'])
    .index('by_printer_status_created_at', ['assignedPrinterId', 'status', 'createdAt'])
    .index('by_claimed_by_status', ['claimedBy', 'status']),

  // ── Attendance: one row per day, marks = { staffName: 'P'|'N'|'H'|'C' } ────
  attendanceDays: defineTable({
    date: v.string(), // 'YYYY-MM-DD'
    marks: v.any(),
    locked: v.optional(v.boolean()), // true once saved — edits then need the password
    updatedAt: v.number(),
  }).index('by_date', ['date']),

  // ── Attendance staff list (single row) ────────────────────────────────────
  attendanceMeta: defineTable({
    staff: v.array(v.string()),
    rates: v.optional(v.any()), // { staffName: dailyRate }
    updatedAt: v.number(),
  }),

  // ── Advances paid to staff during a month ─────────────────────────────────
  attendanceAdvances: defineTable({
    staff: v.string(),
    date: v.string(),   // 'YYYY-MM-DD'
    amount: v.number(),
    note: v.optional(v.string()),
    at: v.number(),
  }).index('by_date', ['date']),

  // ── Attendance change history (audit log) ─────────────────────────────────
  attendanceLog: defineTable({
    at: v.number(),            // when the change happened
    date: v.optional(v.string()), // attendance day affected ('YYYY-MM-DD')
    action: v.string(),        // 'mark' | 'bulk' | 'lock' | 'staff'
    summary: v.string(),       // human-readable description
    changes: v.optional(v.any()), // [{ staff, from, to }]
  }).index('by_at', ['at']),

  // ── Cash book ─────────────────────────────────────────────────────────────
  // Every row carries the id the device gave it, so a write can be replayed as
  // many times as the queue needs without ever landing twice. `updatedAt` is
  // what decides a conflict, and a delete is a flag rather than a removal —
  // otherwise a row deleted on one phone comes back on the next pull.
  cashEntries: defineTable({
    entryId: v.string(),   // generated on the device, stable for the row's life
    date: v.string(),      // 'YYYY-MM-DD' — the business day, not the write time
    kind: v.union(v.literal('in'), v.literal('out')),
    mode: v.union(v.literal('cash'), v.literal('online')),
    name: v.string(),
    amount: v.number(),
    at: v.number(),
    updatedAt: v.number(),
    deleted: v.optional(v.boolean()),
    dealer: v.optional(v.boolean()),   // a payment to a supplier, marked on the page
    /**
     * The books' side of this note. The drawer used to be a second, separate
     * record of the shop's money: cash came in here and nowhere else, so Cash
     * in the trial balance could only ever be half a story. An entry that
     * names a party the books know posts its Receipt or Payment at once; one
     * that doesn't waits in the review queue for somebody to say whose it is,
     * rather than having an account invented for it.
     */
    ledgerId: v.optional(v.id('ledgers')),
    voucherId: v.optional(v.id('vouchers')),
  })
    .index('by_entry_id', ['entryId'])
    .index('by_date', ['date'])
    .index('by_updated_at', ['updatedAt']),

  // ── The evening count, one per closed day ─────────────────────────────────
  cashCloses: defineTable({
    date: v.string(),
    counted: v.number(),
    at: v.number(),
    updatedAt: v.number(),
    deleted: v.optional(v.boolean()),   // a reopened day
    shut: v.optional(v.boolean()),      // the shop never opened — no drawer to count
  })
    .index('by_date', ['date'])
    .index('by_updated_at', ['updatedAt']),

  // ── Opening balances, one per day they are set on ─────────────────────────
  cashOpenings: defineTable({
    date: v.string(),
    cash: v.number(),
    online: v.number(),
    at: v.number(),
    updatedAt: v.number(),
    deleted: v.optional(v.boolean()),
  })
    .index('by_date', ['date'])
    .index('by_updated_at', ['updatedAt']),

  // ── Cash change history (audit log; append-only, never edited) ────────────
  cashLog: defineTable({
    logId: v.string(),
    at: v.number(),
    kind: v.string(),          // add | edit | delete | close | reopen | opening | opening-off
    date: v.string(),          // the business day the change affected
    what: v.string(),
    changes: v.optional(v.array(v.string())),
    device: v.optional(v.any()),
  })
    .index('by_log_id', ['logId'])
    .index('by_at', ['at']),

  // ── Attendance app opening check-ins (only after the visitor responds to the prompt) ──
  attendanceOpenings: defineTable({
    deviceId: v.string(), // a random, browser-local identifier — not a hardware identifier
    deviceModel: v.optional(v.string()), // provided by browser client hints when available
    platform: v.optional(v.string()),
    browser: v.optional(v.string()),
    openedAt: v.number(), // set by the server when the check-in is received
    locationStatus: v.union(v.literal('shared'), v.literal('declined'), v.literal('unavailable')),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    accuracyMeters: v.optional(v.number()),
  }).index('by_opened_at', ['openedAt']),

  // ══════════════════════════════════════════════════════════════════════════
  // ShivLedger — the books. Merged in from its own deployment; the model is
  // Tally's, cut to the purchase side:
  //
  //     groups  →  ledgers  →  voucherEntries  ←  vouchers
  //
  // A voucher is the transaction, its entries are the Dr/Cr lines, and they
  // must sum to zero. Balances are never stored — they fold from the entries.
  // ══════════════════════════════════════════════════════════════════════════

  // Sundry Creditors, Cash-in-Hand, Bank Accounts, Purchase Accounts.
  groups: defineTable({
    name: v.string(),
    nature: v.union(
      v.literal("asset"),
      v.literal("liability"),
      v.literal("income"),
      v.literal("expense")
    ),
    // Which side a positive balance normally sits on, for display.
    normalSide: v.union(v.literal("Dr"), v.literal("Cr")),
    sort: v.number(),
  }).index("by_name", ["name"]),

  ledgers: defineTable({
    name: v.string(),
    groupId: v.id("groups"),
    alias: v.optional(v.string()),
    place: v.optional(v.string()),
    phone: v.optional(v.string()),
    gstin: v.optional(v.string()),
    // Kept for customers on credit who have no GST number. Digits only.
    aadhaar: v.optional(v.string()),
    // Tally keeps the amount positive and records which side it sits on.
    openingBalance: v.number(),
    openingSide: v.union(v.literal("Dr"), v.literal("Cr")),
    openingAsOf: v.number(),
    notes: v.optional(v.string()),
    // Colour marks, the way a Finder tag works: an account can carry several,
    // they mean whatever the shop decides, and they are for finding people
    // again — the chasing list, the ones who pay late, the regulars.
    tags: v.optional(v.array(v.string())),
    // Staff and rented premises only: what falls due every month, and — for a
    // premises — who it is paid to. The ledger is named after the place,
    // because one landlord can let the shop more than one of them and each
    // runs its own arrears.
    monthly: v.optional(v.number()),
    payee: v.optional(v.string()),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_group", ["groupId"]),

  voucherTypes: defineTable({
    name: v.string(),        // Purchase, Payment
    abbr: v.string(),        // PUR, PAY
    sort: v.number(),
  }).index("by_name", ["name"]),

  vouchers: defineTable({
    typeId: v.id("voucherTypes"),
    voucherNo: v.number(),
    fy: v.string(),                 // "2026-27" — numbering restarts each year
    date: v.number(),
    // The party the voucher is about. Denormalised so the day book and the
    // outstanding report do not have to walk every entry to find it.
    partyLedgerId: v.id("ledgers"),
    refNo: v.optional(v.string()),  // supplier's bill / receipt number
    narration: v.optional(v.string()),
    // Tally cannot file a bill it has no amount for. This can: a pending
    // voucher carries no entries, so it touches no balance, and shows up in
    // its own queue until someone prices it.
    status: v.union(v.literal("final"), v.literal("pending")),
    amount: v.optional(v.number()),
    attachments,
    // Carried over from the photograph when the bill was approved.
    tags: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_party", ["partyLedgerId"])
    .index("by_status", ["status"])
    .index("by_type_fy", ["typeId", "fy"]),

  voucherEntries: defineTable({
    voucherId: v.id("vouchers"),
    ledgerId: v.id("ledgers"),
    side: v.union(v.literal("Dr"), v.literal("Cr")),
    amount: v.number(),
    date: v.number(),   // copied from the voucher so ledger reads stay flat
  })
    .index("by_voucher", ["voucherId"])
    .index("by_ledger", ["ledgerId"]),

  /**
   * Deleted vouchers, kept whole. A delete moves the voucher and its Dr/Cr
   * lines here rather than destroying them: the books stop counting it at
   * once, and it can be put back exactly as it was, bill photo included.
   * Only an explicit purge actually destroys anything.
   */
  trash: defineTable({
    typeId: v.id("voucherTypes"),
    voucherNo: v.number(),
    fy: v.string(),
    date: v.number(),
    partyLedgerId: v.id("ledgers"),
    refNo: v.optional(v.string()),
    narration: v.optional(v.string()),
    status: v.union(v.literal("final"), v.literal("pending")),
    amount: v.optional(v.number()),
    attachments,
    tags: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
    // The lines as they stood, so a restore puts every balance back.
    entries: v.array(
      v.object({
        ledgerId: v.id("ledgers"),
        side: v.union(v.literal("Dr"), v.literal("Cr")),
        amount: v.number(),
      })
    ),
    deletedAt: v.number(),
  }).index("by_deletedAt", ["deletedAt"]),

  /**
   * Everything that has ever been done to these books, in order. Nothing here
   * is ever removed — not by a delete, not by a purge, not by a wipe. A ledger
   * you cannot audit is just a spreadsheet with extra steps.
   */
  history: defineTable({
    at: v.number(),
    action: v.string(),          // voucher.create, ledger.update, admin.wipe …
    summary: v.string(),         // one line, as a person would say it
    entity: v.optional(v.string()),
    entityId: v.optional(v.string()),
    detail: v.optional(v.string()),   // before/after, as JSON
  }).index("by_at", ["at"]),

  /**
   * Photos taken on the phone that have not been filed against a voucher yet.
   * The phone's whole job is to get the picture into the shop's hands the
   * moment it is taken; deciding which bill it belongs to happens at the
   * counter, on a screen big enough to read a ledger.
   */
  inbox: defineTable({
    storageId: v.id("_storage"),
    at: v.number(),
    note: v.optional(v.string()),
    // Colour marks on the bill itself, stamped at the moment it is
    // photographed where the shop has asked for that, and carried onto the
    // voucher when it is approved — a mark that stopped at the queue would be
    // no use for telling this week's pile from the backlog afterwards.
    tags: v.optional(v.array(v.string())),
    // Pages of one bill photographed in a run share this. Set on the phone at
    // the moment of shooting, because that is the only place anyone knows the
    // second sheet belongs to the first.
    groupId: v.optional(v.string()),
  })
    .index("by_at", ["at"])
    .index("by_group", ["groupId"]),

  /**
   * The shop's own settings. One row, keyed "shop".
   *
   * What the seven colours mean is the shop's business, so this is where the
   * shop says it: "green" is called whatever they call it. `autoTag` is the
   * mark put on every photograph as it is taken — the point of which is that
   * marking today's pile has to cost nothing at the counter, or it will not
   * happen.
   */
  settings: defineTable({
    key: v.string(),
    tagNames: v.optional(v.array(v.object({ id: v.string(), name: v.string() }))),
    autoTag: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /**
   * Papers that are not vouchers.
   *
   * A supplier's statement of account is the case this was made for: it is
   * evidence about an account rather than a transaction on it, and posting it
   * would double every bill and payment it lists. It has no amount, no Dr and
   * no Cr — it is filed against the party and kept, and it is read by a person
   * reconciling the account, not by the ledger.
   */
  papers: defineTable({
    ledgerId: v.id("ledgers"),
    kind: v.literal("statement"),
    documents: attachments,
    // What the paper covers and what it closed at, where they were read off
    // it — the two figures a reconciliation actually needs.
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    closing: v.optional(v.number()),
    note: v.optional(v.string()),
    at: v.number(),
  }).index("by_ledger", ["ledgerId"]),

  // What the model made of a photographed bill, before anyone approved it.
  readings: defineTable({
    inboxId: v.id("inbox"),
    groupId: v.optional(v.string()),
    status: v.union(
      v.literal("reading"),
      v.literal("ready"),
      v.literal("failed"),
      // Set aside on purpose: something about the slip does not add up and
      // guessing would put a wrong figure on a real account. Kept out of the
      // working queue so a pile can be finished, and never posted from here.
      v.literal("doubt")
    ),
    doubtNote: v.optional(v.string()),
    draft: v.optional(v.any()),
    error: v.optional(v.string()),
    model: v.optional(v.string()),
    ms: v.optional(v.number()),
    at: v.number(),
  })
    .index("by_inbox", ["inboxId"])
    .index("by_status", ["status"]),

  /**
   * What the shop has taught the reader.
   *
   * Every correction made while reviewing is kept and fed back into the next
   * prompt, so the same mistake is made once. `alias` maps a spelling seen on
   * paper to a real ledger; `rule` is a sentence typed by hand; `correction`
   * is the field-level record of what was changed and to what.
   */
  lessons: defineTable({
    kind: v.union(v.literal("alias"), v.literal("rule"), v.literal("correction")),
    field: v.optional(v.string()),
    wrong: v.optional(v.string()),
    right: v.optional(v.string()),
    note: v.optional(v.string()),
    ledgerId: v.optional(v.id("ledgers")),
    active: v.boolean(),
    at: v.number(),
  }).index("by_at", ["at"]).index("by_kind", ["kind"]),

  /**
   * The lines off a bill, kept beside the voucher they were approved into.
   *
   * The ledger only needs one figure per voucher, but the slip says what was
   * actually bought — "19mm S, 8x4, 2 Pc". Thrown away at approval that is gone
   * for good, so it is kept here in rows rather than prose: what moved, how
   * much of it, at what price, on whose account. Enough to build stock or
   * price history on later without photographing anything twice.
   */
  billLines: defineTable({
    voucherId: v.id("vouchers"),
    partyLedgerId: v.id("ledgers"),
    date: v.number(),
    lineNo: v.number(),
    desc: v.string(),
    qty: v.optional(v.string()),
    rate: v.optional(v.string()),
    amount: v.optional(v.number()),
    // Where the line came from, so a machine read is never mistaken for a
    // figure somebody checked.
    source: v.union(v.literal("read"), v.literal("manual")),
    createdAt: v.number(),
  })
    .index("by_voucher", ["voucherId"])
    .index("by_party", ["partyLedgerId"])
    .index("by_date", ["date"]),

  counters: defineTable({
    name: v.string(),
    value: v.number(),
  }).index("by_name", ["name"]),
})
