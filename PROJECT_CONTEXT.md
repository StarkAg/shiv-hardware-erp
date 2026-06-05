# Project Context: Shiv Hardware Panel

## Goal

Replace 4 Excel files with a digital quotation and guarantee card system for a hardware store in Ramgarh Cantt, India.

## Current Data Flow

```text
┌─────────────────────────────────────────────────────────────┐
│                    WEB APP (Vite + React)                   │
│              http://192.168.29.174:5180/#/scan              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Scan Bill Screen                                        │
│     ↓ photo of handwritten bill                             │
│  2. Compress image to 1000px                                │
│     ↓ base64                                                │
│  3. POST /scan-bill -> Print Server                         │
│                                                             │
└────────────────┬────────────────────────────────────────────┘
                 │
    ┌────────────▼──────────────────────────────────────────┐
    │     PRINT SERVER (Node.js + Express)                  │
    │     http://192.168.29.174:3333                        │
    ├───────────────────────────────────────────────────────┤
    │                                                       │
    │  POST /scan-bill { image, mediaType, provider }       │
    │     ├─ provider='claude' -> Claude Sonnet vision      │
    │     ├─ provider='sarvam' -> Sarvam Vision OCR         │
    │     └─ provider='both'   -> A/B test both             │
    │                                                       │
    │  Claude Sonnet reads handwriting:                     │
    │  image -> JSON: customer name, mobile, items          │
    │  Cost: ~₹0.33/bill, compressed to 1000px              │
    │  Speed: 2-3 seconds                                   │
    │                                                       │
    │  Sarvam Vision reads handwriting:                     │
    │  image -> OCR text -> Claude Haiku parses JSON        │
    │  Cost: ~₹0.50/bill                                    │
    │  Speed: 10-15 seconds                                 │
    │                                                       │
    └────────────────┬──────────────────────────────────────┘
                     │
    ┌────────────────▼────────────────────────────────────┐
    │        RESPONSE (JSON)                              │
    │  {                                                  │
    │    customerName, mobile, uid, address,              │
    │    items: [ { brandName, category, height,          │
    │              width, qty, guaranteeYears } ]         │
    │  }                                                  │
    └────────────────┬────────────────────────────────────┘
                     │
    ┌────────────────▼────────────────────────────────────┐
    │  WEB APP: Auto-fill Guarantee Card                  │
    │  User reviews/edits -> Tap Print                    │
    │  Sent to printer if connected via CUPS              │
    └─────────────────────────────────────────────────────┘
```

## Built Today

- Bill scanner with Claude Sonnet vision: reads handwritten bills and returns JSON.
- Integrated Sarvam Vision as an alternative provider for Hindi-heavy OCR, slower than Claude.
- Image compression before sending to reduce token/cost usage.
- A/B test endpoint to compare both providers on the same bill.

## Currently Broken

- Print server is not running, causing 404 errors when trying to use WhatsApp/share flows.
- Restart it with:

```bash
node print-server/server.mjs
```

