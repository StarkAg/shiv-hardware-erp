# Panel attachment and route audit — 1 October 2026

## Shipped behavior

- Voucher, ledger, day book, quotation, mobile, trash, bill queue, and goods-received attachments open in one in-page preview. Photos and PDFs support navigation, zoom, rotation, download, and Escape to close. The standalone PDF reader still opens local PDFs and changes pages.
- The quotation form accepts bill photos from the computer and from the separate voucher shooter queue. Saved quotations show a paperclip in the quotations list. A sale moved to a quotation retains its attachments and includes newly selected photos.
- The phone queue shows four-digit numbers. Its photo tile shows a second magnified pane on hover without moving the voucher page; clicking that pane opens the full preview. The pane closes when the pointer leaves. Deletion requires typing `delete`.
- The voucher photo area now shows a loading message while the phone queue connects, and an explicit empty message if the queue is empty. This avoids presenting a temporarily blank area as if no photos exist.
- The voucher shooter remains at `shivhardware-voucher.vercel.app`; the bill sorter remains a separate site at `shivhardware-sort.vercel.app`. The panel's unread/read-price dashboard cards point to the sorter.
- The account ledger's action column stays visible when its table scrolls. A sale without goods lines defaults to paid in full unless an explicit received amount, including zero, was entered.
- Older `/ledger/bills` bookmarks still open the pending bills and photograph stages. The Bills menu item is hidden; the dashboard's unpriced-voucher card opens the Day Book. The cash waiting screen renders the account picker only for the row being edited.

## Verification

- `npm test -- --run`: 501 tests passed in 37 files.
- `npm run build`: TypeScript and Vite build passed.
- `scripts/verify-attachments.mjs`: browser checks passed for image and PDF previews, rotation, zoom, page navigation, keyboard close/focus, error/empty states, mobile layout, and conversion of a 14-page PDF; no attachment opened a new tab.
- `scripts/audit-panel-routes.mjs`: 28 routes checked against both local and production panel at 1440×1000. No route rendered an error screen, overflowed horizontally, or contained a broken image. The main entry forms, quotation list, cash screens, party accounts, trial balance, bills, goods receiving, trash, mobile view, and PDF reader were included.
- Production quotation form: selected a local photo, opened it in the in-page modal, and closed it with Escape while remaining on the quotation form. No JavaScript error occurred.
- Production phone queue: confirmed 13 waiting photos grouped as 12 bills, with four-digit queue numbers. Hover showed the second pane, clicking it opened the full modal, and moving the pointer away removed the pane. The delete dialog required `delete` and kept its action disabled before typing. No queued photo was deleted during the check.
- Production Convex functions and `https://shiv-panel.vercel.app/` were deployed and verified. The separate voucher shooter and sorter sites both responded successfully.

## Environment-dependent observation

The web panel's Printer Queue reported the shop's local print service as unavailable in an external browser. The page showed its offline state; the browser also logged connection/private-network errors for the local printer address. Printing requires the service to be reachable from the shop network or installed panel.
