# Shiv Hardware Panel

Quotation, rate-management and guarantee-card system for **Shiv Hardware Store**, replacing the legacy macro-Excel workflow. Built for pixel-accurate A4 printing.

## Run

```bash
npm install
npm run dev      # http://localhost:5180
npm run build    # production build to dist/
```

## Print server

```bash
cd print-server
npm install
npm start
```

- Main printer endpoints run on `http://<shop-computer-ip>:3333`.
- WhatsApp upload print page: `http://<shop-computer-ip>:3333/whatsapp-print`
- Share helper: `http://<shop-computer-ip>:3333/whatsapp-print/share`

Open the WhatsApp print link on a phone, select received images or PDFs, and the shop computer prints them on `PRINT_PRINTER`.

## What's inside

- **New Quotation** — pick category + brand, enter Height/Width (inches + soot) → live sqft & amount. Save, then print Quotation or Guarantee Card.
- **Quote History** — search, reopen, reprint, delete. Sequential numbers `SH-YYYY-NNNN`.
- **Rate Manager** — edit brands, ₹/sqft rates and guarantee years (auto-saved).
- **Customers** — auto-captured from saved quotes.

## Architecture

- React 18 + TypeScript + Vite + Tailwind.
- `src/lib/pricing.ts` — pricing engine, ports Excel formulas exactly (`sqft = round(H×W/144,2)`, `cost = round(rate×sqft)` for quotations).
- `src/lib/data/brands.ts` — seed rates transcribed from the Excel sheets (editable).
- `src/lib/db/adapter.ts` — swappable persistence (localStorage now; Convex/SQLite later).
- `src/features/print/*` — A4 print templates using the extracted letterhead + wax seals (`/assets`). `@page A4` CSS = deterministic output on any printer.

## Pending decisions / next steps

- **Data backend**: localStorage today → Convex (cloud sync, both platforms) or SQLite (offline). Adapter is ready.
- **Real guarantee terms text** (currently placeholder) — replace `DEFAULT_TERMS` in `GuaranteeCard.tsx`.
- **Aluminium slab pricing** — windows use a sqft-slab VLOOKUP + chaukhat/min-bill in Excel; currently flat ₹/sqft. To refine.
- **Electron packaging** — wrap for Mac `.dmg` + Windows `.exe` with silent multi-copy printing.
