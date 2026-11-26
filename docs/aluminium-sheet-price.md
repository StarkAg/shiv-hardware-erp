# Aluminium: Costing or Sheet price

The Aluminium rates screen (counter, `src/features/rates/AluminiumCosting.tsx`) has a
**Price by** switch for each product (door, 2 track window, 3 track window):

- **Costing**: worked out from section kg, aluminium rate, materials and margin
  (`src/lib/aluCosting.ts`). Every product starts here, so quotes are as before.
- **Sheet price**: straight off the shop's workbook `Desktop\Aluminium Rates.xlsm`
  (`src/lib/aluSheet.ts`). The sheet's rates are editable on the same screen.

The choice and the sheet rates are saved with the rest of the aluminium costing
(localStorage, then Convex `aluCostingStore`), so every counter follows it. The
quotation calls `calcAluminiumQuote`, which picks the one set for the product.

## The sheet's rules, read from its formulas (2026-11-26)

- Size: inches, plus 1 when any soot is filled in (`J2 = IF(J14>0, J13+1, J13)`).
- Area: `ROUND(H x W / 144, 2)` sqft (two decimals, not whole sqft).
- Windows:
  - "Rates According To Area" slab: `INDEX(U2:U9, MATCH(area, U2:U9, 1))`, the row with
    the biggest area not over the size's. That rate is the **1.2 mm clear** rate (`O3 = K6`).
  - 1.6 mm = that + 60 (`Q3 = O3 + P3`), 1.2 mm Hindalco = that + 50 (`S3 = O3 + R3`).
  - Reflective glass = each clear rate + 20 (`O5 = O3 + 20` ...).
  - Price = rate x area. Brown coated 40/sqft; 2 track SS net 50/sqft.
  - Under 6 sqft the sheet shows #N/A; the app charges the first (highest) row.
  - 3 track slabs: 6: 470, 7.5: 430, 9: 390, 12: 360, 14: 330, 16: 320, 20: 300, 24: 290.
  - 2 track slabs: 6: 350, 7.5: 310, 9: 290, 12: 260, 14: 260, 16: 240, 20: 240, 24: 230.
  - The Control Panel also lists window Chaukhat (75/85/85) and Decor Film (30/86/86),
    but no total on the sheet uses them, so the app does not quote them.
- Door: door rate x area (150/200/190), chaukhat rate x (2H + W)/12 (90/100/100),
  accessories 160 flat; total = the three. Decor film 30, brown coated 40 per sqft.
  - The sheet has a "Minimum Bill Size" box (area 15, chaukhat 14.5) and shows the
    chaukhat as at least 14.5 rft, but its amount formulas multiply the real size.
    The app applies both minimums (editable; 0 turns one off), as costing does.

Example: 3 track 39 x 48 = 13 sqft, slab 12 -> 360: 4680 / 5460 / 5330 clear,
4940 / 5720 / 5590 reflective, brown coated 520 (`tests/aluSheet.test.ts`).

Note: the older fixed price list in `src/lib/aluminium.ts` has stale slab rates
(for example 3 track 14 sqft at 350, the sheet now says 330); the quotation does
not use it.
