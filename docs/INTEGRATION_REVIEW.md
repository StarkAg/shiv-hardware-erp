**Shiv Panel integration review — 11 September 2026**

The sites share a Convex deployment, but they do not yet share all their accounting rules. The best next investment is to make every posted transaction update the same books through one server operation. More screens and graphs should follow that work.

**Completed in this change**

- One Trash destination at `/trash`. The ledger's duplicate tab and component have been removed; `/ledger/trash` redirects to the shared screen.
- One searchable list includes deleted bills and standalone vouchers, with document type, party, amount, deletion time and photos. Linked bill/voucher deletions appear once.
- New bill deletions record the exact deleted-voucher ID. Older deletions are paired only when their saved reference is unambiguous and their available party, date and amount agree. Existing unlinked records are not guessed into pairs.
- Restoring a linked bill restores the original voucher number and debit/credit lines in the same Convex mutation. An extra edit/save is no longer needed. Already-restored vouchers are not duplicated. Missing or ambiguous accounting links produce an error rather than silently restoring an incomplete pair.
- A PIN-protected permanent deletion of a linked bill also removes its deleted voucher. Standalone voucher purging retains its existing backend-only workflow.
- The preceding party-picker change is retained: ledger phone/Aadhaar fill into Bill Builder, and switching to a party without those fields clears the previous party's values.

**What I checked**

The route sweep covered quotations, quotation history, guarantee formats/history/bill selection, scanning, rates, inventory, legacy customers, transport, account masters, customer/supplier ledgers, photo-bill review, trial balance, day book, printer queue and PDF viewer. A second pass waited for real accounting data on seven routes, including the shared Trash and its old URL. Across both passes, 23 distinct main-panel routes were checked. No uncaught page errors were observed. The shared Trash also fit a 390px mobile viewport without page overflow. Evidence is in [the route-check results](../reports/site-review-2026-09-11.json).

Six isolated Convex tests cover linked delete/restore, standalone vouchers, old references, ambiguous links, repeated/already-completed restores, and PIN-protected paired purge. Frontend build and backend TypeScript/schema validation passed. These tests use synthetic records; no real transactions were deleted, restored or paid during review.

A read-only production snapshot contained 59 ledger accounts, 180 vouchers and one bill. It showed no duplicate normalised ledger names, duplicate voucher labels within a financial year, duplicate bill numbers, or positive-total non-draft bills missing a voucher by reference. This is a snapshot and a limited consistency check, not a certification of balances. Current absence of duplicates does not remove the numbering risks below.

Cash, stock, attendance, document sync and printing were traced in code. This was not an end-to-end financial audit, a physical printer test, or a test of every record-specific edit/upload flow.

**Recommended order of work**

| Priority | Confirmed finding | Best change and practical result |
| --- | --- | --- |
| 1 | Ordinary financial reads and writes have no user-identity/role check in the inspected Convex endpoints. Some destructive actions check a PIN, while the cashier entry lock is implemented in the browser. | Add individual staff sign-in and enforce permissions inside server queries/mutations. Separate owner, accountant, cashier and read-only access. A cashier's browser should not be able to edit arbitrary vouchers or read every Aadhaar record. |
| 2 | Bill Builder posts a voucher and saves its bill snapshot separately. It saves the bill even after posting fails. A missing posting account can return a truthy result with `voucherId: null`, which the caller does not reject. | One server-side posting command should validate and commit the document, accounting lines, attachment claims and audit event together. Keep failed work explicitly as an unposted draft with a visible retry action. “Saved” must mean the books were updated. |
| 3 | The two posting paths use different number counters: `voucher:<typeId>:<fy>` in the builder path and `vno:<abbr>:<fy>` in the ledger path. Bill numbers are also allocated from device state, and bill/voucher lookup often uses `BILL-<number>`. | Use one server-controlled counter per company/year/type, and link documents by stable IDs. Two PCs saving at once must get distinct numbers; retrying one save must not create a second voucher or replace a different year's bill. |
| 4 | Cashier entries live in `cashEntries` without voucher IDs or party-ledger IDs. Builder receipts/payments select Bank regardless of the draft's cash/online choice. Marking a sale as paid does not itself create a corresponding receipt. | Connect cash/UPI/bank movements to Receipt, Payment and Contra vouchers. Pick an actual Cash or Bank account. Match party payments to the relevant ledger and, where needed, invoice. Closing the drawer should reconcile against accounting cash, not a second independent book. |
| 5 | Cross-device bill sync merges records but does not propagate deletions. Empty remote bill lists are ignored. Server snapshot saves can overwrite newer bills with older device copies, and purging the trash removes the current deletion marker. Catalog saves replace the entire snapshot. | Use versioned record writes, durable deletion markers, server conflict checks and a visible offline queue. Delete on PC A must disappear on PC B; reconnecting an old device must not revive it or overwrite current prices. Keep deletion markers separate from disposable trash contents. |
| 6 | The legacy Customers screen reads the panel's local customer list; the books use `ledgers`. Bill posting resolves parties by name and only fills a missing phone. Aadhaar entered on a bill is not sent back through that posting API. | Make one party master with stable IDs and customer/supplier roles. Quotes, bills, cashier, guarantees and statements should select the same party. Update master contact details deliberately; do not silently overwrite a master from an old document. |
| 7 | Inventory and Stock share a catalog snapshot, but the posting paths do not create stock movements or link every bill line to a stock-item ID. Extracted item details alone are not a stock ledger. | Introduce stock-item IDs, units/conversions and quantity movements tied to posted purchases, sales, returns and adjustments. Editing/cancelling a voucher must adjust stock and accounts together. Add locations and valuation only after movement totals reconcile. |
| 8 | Party reports explicitly use running-account balances without allocating receipts to individual bills. Trial Balance groups Cash/Bank under “not maintained”. There is no common period-close control in the inspected posting mutations. | Add invoice allocations, due dates, ageing, bank reconciliation and a consistent as-of date/year selector. Maintain real Cash/Bank accounts, reconcile opening differences, then build trustworthy P&L and balance-sheet reports from the same entries. Lock completed periods with an owner-controlled correction flow. |
| 9 | Ledger mutations often write history, but `billLedger.postBill` does not use that history helper. The helper records no authenticated actor and swallows logging failures. Deleting a voucher directly can leave its source bill snapshot behind. | Give every document one lifecycle: draft, posted, corrected/cancelled, restored. Record who changed it and before/after values as part of the write. Apply the lifecycle to both the document and its accounting effects from every entry point. |
| 10 | Quotes/guarantees use the local store and an HTTP cloud-sync queue; bills/catalog use separate Convex snapshot sync. The main real-time sync component does not hydrate quote/guarantee history on another device. | Bring document history and conversion links into the shared backend. A quote should convert to a bill, then link to delivery/guarantee and collections without retyping the party or products. Preserve drafts as non-accounting documents. |

