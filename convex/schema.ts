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

export default defineSchema({
  // ── Bills backup (single-row snapshot; all bills incl. drafts) ────────────
  billsStore: defineTable({
    bills:   v.array(v.any()),
    billSeq: v.number(),
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
    customer: v.any(),
    document: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_number', ['number'])
    .index('by_local_id', ['localId'])
    .index('by_created_at', ['createdAt']),

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
    updatedAt: v.number(),
  }),
})

