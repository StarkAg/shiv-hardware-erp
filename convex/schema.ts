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

const statusField = v.union(v.literal("final"), v.literal("pending"), v.literal("received"));

/**
 * How a delivery and its bill find each other.
 *
 * On a Goods Received Note: who counted the goods, and the purchase that
 * finally billed them. On a purchase: the deliveries it bills — one bill often
 * covers two or three drops. A link to a voucher that has since gone to the
 * trash counts as no link, so deleting a purchase puts its deliveries back on
 * Bills to Come by itself.
 */
const receiptFields = {
  receivedBy: v.optional(v.string()),
  billedIn: v.optional(v.id("vouchers")),
  fromReceipts: v.optional(v.array(v.id("vouchers"))),
  // What the checks said when the bill was saved against its deliveries.
  checks: v.optional(v.array(v.string())),
  // On the receipt written by itself for a W/B sale: that sale's BILL-n
  // reference. The reference, not the voucher id, because a voucher put back
  // from the trash comes back under a new id and its bill number does not.
  paysFor: v.optional(v.string()),
};

export default defineSchema({
  // The devices and servers allowed to call this deployment (convex/devices.ts).
  trustedDevices: defineTable({
    name: v.string(),
    app: v.string(),
    kind: v.union(v.literal('device'), v.literal('server')),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  }),
  // Wrong PINs, so guessing it is paused after a few.
  pinAttempts: defineTable({ at: v.number() }).index('by_at', ['at']),

  // ── Bills backup (single-row snapshot; all bills incl. drafts) ────────────
  // Now only the running bill number and when a bill last changed; the bills
  // themselves are in `bills`. `bills` here is what is left from before the
  // move, and is emptied by `bills:moveToRows`.
  billsStore: defineTable({
    bills:   v.optional(v.array(v.any())),
    billSeq: v.number(),
    savedAt: v.number(),
  }),

  /** One row per bill, kept whole in the panel's own shape. See lib/billRows. */
  bills: defineTable({
    billId: v.string(),
    number: v.string(),
    updatedAt: v.number(),
    bill: v.any(),
  })
    .index("by_bill", ["billId"])
    .index("by_number", ["number"]),

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
    // Counted up on every save. A device saves against the version it last
    // had, so an old copy cannot replace a newer list (see catalog.save).
    version:         v.optional(v.number()),
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

  /**
   * A customer's claim on a guarantee card, sent from the card's page (the QR).
   * Only someone holding the card's secret can file one; the shop reviews it in
   * the panel and the customer sees its status on the same page.
   */
  guaranteeClaims: defineTable({
    /** GC-2026-0016-C1: the card's number and this card's claim count. */
    ref: v.string(),
    cardId: v.id('guaranteeDocuments'),
    number: v.string(),
    name: v.string(),
    phone: v.string(),
    email: v.string(),
    address: v.string(),
    itemIndex: v.number(),
    itemLabel: v.string(),
    doors: v.number(),
    // 'cracks' is no longer covered or accepted (guaranteeClaims.ts); kept for claims filed before.
    issue: v.union(v.literal('borer'), v.literal('air'), v.literal('cracks')),
    description: v.string(),
    /** Proof the claimant holds the originals, and that this door is this card's. */
    cardPhoto: v.id('_storage'),
    billPhoto: v.id('_storage'),
    doorPhoto: v.id('_storage'),
    /** Close-ups of the damage, 1 to 3. */
    photos: v.array(v.id('_storage')),
    status: v.union(v.literal('new'), v.literal('reviewing'), v.literal('approved'), v.literal('rejected'), v.literal('replaced')),
    /** What the shop tells the customer (shown on the card page). */
    note: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_card', ['cardId', 'createdAt'])
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
    unpaidLeaves: v.optional(v.any()), // leave is an unpaid N in the older attendance app
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
    staffPaymentId: v.optional(v.string()),
  }).index('by_date', ['date']),

  // Tracking starts explicitly so previously settled wages are never invented
  // from old attendance. Rates are dated; a raise cannot reprice old work.
  staffPayProfiles: defineTable({
    staff: v.string(),
    startDate: v.string(),
    openingDue: v.number(),
    openingAdvance: v.number(),
    rates: v.array(v.object({ from: v.string(), rate: v.number() })),
    /**
     * A fixed amount earned at the end of every month, on top of the days.
     *
     * One man is on 800 a day plus 1,200 at month end; the rest are on days
     * alone. It was being remembered and paid by hand each month, which is a
     * thing that gets forgotten in a busy September. Earned on the last day of
     * the month, in full — it is a standing arrangement, not something the
     * attendance sheet pro-rates.
     */
    monthly: v.optional(v.number()),
    ledgerId: v.id('ledgers'),
    createdAt: v.number(),
  }).index('by_staff', ['staff']),

  staffPayments: defineTable({
    requestId: v.string(),
    staff: v.string(),
    date: v.string(),
    kind: v.union(v.literal('wage'), v.literal('advance')),
    amount: v.number(),
    mode: v.union(v.literal('cash'), v.literal('online')),
    note: v.string(),
    at: v.number(),
    voided: v.optional(v.boolean()),
    voidedAt: v.optional(v.number()),
  }).index('by_request', ['requestId']).index('by_staff_date', ['staff', 'date']),

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
    staffPaymentId: v.optional(v.string()),
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
    .index('by_voucher', ['voucherId'])
    .index('by_updated_at', ['updatedAt']),

  /** New work only: one card for a real bill, with accounting and fulfillment
   * kept separate. Each source id is indexed so retries and later links reuse
   * the same card instead of creating another. */
  billFlows: defineTable({
    flowKey: v.string(),
    documentKind: v.union(v.literal('sale'), v.literal('purchase'), v.literal('grn'),
      v.literal('receipt'), v.literal('payment'), v.literal('unknown')),
    party: v.string(),
    date: v.string(),
    amount: v.optional(v.number()),
    cashEntryId: v.optional(v.string()),
    voucherId: v.optional(v.id('vouchers')),
    cashVoucherId: v.optional(v.id('vouchers')),
    billId: v.optional(v.string()),
    jobId: v.optional(v.string()),
    photos: v.array(v.id('_storage')),
    expectedPhotos: v.optional(v.number()),
    photoBatchId: v.optional(v.string()),
    intakeStatus: v.union(v.literal('none'), v.literal('uploading'), v.literal('waiting'), v.literal('reading'),
      v.literal('ready'), v.literal('failed'), v.literal('converted')),
    readDraft: v.optional(v.any()),
    readError: v.optional(v.string()),
    route: v.union(v.literal('unset'), v.literal('handover'), v.literal('rack'),
      v.literal('order'), v.literal('fabrication'), v.literal('mixed')),
    tasks: v.any(),
    stage: v.string(),
    measurements: v.optional(v.any()),
    history: v.array(v.object({ at: v.number(), action: v.string() })),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_key', ['flowKey'])
    .index('by_cash_entry', ['cashEntryId'])
    .index('by_voucher', ['voucherId'])
    .index('by_bill', ['billId'])
    .index('by_updated_at', ['updatedAt']),

  // ── The evening count, one per closed day ─────────────────────────────────
  cashCloses: defineTable({
    date: v.string(),
    counted: v.number(),
    cashCounts: v.optional(v.record(v.string(), v.number())),
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
    cashCounts: v.optional(v.record(v.string(), v.number())),
    bankBalances: v.optional(v.record(v.string(), v.number())),
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
    // The carpenter or mistri who brings this customer in, and is owed a cut
    // of what they buy. Most accounts have nobody: a walk-in owes no
    // commission to anybody, so this is unset for them and the ledger shows
    // nothing about commission at all. Naming somebody here is what turns the
    // per-bill tick on for this account.
    commissionTo: v.optional(v.string()),
    // Where this party's bills physically live once they are sorted, stapled
    // and filed — the answer to "Raj Kumar ka bill dikhao" that no amount of
    // searching the books can give. Set once, when the folder is made.
    folder: v.optional(
      v.object({ cabinet: v.string(), drawer: v.string(), no: v.number() })
    ),
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
    //
    // `received` is a Goods Received Note: the goods are in the shop, the
    // supplier's bill is not. It never carries entries — nothing is owed on
    // paper until the bill comes — and it waits on Bills to Come until a
    // purchase is written against it.
    status: statusField,
    amount: v.optional(v.number()),
    attachments,
    // Carried over from the photograph when the bill was approved.
    tags: v.optional(v.array(v.string())),
    // Whether the commission on this bill has been handed over to whoever
    // brought the customer (ledgers.commissionTo). Unset means not yet — and
    // on an account that owes nobody a commission it stays unset forever and
    // is never asked about.
    commissionPaid: v.optional(v.boolean()),
    // The server's count of saves that changed what the voucher posts. A
    // counter saving a copy it opened at an older count is refused, rather
    // than writing an old amount over a newer save from another counter.
    rev: v.optional(v.number()),
    ...receiptFields,
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
    status: statusField,
    amount: v.optional(v.number()),
    attachments,
    tags: v.optional(v.array(v.string())),
    // Carried over whole from the voucher: without these a voucher with its
    // commission marked could not be deleted at all.
    commissionPaid: v.optional(v.boolean()),
    rev: v.optional(v.number()),
    ...receiptFields,
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
    queueNo: v.optional(v.number()),
    /**
     * Which physical stack this photograph's slip went onto — "A", "B".
     *
     * Two people can photograph a thousand bills each at the same time, each
     * building their own stack, and the stack a slip is in is known here and
     * nowhere else: it is decided by whose hand is holding the phone, before
     * the shutter. Carried onto the filing row when the bill is approved.
     */
    stack: v.optional(v.string()),
  })
    .index("by_at", ["at"])
    .index("by_group", ["groupId"]),

  /** Photos from the separate voucher shooter, awaiting a bill or voucher. */
  voucherInbox: defineTable({
    storageId: v.id("_storage"),
    at: v.number(),
    groupId: v.string(),
    queueNo: v.optional(v.number()),
  }).index("by_at", ["at"]),

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

  /**
   * Every run of the nightly backup, good or bad. The backup lives outside
   * this database (a disk on Railway), so this is how the panel knows it
   * happened — and says so on Home when it has not.
   */
  backupRuns: defineTable({
    at: v.number(),
    ok: v.boolean(),
    kind: v.union(v.literal("tables"), v.literal("full")),
    file: v.optional(v.string()),
    bytes: v.optional(v.number()),
    vouchers: v.optional(v.number()),
    /** Items the copy held. The whole inventory is one row, so a row count
     *  cannot tell an empty list from a full one. */
    items: v.optional(v.number()),
    /** Saved, but holding noticeably less than the copy before it. */
    warning: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_at", ["at"]),

  /**
   * Two My Items entries the shop has said are one item.
   *
   * The same board is bought and sold under different names — SRT bills it
   * "12mm S 8 X 4" and the counter sells "12mm SG 8 X 4" — and a customer's
   * bill must keep the name the customer was given. Most of that is settled by
   * renaming the supplier's entry into the shop's (see `itemFold.ts`), but not
   * all of it can be: the shop sells one door under two names of its own, and
   * a line here and there points at an entry since deleted. Those are said
   * outright, one pair at a time.
   *
   * `from` and `to` are the references `src/lib/profit.ts` builds — "id:<My
   * Items id>" for a line picked from the list, "name:<folded name>" for one
   * typed freehand. Chains are followed to the end, so it does not matter
   * which way round a pair was added.
   */
  itemSame: defineTable({
    from: v.string(),
    to: v.string(),
    /** What each was called when the shop paired them, for the list. */
    fromLabel: v.string(),
    toLabel: v.string(),
    updatedAt: v.number(),
  }).index("by_from", ["from"]),

  /**
   * What an item cost, where the bills cannot say it by themselves.
   *
   * Not the same as saying two entries are one item. A 20 kg drum of Fevicol
   * is not a 1 kg pack — it is twenty of them, and `per` says so. This is for
   * one thing priced from another, and for stock bought before the panel
   * existed, where there is no purchase to point at and a rate has to be
   * typed.
   */
  itemCosts: defineTable({
    ref: v.string(),
    /** The name it was carrying when the shop set this, for the list. */
    label: v.string(),
    /** A rate per unit as sold, typed at the counter. */
    cost: v.optional(v.number()),
    /** The item it is bought as, when it is bought as another. */
    sameAs: v.optional(v.string()),
    /** That item's name, so the row reads without a second lookup. */
    sameAsLabel: v.optional(v.string()),
    /** How many of that item make one of this. One if not said. */
    per: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_ref", ["ref"]),

  /**
   * Sorting the paper: one row per photographed bill, saying where it goes.
   *
   * The books know what every bill says; this is the only thing that knows
   * where the paper itself is. It exists because a few thousand loose slips
   * cannot be turned into customer bundles by hand without the app calling out
   * a card number for each one — see `src/lib/filing.ts` for why that is done
   * in two sweeps rather than one card per customer.
   */
  filing: defineTable({
    voucherId: v.id("vouchers"),
    partyLedgerId: v.id("ledgers"),
    /**
     * When the slip was photographed — which is the order the physical stack
     * is in, and the whole reason this field exists rather than reading
     * `_creationTime`. Bills are approved at the counter in whatever order the
     * reads finish and the shop gets to them, so approval order and stack
     * order are different orders. Sorting on the wrong one would send every
     * bill after the first mismatch to the wrong customer.
     */
    capturedAt: v.number(),
    /**
     * The slot this bill was put in, given when the paper itself was placed.
     *
     * Not when it was named. A customer holds their slot until their packet
     * goes into their folder, so a slot given out at naming time would be held
     * for a customer whose paper is still in the stack — name two hundred bills
     * before placing any and forty slots are gone with nothing on the table.
     * Spending a slot only as paper reaches it is what keeps the table small.
     *
     * Empty means not placed yet, or placed while every slot was full.
     */
    slot: v.optional(v.number()),
    stage: v.union(
      // Named and back on the stack. The books know whose it is; the paper has
      // not moved yet and no slot is being held for it.
      v.literal("named"),
      // In a slot on the table, gathering the rest of that customer's bills.
      v.literal("slotted"),
      // Named while every slot was taken; waiting for one to come free.
      v.literal("waiting"),
      // The packet has gone into the customer's folder and the slot is free.
      v.literal("filed")
    ),
    /**
     * Which physical stack this slip is in — "A", "B", "C".
     *
     * One shared stack would have three people reaching into the same pile and
     * the quick ones waiting on the slow. So the paper is cut into stacks of a
     * size a person can hold, each wearing a lettered card, and whoever is free
     * takes the next one nobody is on. Stacks are contiguous runs of
     * `capturedAt`, which is what lets a boundary be nudged when it turns out
     * to be a slip or two off.
     */
    stack: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_capturedAt", ["capturedAt"])
    .index("by_stage_capturedAt", ["stage", "capturedAt"])
    .index("by_stack_capturedAt", ["stack", "capturedAt"])
    .index("by_slot", ["slot"])
    .index("by_party", ["partyLedgerId"])
    .index("by_voucher", ["voucherId"]),

  /**
   * The sorting plan in force, one row keyed "current".
   *
   * Which customers were put in which bucket is written onto the filing rows
   * themselves, and which bucket is on whose table is on the station. This is
   * the rest of it: how many cards the plan was drawn for, and how far through
   * the sweeps the shop has got.
   */
  /**
   * A bookmark given to a customer before any of their paper has been named:
   * added by name on the sort app's Ledger screen, so the number can be written
   * on a card and the table laid out ahead of the stack. Counts as taken for
   * numbering, so the customer's first named slip lands on this same bookmark,
   * and goes back when their packet is filed (or when the hold is freed).
   */
  filingHolds: defineTable({
    partyLedgerId: v.id("ledgers"),
    slot: v.number(),
    at: v.number(),
  })
    .index("by_party", ["partyLedgerId"])
    .index("by_slot", ["slot"]),
  // Customers ticked off on the Sort app's Ledger (tapped while sorting a
  // stack), shared by every phone until somebody presses Reset.
  // Inventory site: what the shelf held when somebody counted it. Stock is the
  // last count plus the bills after it (convex/inventory.ts).
  stockCounts: defineTable({
    ref: v.string(),
    qty: v.number(),
    day: v.string(),
    at: v.number(),
    note: v.optional(v.string()),
  }).index("by_ref", ["ref"]),
  // One row for every device-side stock tap. Keeping the operation ID makes a
  // retry after a dropped connection safe: the quantity is changed only once.
  inventorySyncOps: defineTable({
    operationId: v.string(),
    ref: v.string(),
    delta: v.union(v.literal(-1), v.literal(1)),
    qty: v.number(),
    at: v.number(),
  }).index("by_operation", ["operationId"]),
  // Inventory site: per item reorder level, rack/shelf, main unit and pack
  // sizes ({ Box: 10 } — one Box is ten of the main unit).
  inventoryProducts: defineTable({
    ref: v.string(),
    name: v.string(),
    category: v.union(v.literal("ply"), v.literal("door"), v.literal("other")),
    brand: v.string(),
    mm: v.optional(v.number()),
    label: v.optional(v.string()),
    size: v.string(),
  }).index("by_ref", ["ref"]),
  stockItems: defineTable({
    ref: v.string(),
    min: v.optional(v.number()),
    place: v.optional(v.string()),
    unit: v.optional(v.string()),
    packs: v.optional(v.record(v.string(), v.number())),
    note: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_ref", ["ref"]),
  sortMarks: defineTable({
    partyLedgerId: v.id("ledgers"),
    at: v.number(),
  }).index("by_party", ["partyLedgerId"]),

  filingPlan: defineTable({
    key: v.string(),
    /** How many slots are laid out on the table — thirty or forty, reused. */
    /**
     * How many bookmarks are laid out, when the table is a fixed size.
     *
     * Absent means unlimited: a customer new to the table always gets a
     * bookmark, and the numbers run as high as the sort needs. That is the
     * default, because the alternative — being told the table is full partway
     * through a stack of two thousand slips — stops the sorting dead.
     */
    slotCount: v.optional(v.number()),
    madeAt: v.number(),
  }).index("by_key", ["key"]),

  /**
   * A fabrication job, from the counter estimate to the finished work order.
   *
   * One record, one number, moving through states — because the shop's paper
   * version is three separate sheets (letterhead estimate, the mechanic's site
   * measurements, the pink order pad) and the money moves between them without
   * anybody having to agree to it. Here the jump is a screen somebody presses.
   *
   * The document halves are kept loose, the way quotations are: what a job
   * holds changes as the shop's products do, and a migration per rate change
   * is not worth the tidiness.
   */
  jobs: defineTable({
    jobId: v.string(),            // the id the device gave it
    number: v.string(),           // the pad number, e.g. "758"
    status: v.string(),           // estimate | measured | confirmed | ordered | delivered | billed
    customer: v.any(),            // { name, mobile, address }
    estimate: v.any(),            // { lines: [], total } — nominal sizes, counted at the counter
    openings: v.any(),            // [] — what the mechanic measured on site
    order: v.any(),               // { lines: [], total, advance, fare, deliveryDate }
    variance: v.any(),            // what the nominal sizes cost, logged at Accept
    at: v.number(),
    updatedAt: v.number(),
    deleted: v.boolean(),
  })
    .index('by_job_id', ['jobId'])
    .index('by_number', ['number'])
    .index('by_updated_at', ['updatedAt']),

  counters: defineTable({
    name: v.string(),
    value: v.number(),
  }).index("by_name", ["name"]),

  /**
   * Mica Match: one laminate chip from a catalog, read off a phone photo.
   *
   * A sheet is seldom one colour, so it is kept as its main shades — each a
   * CIE L*a*b* colour and the share of the square it covers — plus how busy
   * the pattern is, from 0 (plain) up. The colours are measured after the
   * photo is corrected against the white paper around the chip, so chips shot
   * on different days under different light compare fairly.
   */
  micaChips: defineTable({
    brand: v.string(),
    catalog: v.optional(v.string()),
    code: v.string(),
    finish: v.optional(v.string()),
    shades: v.array(v.object({ L: v.number(), a: v.number(), b: v.number(), w: v.number() })),
    texture: v.number(),
    // Whether a white reference was found beside the chip; without one the
    // colours are the camera's own and less trustworthy.
    corrected: v.boolean(),
    photo: v.optional(v.id("_storage")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brand", ["brand"])
    .index("by_code", ["code"]),

  /**
   * Workshop: a work order as a conversation, in pictures (convex/workshop.ts).
   *
   * One row is one job and its whole thread: the counter's photographs of the
   * order, the workshop's photographs of the measurements, and any line typed
   * with them. A thread is a handful of messages, so they live on the row and
   * one read gives a phone everything it shows.
   */
  workshopJobs: defineTable({
    number: v.number(),
    // Who it is for: the customer's account in the books when the counter
    // picked one (its name and phone are then read from the account, so a
    // correction in the panel shows here), else whatever was typed.
    ledgerId: v.optional(v.id('ledgers')),
    title: v.optional(v.string()),
    status: v.union(v.literal('open'), v.literal('done')),
    messages: v.array(v.object({
      id: v.string(),
      from: v.union(v.literal('shop'), v.literal('workshop')),
      photos: v.array(v.id('_storage')),
      text: v.optional(v.string()),
      // The device it was sent from, as the Trusted devices list names it.
      by: v.optional(v.string()),
      at: v.number(),
    })),
    // When each side last had the thread open: what came after is new to it.
    shopSeenAt: v.number(),
    workshopSeenAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_status_updated', ['status', 'updatedAt']),
})