The cash example I would use as the first acceptance test: a ₹10,000 sale with a ₹4,000 cash receipt should show ₹10,000 sales, ₹4,000 more cash and ₹6,000 still due from that customer. It should show those same results on both PCs, in the cashier app, day book, party statement and trial balance. Printing or retrying the save must not add another transaction. This example assumes no tax or opening balance to keep the test unambiguous.

**Suggested navigation**

Use a business overview as the home screen, with today's sales, cash, receivables, payables, unposted drafts and pending documents. Keep five clear working areas: Transactions, Accounts, Stock, Reports and Settings. Trash stays a single shared destination. Keep quotation/guarantee/printing workflows readily accessible within the related document flows.

“Ledger” versus “Ledgers”, “Customers” versus ledger customers, and “Bills” versus scanned-bill review currently require the operator to know which former app owned the feature. Use labels such as “Party Accounts”, “Account Masters”, “Day Book” and “Document Inbox”. Keep one voucher editor with keyboard navigation, party search, account balance and a visible Draft/Posted state. Never make a successful-looking screen hide a failed backend write.

The photo-review and unpriced-bill workflow is useful and should stay. An unread or unpriced photo should remain a pending document until approved; it should not affect balances. Camera capture on another PC/phone needs a secure browser context: the plain HTTP Wi-Fi URL works for billing, while camera access requires HTTPS or the hosted app. The camera component already checks this condition.

**A practical delivery plan**

1. Stabilise transactions: authentication/roles, shared numbering, stable bill/voucher links, atomic posting and visible failure handling. Add synthetic integration tests for concurrent saves, retries and edits from both entry points.
2. Connect collections: one party master, Cash/Bank account selection, cashier-to-voucher posting, invoice allocations, cancellation/restore and drawer reconciliation.
3. Connect goods: item IDs, quantity movements, purchase/sales returns, units and stock reports. Reconcile quantities before introducing valuation dashboards.
4. Complete the operating system: document conversion, financial-year/report consistency, audit history, period locking and tested backup/restore. Add GST-specific invoicing/reporting only after agreeing the shop's required tax workflow; this review does not assess statutory compliance.
5. Simplify navigation and speed: use indexed/paginated backend queries rather than collecting entire tables, load large PDF/printing modules only where needed, and standardise loaders, errors and offline status.

A sensible release gate is a small synthetic day of sales, purchases, part payments, a return, an edit and a cancellation. Its expected balances and stock should reconcile in every screen. Repeat it from two browsers and with an interrupted connection before using the new shared posting path for normal shop work.

**Implementation evidence**

- [Two posting implementations and the builder counter](../convex/billLedger.ts#L27), [ledger counter and balanced entry writer](../convex/vouchers.ts#L47).
- [Bill save/post sequence and reference-based links](../src/features/bills/BillBuilder.tsx#L2035), [device numbering/deletion merge](../src/lib/store.ts#L288), [ignored empty snapshots](../src/components/ConvexSync.tsx#L29), [silent push failures](../src/lib/convexSync.ts#L23).
- [Independent cash writes](../convex/cash.ts#L27), [cash/account schemas](../convex/schema.ts#L216), [cash UI lock](../cash-web/src/App.jsx#L413), [catalog replacement](../convex/catalog.ts#L4).
- [Account master API](../convex/masters.ts#L57), [legacy customer UI](../src/features/customers/Customers.tsx#L5), [running-account and trial-balance report rules](../convex/reports.ts#L276).
- [History helper](../convex/lib/history.ts#L10), [document backend](../convex/documents.ts#L1), [document sync queue](../src/lib/offlineSync.ts#L47), [camera context check](../src/features/ledger/components/LiveCamera.jsx#L44).
- [Unified trash query](../convex/trash.ts#L7), [linked bill restoration](../convex/bills.ts#L120), [link matching](../convex/lib/trashLinks.ts#L3), [regression tests](../tests/trash.test.ts#L31).

**Tally reference points**

The recommended behaviour follows the relevant accounting workflows, rather than merely copying Tally's layout: [bill-wise payable tracking](https://help.tallysolutions.com/knowledgebase/manage-outstanding-payables-tally/), [voucher numbering](https://help.tallysolutions.com/use-voucher-numbering-methods/), [inventory movement](https://help.tallysolutions.com/tally/inventory-tally/) and [transaction/master edit logs](https://help.tallysolutions.com/tally-prime/edit-log/tracking-modifications/). These are benchmarks for the proposed design; this application is not currently feature-equivalent to Tally.
