# How a file gets onto paper (print server, Windows)

Since 2026-11-25 the print server needs nothing installed to print. SumatraPDF
was missing on the new shop PC, and every PDF and photo print failed on it.

Every print on Windows goes through `printFileWithLp` in `print-server/server.mjs`,
which tries these in order:

| Way | For | How | Speed (2-page PDF, measured on the shop PC) |
|---|---|---|---|
| Straight over IPP | printers listed in `PRINTER_IPP_URLS` (the HP) | `direct-print.mjs`: pdf.js draws each page (`raster.mjs`), packed as PCLm (or PWG raster for a printer without PCLm), sent chunked to the printer's own IPP address (`ipp.mjs`). No Windows driver. | 1 page: drawn 0.4 s, at the printer 1.0 s (job 28) |
| Windows' own | any other printer (the Epson), or the HP when its address does not answer | `tools/print-file.ps1`: Windows.Data.Pdf draws the pages, .NET System.Drawing.Printing prints them | about 3 s (8 s on the HP's generic IPP driver) |
| SumatraPDF | only with `PRINT_ENGINE=sumatra` | as before | |

## Why straight over IPP

The HP (LaserJet Tank MFP 2606sdw) does not read PDF or JPEG itself. It reads
`image/pwg-raster` (8-bit grey, 300 or 600 dpi), `image/urf` and
`application/PCLm`. Windows' generic IPP driver turns each page into PCLm and
takes about 4 s a page doing it. Drawing the page here and sending PCLm is the
same work in a fraction of the time.

PCLm on the HP is 600 dpi only (A4 = 4960 x 7015 pixels on a 595 x 841 point
page, both rounded down, as its own driver sends it), in 64-line strips.

## Two things the HP is strict about (found 25 Nov 2026)

- **Send chunked.** An IPP request sent with a `Content-Length` is taken, then
  the HP waits about 30 s for a document it already has and aborts the job
  (`aborted-by-system`, nothing printed: jobs 24, 25, 26, both PWG and PCLm).
  Sent with `Transfer-Encoding: chunked`, as phones send, it answers in about
  0.6 s and prints (jobs 27, 28). `ipp.mjs` always sends chunked.
- **A "successful" Print-Job is not a printed page.** The HP accepts the job
  first and aborts it afterwards. To see what really happened, ask it with
  Get-Jobs (`which-jobs=completed`): `job-state` 9 with
  `job-completed-successfully` is printed; 8 with `aborted-by-system` is not.

For a printer without PCLm, PWG raster goes instead, PDFs at 600 dpi
(`IPP_PDF_DPI`) and photos at 300 (`IPP_PHOTO_DPI`). It is tested against a
stand-in printer only; the HP itself has only printed PCLm.

## Settings

`print-server/.env`:

```text
PRINTER_IPP_URLS=NPI33F31D (HP LaserJet Tank MFP 2606sdw)=http://192.168.29.184:631/ipp/print
```

The address is the HP's on the shop Wi-Fi (`192.168.29.184`, found from its MAC
`AC-50-DE-B0-EE-8A` in the PC's neighbour table). If the router gives the HP
another address, direct printing fails over to the Windows way by itself (the
log says `[ipp-print] ... printing through Windows instead`); fix the address
here, or reserve it for the HP in the router.

The HP is also added to Windows under the same name, over IPP, so the Windows
way and the printer-health check find it.

## The Epson

On 2026-11-25 the Epson L8050 was not on the network and not added to Windows.
`docs/one-tap-phone-print.md` records its IPP as switched off. Once it is on and
added to Windows as `EPSONE46549 (L8050 Series)` it prints the Windows way.
If its IPP is switched on, ask it what it takes (an IPP Get-Printer-Attributes,
see `ipp.mjs`); if it lists `srgb_8` in `pwg-raster-document-type-supported`,
adding it to `PRINTER_IPP_URLS` prints colour the fast way too.

## Checking without paper

`tools/print-file.ps1 -OutFile out.pdf -Printer "Microsoft Print to PDF"` writes
the print to a file. `tests/raster.test.ts` and `tests/directPrint.test.ts` check
the PWG packing and the IPP job against a stand-in printer.
