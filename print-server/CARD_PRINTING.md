# PVC Guarantee Card Printing (Epson L8050)

How the shop prints guarantee details onto **pre-printed PVC ID cards** using the
Epson L8050's **Disc / ID Card Tray**, the print-area geometry, and the CLI to
control it.

---

## 1. What's happening

- The PVC cards are **pre-printed** with the shop's guarantee design. The printer
  only **overlays the variable details** (customer name, Mob, UID, date, item
  line, total, QR). That's why the card layout is mostly blank space.
- Card physical size: **54 mm × 86 mm** (portrait).
- The tray holds **two cards per pass** → **slot 1** and **slot 2**.
- Printer: `EPSONE46549 (L8050 Series)`, driven through a Windows **DEVMODE**
  (the driver settings blob) captured at `data/epson-card.devmode`.

Print flow:

```
Panel (GuaranteeBuilder / card layout)
  --> POST /print  { kind:'guarantee', document, layout:'card', slot:1|2, documents:[d1,d2] }
      shiv-panel/print-server/server.mjs
  --> renders template.mjs card HTML (54x86mm page)
  --> prints via EPSON_CARD_PRINT_ENGINE=devmode  (tools/print-card-gdi.ps1 + epson-card.devmode)
  --> Epson L8050, Disc/ID Card Tray, both slots in one pass
```

## 2. The blue line = the print-area boundary (IMPORTANT)

The L8050 **clips about 3 mm at the extreme edge** of the card — anything printed
right at the card edge comes out crooked or cut off. So the real usable area is
the card **inset by 3 mm on every side**:

| | mm |
|---|---|
| Card (physical) | 54 × 86 |
| **Safe inset (each side)** | **3** |
| **Print area (usable)** | **48 × 80** |

On the **calibration test card**:

- **Blue frame** = the print-area boundary (**48 × 80 mm**). This is the authority —
  all content must sit inside it.
- **Hatched band** = the 3 mm the printer clips (off-limits).
- **Rulers** measure **from the blue frame** (0 = the layout's real origin), not
  the card edge.
- **Red crosses** = 5 mm in from each physical card corner — an independent
  position check.

The guarantee layout already sits at 3 mm, so this changed nothing visually — the
QR bottom lands at exactly **83 mm** (right on the print-area edge). The rule is
just **enforced** now instead of coincidental.

## 3. Where the geometry lives (single source of truth)

`print-server/template.mjs` exports the constants; `server.mjs` imports them (so
the rendered HTML and the tray placement can never drift apart):

```js
export const CARD_W_MM = 54
export const CARD_H_MM = 86
export const CARD_SAFE_MM = 3
export const CARD_PRINT_W_MM = CARD_W_MM - CARD_SAFE_MM * 2  // 48mm
export const CARD_PRINT_H_MM = CARD_H_MM - CARD_SAFE_MM * 2  // 80mm
```

- Every card element anchors to `${CARD_SAFE_MM}mm` (was hardcoded `3mm`).
- `cardPage()` exposes `--card-safe: 3mm` as a CSS variable.
- **Change `CARD_SAFE_MM` once** and the whole card re-insets.

## 4. Driver settings (decoded from the working DEVMODE)

| Field | Value | Meaning |
|---|---|---|
| Printer | EPSON L8050 Series | |
| Paper size | 256 (custom) → **54 × 86 mm** | the PVC card |
| Orientation | portrait | |
| **Paper source (tray)** | **4** | Disc / ID Card Tray |
| **Media type** | **452** | PVC ID Card |
| Colour | colour | |
| Quality / Y-res | 720 / 720 dpi | |

`.env` tray placement: slot 1 = `8mm / 35mm`, slot 2 = `82mm / 35mm`, offsets 0,
scale 100% (`EPSON_CARD_SLOT_*`, `EPSON_CARD_OFFSET_X/Y_MM`, `EPSON_CARD_SCALE_PERCENT`).

## 5. Commands — the Epson CLI (`epson.mjs`)

Standalone CLI to read and build DEVMODEs from plain parameters (no HTTP API).
Run from `shiv-panel/print-server/`:

```bash
# Show the current card DEVMODE's settings
node epson.mjs show
node epson.mjs show data/epson-card.devmode

# List trays / media ids / the PVC card preset
node epson.mjs caps

# Build a DEVMODE from options (preview only — no --out)
node epson.mjs build --copies 2 --color bw --quality 360

# Build and SAVE a DEVMODE to use for printing
node epson.mjs build --copies 1 --color color --out data/epson-card.devmode
```

`build` flags: `--base <file>` `--out <file>` `--copies N` `--color color|bw`
`--quality N` `--media N` `--source N` `--width MM` `--length MM`
`--orientation portrait|landscape` `--scale N`.

It patches the **public** DEVMODE fields on a valid captured base and preserves
the private Epson data — keep one captured base per fundamentally different
media/tray (card vs A4) and tweak from there.

## 6. Calibration / test tooling

In `print-server/tools/`:

- `print-card-gdi.ps1` — the actual card print engine (applies the DEVMODE).
- `print-card-slot-scales.ps1` — prints mm-grid scale cards in both slots.
- `calibrate-card-position.ps1`, `print-card-tray-calibration.ps1`,
  `scan-card-calibration.ps1` — position calibration helpers.
- `capture-epson-card-devmode.ps1` — re-capture the driver DEVMODE from the
  Epson print dialog (run if the printer/media changes).

## 7. Quick check before a real print

Print the two-slot test target. If the **blue frame sits clean on both cards with
even margins**, the geometry is locked — then print a real guarantee card as the
final confirmation.
