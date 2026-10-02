// electron-builder config for the Shiv Quotation desktop app.
//
// Same project, same dist/ and same Electron shell as Shiv Hardware Panel —
// `shivEntry: 'counter'` makes electron/main.cjs open counter.html (quotations +
// guarantee cards) instead of the full panel. Own appId / productName / output
// folder so it installs side by side with the panel. No publish feed: it is
// rebuilt and reinstalled locally (`npm run dist:quotation`).
//
//   npm run dist:quotation        -> release-quotation/Shiv-Quotation-Setup-<v>.exe
//   npm run dist:quotation:dir    -> release-quotation/win-unpacked (no installer)
const fs = require('node:fs')
const path = require('node:path')
const base = require('./package.json').build

/**
 * Direct Epson card printing settings, copied from print-server/.env at build
 * time so the app prints exactly where the calibrated print server does. Only
 * these keys are read — the .env (API keys etc.) itself is never packaged.
 */
function cardPrintFromEnv() {
  let env = ''
  try { env = fs.readFileSync(path.join(__dirname, 'print-server', '.env'), 'utf8') } catch { return {} }
  const get = (key) => (env.match(new RegExp(`^${key}=(.*)$`, 'm')) || [])[1]?.trim()
  const num = (key) => (get(key) !== undefined && get(key) !== '' ? Number(get(key)) : undefined)
  const out = {
    printer: get('COLOR_PRINTER'),
    slotLeftMm: num('EPSON_CARD_SLOT_LEFT_MM'),
    slotTopMm: num('EPSON_CARD_SLOT_TOP_MM'),
    slot2LeftMm: num('EPSON_CARD_SLOT2_LEFT_MM'),
    slot2TopMm: num('EPSON_CARD_SLOT2_TOP_MM'),
    offsetXmm: num('EPSON_CARD_OFFSET_X_MM'),
    offsetYmm: num('EPSON_CARD_OFFSET_Y_MM'),
    scalePercent: num('EPSON_CARD_SCALE_PERCENT'),
    guaranteePublicUrl: get('GUARANTEE_PUBLIC_URL'),
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && !Number.isNaN(v)))
}

module.exports = {
  ...base,
  appId: 'in.shivhardware.quotation',
  productName: 'Shiv Quotation',
  directories: { output: 'release-quotation' },
  // files/asarUnpack (card template + Epson script/DEVMODE) come from base.
  extraMetadata: { ...base.extraMetadata, shivEntry: 'counter', cardPrint: cardPrintFromEnv() },
  publish: null,
  win: {
    ...base.win,
    // Gold quotation-sheet icon (scripts/make-quotation-icon.ps1), distinct from the panel's "S".
    icon: 'build/icon-quotation.ico',
    artifactName: 'Shiv-Quotation-Setup-${version}.${ext}',
  },
  nsis: {
    ...base.nsis,
    shortcutName: 'Shiv Quotation',
  },
}
