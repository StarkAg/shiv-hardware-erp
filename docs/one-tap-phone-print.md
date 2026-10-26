# One-tap print from a phone, no PC (to do — on the laptop)

Tony wants Shiv Counter on a phone to print a quotation (or an A4 guarantee
sheet) to the shop's Epson L8050 with **one tap**: no print menu, no picking a
printer, and the shop PC off. Decided 26 Oct 2026 to build it as a phone app
(Option B below), on the laptop.

## The printer, as checked on 26 Oct 2026

| | |
|---|---|
| Model | Epson L8050 (EcoTank photo, 6 inks), Wi-Fi 2.4 GHz only (802.11 b/g/n) |
| Wi-Fi | "Shiv Hardware 2Ghz", signal Excellent |
| Address | `192.168.29.232` (DHCP: give it a fixed address in the router first, or the app loses it) |
| Name / MAC | `EPSONE46549`, `DC:CD:2F:E4:65:49` |
| Web Config | `https://192.168.29.232/` (self-signed certificate) |
| Ports open | 9100 (raw), 515 (LPR — what Windows' EpsonNet port uses) |
| **IPP** | **off**: `/ipp/print` answers 404 on 80 and 443, port 631 closed. AirPrint and Mopria need it too |
| Epson Connect | Unregistered |

## Option B — the phone app (chosen)

The project already has a Capacitor Android setup (`android/`,
`capacitor.config.ts`, `@capacitor/android` 7.6), currently for the panel
(`appId in.shivhardware.panel`, `webDir: dist`). A counter app would be a
second app id (say `in.shivhardware.counter`) loading `counter.html`.

1. **Turn IPP on** in Web Config (Network Settings → Protocol → IPP), then
   ask the printer what it takes: an IPP `Get-Printer-Attributes` to
   `http://192.168.29.232:631/ipp/print` and read `document-format-supported`
   (hoping for `application/pdf` or `image/jpeg`; `image/pwg-raster` and
   `image/urf` always come with AirPrint).
2. **Print**: the app makes the page it already makes for WhatsApp sharing
   (`elementToJpeg(<QuotationPrint …/>)`, `src/lib/shareImage.ts`) — or a PDF
   — and sends an IPP `Print-Job` with it, A4, plain paper. From the app this
   goes through native HTTP (`CapacitorHttp`), which a website cannot do: a
   browser may not talk to a printer on the Wi-Fi (no raw sockets, CORS, the
   printer's self-signed certificate). That is why only an installed app gets
   the one tap.
3. **Where the button goes**: Print on the quotation (`QuotationBuilder`
   `handleDirectPrint`) and the A4 guarantee — tried first when the app finds
   the printer on the Wi-Fi, falling back to the shop PC (`printViaShop`) as
   now.
4. **Android**: build an APK, install it once on each phone.
   **iPhone**: needs an Apple Developer account (about ₹8,000 a year) and
   building on the Mac; without it an iPhone keeps the print menu.

Raw port 9100 is not the way: it wants the printer's own language (ESC/P-R),
not a PDF or a picture.

## Never by phone

PVC guarantee cards and card backs: they print from the ID card tray at exact
slot positions with a captured driver DEVMODE (`print-server`,
`electron/main.cjs`). Only the shop PC can do that.

## Option A — kept in mind

Epson Connect **Email Print**: register the printer (it prints a code sheet;
enter it on Epson's site) and it gets an `@print.epsonconnect.com` address;
the app emails the PDF and it prints by itself from anywhere. Also one tap, but
10–60 seconds, A4 only, and it needs an email sender set up.
