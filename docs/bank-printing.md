# Where prints go: the Printers screen (bank PDFs, quotations)

The Counter's **Printers** screen (Shop > Printers) sets, for each job:

- **Printer**: where it prints.
- **Colour / B&W**.
- **If offline, print on**: the fallback printer used when the first is
  offline, or "No fallback: wait".

Jobs on it (owner's ask, 26 Nov 2026):

- **Quotations**, from the Quote screens.
- **Bank PDFs (SBI)**: `SBIDocument_*.pdf` posted in the shop WhatsApp group or
  saved to Downloads on the shop PC. They print by themselves.

Until changed, both go to the Epson in colour, falling back to the HP. Bank
PDFs went to the HP in black and white before that day. The choices are kept by
the print server in `print-server/data/print-routes.json` (this PC only, not
committed; an earlier `data/bank-printer.json` is read once if there is no
routes file).

- Both printers offline: a bank PDF from Downloads waits and prints when one is
  back; a quotation or a group PDF fails there (the group one shows in the
  online queue).
- The HP LaserJets print black only: a job set to colour comes out black and
  white on them.
- On the Epson both print from the rear paper feeder; quotations keep their
  best quality (`QUOTATION_PRINT_SETTINGS`), bank PDFs use
  `WHATSAPP_COLOR_PRINT_SETTINGS`. Colour or B&W is set from the screen.
- A bank PDF posted with "cp" prints as an ordinary colour print, not by its route.
- Which names count as bank prints: `BANK_PRINT_NAMES` in `print-server/.env`
  (default `SBIDocument_*.pdf`).
- Guarantee cards always print on the Epson's ID card tray, never re-routed.

**Online / offline** on that screen: Windows alone says "Normal" for a Wi-Fi
printer that is switched off, so the print server also knocks on the printer's
address (port 80, 631 or 9100). A printer that does not answer within 1.5 s is
offline. The address comes from the printer's Windows port, or the location a
Wi-Fi (WSD) printer gave Windows, or `PRINTER_IPP_URLS`. A USB printer, or one
on an Epson port with no address, is judged by Windows' own state only.

Code: `print-server/bank-print.mjs` (routes `GET /printers/status`,
`POST /printers/route` in `server.mjs`), screen `src/features/print/Printers.tsx`.

## Deploying it

The installed Shiv Counter takes its screens from **shiv-panel.vercel.app**,
not from the Counter site: deploy both (`npm run deploy -- --only counter,panel`).
On Windows the newer Vercel CLI keeps its login in
`%APPDATA%\com.vercel.cli\Data\auth.json`; `scripts/deploy.mjs` looks there too.

## The Epson after a Windows reinstall

On 18 Nov 2026 Windows was reinstalled and the Epson was left with Windows'
basic "Epson ESC/P-R V4 Class Driver", which has no Disc/ID Card Tray, so PVC
cards would not print, and Epson Photo+ was gone. Fixed by installing Epson's
L8050 driver (3.80.05) and Epson Photo+ from Epson's L8050 support page. That
added a second queue, "EPSON L8050 Series", beside "EPSONE46549 (L8050
Series)"; both now use the Epson driver and have the card tray.
