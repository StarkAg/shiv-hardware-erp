# Bank prints (SBI's PDFs) and the Printers screen

SBI's PDFs (`SBIDocument_*.pdf`) print by themselves, black and white, when
they are posted in the shop WhatsApp group or saved to Downloads on the shop PC.

**Where they print** is chosen on the Counter's **Printers** screen (Shop >
Printers): tap a printer and the bank PDFs go there. The choice is kept by
the print server in `print-server/data/bank-printer.json` (this PC only, not
committed). Until one is chosen they go to the Epson (`COLOR_PRINTER`); the
owner asked for the Epson on 26 Nov 2026. Before that they went to the HP.

- If the chosen printer is offline they print on the other shop printer; if
  both are offline they wait and print when one is back (Downloads), or the
  job fails and shows in the online queue (group).
- A PDF posted with "cp" still prints in colour on the Epson.
- On the Epson they print from the rear paper feeder in black and white
  (`BW_FALLBACK_PRINT_SETTINGS`).
- Which names count as bank prints: `BANK_PRINT_NAMES` in `print-server/.env`
  (default `SBIDocument_*.pdf`).

**Online / offline** on that screen: Windows alone says "Normal" for a Wi-Fi
printer that is switched off, so the print server also knocks on the printer's
address (port 80, 631 or 9100). A printer that does not answer within 1.5 s is
offline. The address comes from the printer's Windows port, or the location a
Wi-Fi (WSD) printer gave Windows, or `PRINTER_IPP_URLS`. A USB printer, or one
on an Epson port with no address, is judged by Windows' own state only.

Code: `print-server/bank-print.mjs` (routes `GET /printers/status`,
`POST /printers/bank` in `server.mjs`), screen `src/features/print/Printers.tsx`.

## The Epson after a Windows reinstall

On 18 Nov 2026 Windows was reinstalled and the Epson was left with Windows'
basic "Epson ESC/P-R V4 Class Driver", which has no Disc/ID Card Tray, so PVC
cards would not print, and Epson Photo+ was gone. Fixed by installing Epson's
L8050 driver (3.80.05) and Epson Photo+ from Epson's L8050 support page. That
added a second queue, "EPSON L8050 Series", beside "EPSONE46549 (L8050
Series)"; both now use the Epson driver and have the card tray.
