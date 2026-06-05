// Shiv Hardware Print Server
// POST /scan-bill  { image, mediaType }             -> guarantee card data
// POST /print      { quote, copies }                -> PDF -> printer
// GET  /whatsapp-print                              -> mobile upload page
// POST /whatsapp-print/jobs { files, copies }       -> uploaded PDFs/images -> printer

import { existsSync, readFileSync } from 'fs'
try {
  readFileSync(new URL('.env', import.meta.url), 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=')
    if (k?.trim() && !k.startsWith('#')) process.env[k.trim()] = v.join('=').trim()
  })
} catch {}

import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import { execFile } from 'child_process'
import { appendFile, writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { buildGuaranteeHtml, buildQuotationHtml } from './template.mjs'

const PORT = Number(process.env.PORT) || 3333
const COLOR_PRINTER = process.env.COLOR_PRINTER || process.env.PRINT_PRINTER || 'EPSON L8050 Series'
const BW_PRINTER = process.env.BW_PRINTER || process.env.PRINT_PRINTER || 'NPI33F31D (HP LaserJet Tank MFP 2606sdw)'
const PRINT_PRINTER = process.env.PRINT_PRINTER || BW_PRINTER
const PRINT_SERVER_HOST = process.env.PRINT_SERVER_HOST || '192.168.29.174'
const PRINT_SERVER_PUBLIC_URL = process.env.PRINT_SERVER_PUBLIC_URL || `http://${PRINT_SERVER_HOST}:${PORT}`
const CLOUD_API_URL = (process.env.CLOUD_API_URL || '').replace(/\/+$/, '')
const CLOUD_API_KEY = process.env.CLOUD_API_KEY || ''
const PRINTER_AGENT_ID = process.env.PRINTER_AGENT_ID || 'shiv-shop-printer'
const CLOUD_POLL_INTERVAL_MS = Math.max(3000, Number(process.env.CLOUD_POLL_INTERVAL_MS) || 7000)
const SUMATRA_PDF_PATH = process.env.SUMATRA_PDF_PATH || findSumatraPdfPath()
const EPSON_CARD_PRINT_SETTINGS = (process.env.EPSON_CARD_PRINT_SETTINGS || 'noscale,color,landscape,bin=Disc/ID Card Tray')
  .split(',')
  .map(setting => setting.trim())
  .filter(Boolean)
const EPSON_CARD_PRINT_ENGINE = (process.env.EPSON_CARD_PRINT_ENGINE || 'sumatra').toLowerCase()
const EPSON_CARD_DEVMODE_PATH = process.env.EPSON_CARD_DEVMODE_PATH || fileURLToPath(new URL('data/epson-card.devmode', import.meta.url))
const EPSON_CARD_GDI_SCRIPT = fileURLToPath(new URL('tools/print-card-gdi.ps1', import.meta.url))
const EPSON_CARD_EXCEL_SCRIPT = fileURLToPath(new URL('tools/print-card-excel.ps1', import.meta.url))
const EPSON_CARD_OFFSET_X_MM = Number(process.env.EPSON_CARD_OFFSET_X_MM) || 0
const EPSON_CARD_OFFSET_Y_MM = Number(process.env.EPSON_CARD_OFFSET_Y_MM) || 0
const EPSON_CARD_SCALE_PERCENT = Number(process.env.EPSON_CARD_SCALE_PERCENT) || 100
const CHROME_PATH = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
].find(existsSync)
const JSON_MAX_TOKENS = 2048
const HONORIFICS = new Set(['jee', 'ji', 'sir', 'madam'])
const NAME_WORD_RE = /^[a-z][a-z'.-]{2,}$/i
const NAME_CORRECTIONS_URL = new URL('data/name-corrections.json', import.meta.url)
const PLACE_CORRECTIONS_URL = new URL('data/place-corrections.json', import.meta.url)
const PRODUCT_CORRECTIONS_URL = new URL('data/product-corrections.json', import.meta.url)
const SCAN_FEEDBACK_URL = new URL('data/scan-feedback.jsonl', import.meta.url)
const app = express()
app.use(cors())
app.use(express.json({ limit: process.env.PRINT_UPLOAD_LIMIT || '100mb' }))

const WHATSAPP_ALLOWED_MEDIA_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])
const WHATSAPP_MAX_FILES = 12
const WHATSAPP_MAX_FILE_BYTES = 30 * 1024 * 1024

function normalizeNameKey(value) {
  return String(value ?? '').trim().toLowerCase()
}

function titleCaseName(value) {
  return String(value)
    .split(/([-'])/)
    .map(part => part === '-' || part === "'" ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function loadNameData() {
  try {
    const indianNames = readFileSync(new URL('data/indian_names.txt', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .map(line => line.replace(/^name:\s*/i, ''))
    const corrections = JSON.parse(readFileSync(NAME_CORRECTIONS_URL, 'utf8'))
    const names = new Map()

    for (const name of [...indianNames, ...(corrections.preferredNames ?? [])]) {
      const clean = normalizeNameKey(name)
      if (clean && !names.has(clean)) names.set(clean, titleCaseName(clean))
    }

    const buckets = new Map()
    for (const entry of names) {
      const [key] = entry
      const bucket = buckets.get(key.length) ?? []
      bucket.push(entry)
      buckets.set(key.length, bucket)
    }

    return { buckets, ocrCorrections: corrections.ocrCorrections ?? {} }
  } catch (err) {
    console.warn('[names] dictionary unavailable:', err.message)
    return { buckets: new Map(), ocrCorrections: {} }
  }
}

let NAME_DATA = loadNameData()

function loadPlaceData() {
  try {
    const places = readFileSync(new URL('data/jharkhand_places.txt', import.meta.url), 'utf8').split(/\r?\n/)
    const corrections = JSON.parse(readFileSync(PLACE_CORRECTIONS_URL, 'utf8'))
    const placeMap = new Map()

    for (const place of [...places, ...(corrections.preferredPlaces ?? [])]) {
      const clean = normalizeNameKey(place)
      if (clean && !placeMap.has(clean)) placeMap.set(clean, titleCaseName(clean))
    }

    const buckets = new Map()
    for (const entry of placeMap) {
      const [key] = entry
      const bucket = buckets.get(key.length) ?? []
      bucket.push(entry)
      buckets.set(key.length, bucket)
    }

    return { buckets, ocrCorrections: corrections.ocrCorrections ?? {} }
  } catch (err) {
    console.warn('[places] dictionary unavailable:', err.message)
    return { buckets: new Map(), ocrCorrections: {} }
  }
}

let PLACE_DATA = loadPlaceData()

function loadProductCorrections() {
  try {
    return JSON.parse(readFileSync(PRODUCT_CORRECTIONS_URL, 'utf8'))
      .map(correction => ({
        ...correction,
        match: (correction.match ?? []).map(normalizeProductKey),
      }))
  } catch (err) {
    console.warn('[products] corrections unavailable:', err.message)
    return []
  }
}

function normalizeProductKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

let PRODUCT_CORRECTIONS = loadProductCorrections()

const EXTRACT_PROMPT = `This is a handwritten bill from a hardware store in Ramgarh Cantt, India.
Extract these fields and return ONLY valid JSON, no explanation:
{
  "customerName": "full visible text after M/s or Name, including locality written on the same line",
  "mobile": "10-digit mobile number",
  "uid": "UID/Aadhar if visible, else null",
  "address": "address if visible, else null",
  "items": [
    {
      "brandName": "brand/product name",
      "category": "one of: readymade-door, flush-door, plywood-6, block-board-12, block-board-19, aluminium-door, window-2-track, window-3-track",
      "heightInches": whole inches number or null,
      "heightSoot": eighths of an inch, 0 to 7,
      "widthInches": whole inches number or null,
      "widthSoot": eighths of an inch, 0 to 7,
      "sizeLabel": "visible size shorthand such as 7x4 or 8x4, else null",
      "qty": number,
      "amount": right-side line amount number or null,
      "guaranteeYears": 0 or 1 or 3 or 5 or 7 or 8 or 10 or 15 or 20 or 21 or 25 or 30
    }
  ]
}
Rules:
- Contact/mobile must be exact. Read every digit carefully. Return null if unsure; never invent a mobile.
- Customer line always starts with M/s or M/s-like writing. Treat it as a permanent printed/customer prefix; do not include "M/s" in customerName.
- Customer name: keep the full visible text after M/s, including locality. Example: "M/s Lalan Singh Ji, Ranchi Road" => customerName "Lalan Singh Ji, Ranchi Road".
- Address/locality is usually in Jharkhand/Ramgarh area; prefer real Jharkhand place spellings such as Huhua, Bagicha, Bhurkunda, Ranchi Road, Bank Colony, Ramgarh Cantt.
- If a non-empty customer name does not visibly include an honorific, append "Ji". Normalize Ji/Jee spelling to "Ji". Do not output only "Ji" when the name is empty.
- Items are for the guarantee card/main products only. Include doors, plywood/block-board/sheet, aluminium/window products. Exclude handles, hinges, aldrop, screws, nails, tape, magnet, fitting items, nut/bolt, labor/fare, and other accessories.
- DDSM design/brand names must use uppercase "DDSM" exactly, even if handwriting looks like DDsm/DDSm.
- Do not confuse amount/rate on the far right with quantity. Quantity is near the item text: 1Pc, 11Pc, 10Pc, 1Pkt, 3 B/L, 6Pc. Also extract the far-right amount into "amount".
- Alphanumeric door codes such as 213LUS are product/model codes, not amounts. Example: "DDSM Double Door 1Pc 213LUS" means brandName "DDSM Double Door 213LUS", qty 1, amount null.
- Preserve fractions as soot/eighths, not decimals. Example: "76 7/8 X 46" means heightInches 76, heightSoot 7, widthInches 46, widthSoot 0.
- Example: "DDSM PM LU4245 76 7/8 X 46 1 pcs 8197" means brandName "DDSM PM LU4245", heightInches 76, heightSoot 7, widthInches 46, widthSoot 0, qty 1. The 8197 is amount, not quantity.
- Example: "DDSM PM DD595 77 4/8 X 31 3/8 1 Pc 5702" means heightInches 77, heightSoot 4, widthInches 31, widthSoot 3, qty 1.
- Example: "DDSM PM DD595 77 X 37 7/8 1 Pc 6771" means heightInches 77, heightSoot 0, widthInches 37, widthSoot 7, qty 1.
- Board size shorthand: 7x4 or 8x4 means set only sizeLabel ("7x4" or "8x4"). Do not convert board shorthand into inches.
- 19mm board/sheet => category block-board-19. 12mm board/sheet => category block-board-12.
- If a board line looks like "19mm A" but context/amount matches this shorthand, read it as "19mm PF"; do not mark 19mm PF as guaranteed unless explicitly told otherwise.
- "6MM Panther PF" or "Panther PF" is a guaranteed 6mm plywood product: category plywood-6, qty 1 if written 1 Pc, guaranteeYears 10. Preserve visible 7x4/8x4 only as sizeLabel.
- guaranteeYears: 10 for Greenply/Kitply/DDoor/Durian/Panther PF, 7 for Black Touch, 0 for non-guaranteed boards/sheets/accessories/others.
- category: infer from product name.
- null for anything not visible`

const ACCESSORY_ITEM_RE = /\b(handle|hinge|aldrop|screw|nail|tape|magnet|fare|fale|labou?r|fitting|nut|bolt|receiver|stepper|chowkhat|chowket)\b/i
const MAIN_PRODUCT_RE = /\b(door|ply|plywood|board|block|19\s*mm|12\s*mm|6\s*mm|alum|aluminium|window|slider|acp|sgc|ddsm|ddoor|greenply|kitply|durian|black\s*touch|mica|xmica|panther)\b/i

function normalizeCustomer(data) {
  const name = typeof data.customerName === 'string' ? data.customerName.trim() : ''
  const address = correctPlaceSegment(typeof data.address === 'string' ? data.address.trim() : '')
  let customerName = correctCustomerName(name)

  if (customerName && address && !customerName.toLowerCase().includes(address.toLowerCase())) {
    customerName = `${customerName}, ${address}`
  }

  if (customerName && !/\b(jee|ji|sir|madam)\b/i.test(customerName)) {
    customerName = `${customerName} Ji`
  }

  return { ...data, customerName: customerName || null, address: address || null }
}

function normalizeItem(item, productCounts = new Map()) {
  const brandName = typeof item.brandName === 'string' ? item.brandName.trim() : ''
  const normalized = normalizeItemDimensions({ ...item, brandName })
  const correctedProduct = correctProductItem(normalized, productCounts)
  if (correctedProduct) return normalizeProductCasing(correctedProduct)

  if (/19\s*mm/i.test(brandName)) normalized.category = 'block-board-19'
  if (/12\s*mm/i.test(brandName)) normalized.category = 'block-board-12'

  if (/\b7\s*x\s*4\b/i.test(brandName)) {
    normalized.sizeLabel = '7x4'
  }
  if (/\b8\s*x\s*4\b/i.test(brandName)) {
    normalized.sizeLabel = '8x4'
  }

  if (/(19\s*mm|12\s*mm|ply|plywood|board|block)/i.test(brandName)) {
    normalized.guaranteeYears = 0
    normalized.sizeLabel = normalized.sizeLabel ?? inferBoardSizeLabel(normalized)
  }

  return normalizeProductCasing(normalized)
}

function normalizeProductCasing(item) {
  return {
    ...item,
    brandName: String(item.brandName ?? '').replace(/\bddsm\b/gi, 'DDSM'),
  }
}

function normalizeAmount(value) {
  if (value == null || value === '') return null
  const parsed = Number(String(value).replace(/[^\d.]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeSizeLabel(value) {
  const match = String(value ?? '').trim().match(/^(\d+)\s*x\s*(\d+)$/i)
  return match ? `${match[1]}x${match[2]}` : null
}

function inferBoardSizeLabel(item) {
  const height = Number(item.heightInches)
  const width = Number(item.widthInches)
  if (height === 84 && width === 48) return '7x4'
  if (height === 96 && width === 48) return '8x4'
  return null
}

function normalizeDimensionParts(inches, soot) {
  const fractionMatch = typeof inches === 'string'
    ? inches.trim().match(/^(\d+)(?:\s+(\d)\s*\/\s*8)?$/)
    : null
  const numericInches = fractionMatch ? Number(fractionMatch[1]) : Number(inches)
  const parsedSoot = fractionMatch?.[2] == null ? null : Number(fractionMatch[2])
  const numericSoot = soot == null || soot === '' ? NaN : Number(soot)

  if (inches == null || inches === '' || !Number.isFinite(numericInches)) {
    return {
      inches: null,
      soot: Number.isFinite(numericSoot) ? Math.min(7, Math.max(0, Math.round(numericSoot))) : parsedSoot ?? 0,
    }
  }

  const whole = Math.floor(numericInches)
  const fractionalSoot = Math.round((numericInches - whole) * 8)
  const nextInch = fractionalSoot >= 8 ? 1 : 0
  const inferredSoot = fractionalSoot >= 8 ? 0 : fractionalSoot
  const finalSoot = Number.isFinite(numericSoot) ? numericSoot : parsedSoot ?? inferredSoot

  return {
    inches: whole + nextInch,
    soot: Math.min(7, Math.max(0, Math.round(finalSoot))),
  }
}

function normalizeItemDimensions(item) {
  const height = normalizeDimensionParts(item.heightInches, item.heightSoot)
  const width = normalizeDimensionParts(item.widthInches, item.widthSoot)
  return {
    ...item,
    amount: normalizeAmount(item.amount),
    sizeLabel: normalizeSizeLabel(item.sizeLabel) ?? normalizeSizeLabel(item.brandName) ?? item.sizeLabel ?? null,
    heightInches: height.inches,
    heightSoot: height.soot,
    widthInches: width.inches,
    widthSoot: width.soot,
  }
}

function correctProductItem(item, productCounts) {
  const key = normalizeProductKey(item.brandName)
  if (!key) return null

  const correction = PRODUCT_CORRECTIONS.find(entry => entry.match.includes(key))
  if (!correction) return null
  const count = productCounts.get(correction.canonicalBrandName) ?? 0
  productCounts.set(correction.canonicalBrandName, count + 1)
  const knownLine = correction.knownLines?.[count]
  const correctedValue = (field, fallback) => {
    if (knownLine && Object.hasOwn(knownLine, field)) return knownLine[field]
    if (Object.hasOwn(correction, field)) return correction[field]
    return fallback
  }

  return {
    ...item,
    brandName: correction.canonicalBrandName,
    category: correctedValue('category', item.category),
    heightInches: correctedValue('heightInches', item.heightInches),
    heightSoot: correctedValue('heightSoot', item.heightSoot ?? 0),
    widthInches: correctedValue('widthInches', item.widthInches),
    widthSoot: correctedValue('widthSoot', item.widthSoot ?? 0),
    sizeLabel: correctedValue('sizeLabel', item.sizeLabel ?? inferBoardSizeLabel(item)),
    qty: correctedValue('qty', item.qty),
    amount: correctedValue('amount', item.amount ?? null),
    guaranteeYears: correctedValue('guaranteeYears', item.guaranteeYears),
  }
}

function normalizeScanData(data) {
  const normalized = normalizeCustomer(data)
  const productCounts = new Map()
  normalized.items = (Array.isArray(data.items) ? data.items : [])
    .map(item => normalizeItem(item, productCounts))
    .filter(item => {
      const name = item.brandName ?? ''
      if (!name) return false
      if (ACCESSORY_ITEM_RE.test(name)) return false
      return MAIN_PRODUCT_RE.test(name)
    })
  return normalized
}

function parseJSON(text) {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('No JSON found in response')

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return JSON.parse(text.slice(start, i + 1))
  }

  throw new Error('Incomplete JSON in response')
}

function levenshteinAtMostTwo(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  const current = new Array(b.length + 1)

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    let rowMin = current[0]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      )
      rowMin = Math.min(rowMin, current[j])
    }
    if (rowMin > 2) return 3
    previous.splice(0, previous.length, ...current)
  }

  return previous[b.length]
}

function correctNameToken(token) {
  const key = normalizeNameKey(token)
  if (!NAME_WORD_RE.test(token) || HONORIFICS.has(key)) return token

  if (NAME_DATA.ocrCorrections[key]) return NAME_DATA.ocrCorrections[key]

  let best = null
  let bestDistance = 3
  for (const length of [key.length, key.length - 1, key.length + 1]) {
    const candidates = NAME_DATA.buckets.get(length) ?? []
    for (const [candidateKey, candidateValue] of candidates) {
      const distance = levenshteinAtMostTwo(key, candidateKey)
      if (distance < bestDistance) {
        best = candidateValue
        bestDistance = distance
        if (distance === 0) return candidateValue
      }
    }
  }

  return best && bestDistance === 1 ? best : token
}

function correctCustomerName(customerName) {
  if (!customerName) return customerName
  const [namePart, ...rest] = customerName.split(',')
  const correctedNamePart = namePart
    .replace(/\bjee\b/gi, 'Ji')
    .replace(/\bji\b/gi, 'Ji')
    .replace(/\b[a-z][a-z'.-]{2,}\b/gi, correctNameToken)
  return [correctedNamePart.trim(), ...rest.map(correctPlaceSegment).filter(Boolean)].join(', ')
}

function correctPlaceSegment(segment) {
  const value = String(segment ?? '').trim()
  if (!value) return ''

  const key = normalizeNameKey(value)
  if (PLACE_DATA.ocrCorrections[key]) return PLACE_DATA.ocrCorrections[key]

  let best = null
  let bestDistance = 3
  for (const length of [key.length, key.length - 1, key.length + 1, key.length - 2, key.length + 2]) {
    const candidates = PLACE_DATA.buckets.get(length) ?? []
    for (const [candidateKey, candidateValue] of candidates) {
      const distance = levenshteinAtMostTwo(key, candidateKey)
      if (distance < bestDistance) {
        best = candidateValue
        bestDistance = distance
        if (distance === 0) return candidateValue
      }
    }
  }

  return best && bestDistance <= 2 ? best : value
}

function readJSON(url, fallback) {
  try {
    return JSON.parse(readFileSync(url, 'utf8'))
  } catch {
    return fallback
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeCopies(value) {
  return Math.min(20, Math.max(1, Math.trunc(Number(value) || 1)))
}

function extensionForMediaType(mediaType) {
  switch (mediaType) {
    case 'application/pdf':
      return '.pdf'
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    default:
      return ''
  }
}

function decodeUploadedFile(file, index) {
  const mediaType = String(file?.mediaType ?? '').toLowerCase()
  const name = String(file?.name ?? `upload-${index + 1}`).trim() || `upload-${index + 1}`
  const rawData = String(file?.data ?? '')
  const data = rawData.includes(',') ? rawData.slice(rawData.indexOf(',') + 1) : rawData
  const cleanData = data.replace(/\s/g, '')

  if (!WHATSAPP_ALLOWED_MEDIA_TYPES.has(mediaType)) {
    throw new Error(`${name}: unsupported file type ${mediaType || 'unknown'}. Use PDF, JPG, PNG, WEBP, or GIF.`)
  }
  if (!cleanData || !/^[A-Za-z0-9+/]*={0,2}$/.test(cleanData)) {
    throw new Error(`${name}: invalid base64 file data`)
  }

  const expectedBytes = Math.floor((cleanData.replace(/=+$/, '').length * 3) / 4)
  if (expectedBytes > WHATSAPP_MAX_FILE_BYTES) {
    throw new Error(`${name}: file is too large. Maximum is ${Math.round(WHATSAPP_MAX_FILE_BYTES / 1024 / 1024)} MB.`)
  }

  const buffer = Buffer.from(cleanData, 'base64')
  if (!buffer.length) throw new Error(`${name}: empty file`)

  return { name, mediaType, data: cleanData, buffer }
}

async function launchPuppeteerBrowser() {
  const { default: puppeteer } = await import('puppeteer-core')
  if (!CHROME_PATH) {
    throw new Error('CHROME_PATH is required for puppeteer-core rendering')
  }

  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
    executablePath: CHROME_PATH,
  })
}

function findSumatraPdfPath() {
  const candidates = [
    'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
    'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
    `${process.env.LOCALAPPDATA || ''}\\SumatraPDF\\SumatraPDF.exe`,
    `${process.env.LOCALAPPDATA || ''}\\Programs\\SumatraPDF\\SumatraPDF.exe`,
  ].filter(Boolean)

  return candidates.find(candidate => existsSync(candidate)) || 'SumatraPDF.exe'
}

function selectDocumentPrinter({ kind, layout = 'a4' } = {}) {
  if (kind === 'guarantee' && layout === 'card') return COLOR_PRINTER
  return BW_PRINTER
}

function selectUploadPrinter(file) {
  if (file?.mediaType?.startsWith('image/')) return COLOR_PRINTER
  return BW_PRINTER
}

async function printFileWithLp(filePath, copies, title, printer = PRINT_PRINTER, printSettings = []) {
  if (process.platform === 'win32') {
    return new Promise((ok, fail) => {
      const settings = [`${copies}x`, ...printSettings].join(',')
      const args = [
        '-print-to',
        printer,
        '-silent',
        '-exit-on-print',
        '-print-settings',
        settings,
        filePath,
      ]

      console.log(`[windows-print] printer="${printer}" settings="${settings}" file="${filePath}"`)
      execFile(SUMATRA_PDF_PATH, args, { windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          fail(err)
          return
        }

        const output = [stdout, stderr].map(text => text?.trim()).filter(Boolean).join('\n')
        console.log(`[windows-print] ${title}`, output || `sent to ${printer}`)
        ok({ jobId: null, output })
      })
    })
  }

  return new Promise((ok, fail) =>
    execFile('lp', ['-d', printer, '-n', String(copies), '-t', title, filePath], (err, stdout) => {
      if (err) {
        fail(err)
        return
      }
      const output = stdout.trim()
      const jobId = output.match(/request id is (\S+)/)?.[1] ?? null
      console.log(`[whatsapp-print] ${title}`, output)
      ok({ jobId, output })
    }),
  )
}

function shouldUseEpsonCardDevmode(isCard) {
  return process.platform === 'win32' && isCard && EPSON_CARD_PRINT_ENGINE === 'devmode'
}

function shouldUseCardImageEngine(isCard) {
  return process.platform === 'win32' && isCard && ['devmode', 'excel'].includes(EPSON_CARD_PRINT_ENGINE)
}

async function printCardImageWithDevmode(filePath, copies, title, printer = COLOR_PRINTER) {
  if (!existsSync(EPSON_CARD_DEVMODE_PATH)) {
    throw new Error(`Missing Epson card DEVMODE file: ${EPSON_CARD_DEVMODE_PATH}. Run print-server/tools/capture-epson-card-devmode.ps1 first.`)
  }

  return new Promise((ok, fail) => {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      EPSON_CARD_GDI_SCRIPT,
      '-ImagePath',
      filePath,
      '-PrinterName',
      printer,
      '-DevmodeFile',
      EPSON_CARD_DEVMODE_PATH,
      '-Copies',
      String(copies),
      '-JobName',
      title,
    ]

    console.log(`[windows-card-print] printer="${printer}" devmode="${EPSON_CARD_DEVMODE_PATH}" file="${filePath}"`)
    execFile('powershell.exe', args, { windowsHide: true, timeout: 120000 }, (err, stdout, stderr) => {
      const output = [stdout, stderr].map(text => text?.trim()).filter(Boolean).join('\n')
      if (err) {
        err.message = `${err.message}${output ? `\n${output}` : ''}`
        fail(err)
        return
      }

      console.log(`[windows-card-print] ${title}`, output || `sent to ${printer}`)
      ok({ jobId: null, output })
    })
  })
}

async function printCardImageWithExcel(filePath, copies, title, printer = COLOR_PRINTER) {
  return new Promise((ok, fail) => {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      EPSON_CARD_EXCEL_SCRIPT,
      '-ImagePath',
      filePath,
      '-PrinterName',
      printer,
      '-Copies',
      String(copies),
      '-JobName',
      title,
      '-OffsetXmm',
      String(EPSON_CARD_OFFSET_X_MM),
      '-OffsetYmm',
      String(EPSON_CARD_OFFSET_Y_MM),
      '-ScalePercent',
      String(EPSON_CARD_SCALE_PERCENT),
    ]

    console.log(`[windows-card-excel] printer="${printer}" offset="${EPSON_CARD_OFFSET_X_MM},${EPSON_CARD_OFFSET_Y_MM}mm" scale="${EPSON_CARD_SCALE_PERCENT}%" file="${filePath}"`)
    execFile('powershell.exe', args, { windowsHide: true, timeout: 180000 }, (err, stdout, stderr) => {
      const output = [stdout, stderr].map(text => text?.trim()).filter(Boolean).join('\n')
      if (err) {
        err.message = `${err.message}${output ? `\n${output}` : ''}`
        fail(err)
        return
      }

      console.log(`[windows-card-excel] ${title}`, output || `sent to ${printer}`)
      ok({ jobId: null, output })
    })
  })
}

async function printCardImage(filePath, copies, title, printer = COLOR_PRINTER) {
  if (EPSON_CARD_PRINT_ENGINE === 'excel') {
    return await printCardImageWithExcel(filePath, copies, title, printer)
  }
  return await printCardImageWithDevmode(filePath, copies, title, printer)
}

async function renderUploadedImagePdf(file) {
  let browser
  try {
    browser = await launchPuppeteerBrowser()
    const page = await browser.newPage()
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 0; }
    html, body {
      width: 210mm;
      height: 297mm;
      margin: 0;
      background: white;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      display: block;
    }
  </style>
</head>
<body>
  <img src="data:${file.mediaType};base64,${file.data}" alt="${escapeHtml(file.name)}" />
</body>
</html>`
    await page.setContent(html, { waitUntil: 'networkidle0' })
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })
  } finally {
    await browser?.close().catch(() => {})
  }
}

async function printUploadedFile(file, copies) {
  const printer = selectUploadPrinter(file)
  const extension = extensionForMediaType(file.mediaType)
  const sourcePath = join(tmpdir(), `shiv-whatsapp-${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`)
  let printPath = sourcePath
  let renderedPdfPath = null

  try {
    await writeFile(sourcePath, file.buffer)

    if (file.mediaType.startsWith('image/')) {
      const pdf = await renderUploadedImagePdf(file)
      renderedPdfPath = join(tmpdir(), `shiv-whatsapp-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`)
      await writeFile(renderedPdfPath, pdf)
      printPath = renderedPdfPath
    }

    const result = await printFileWithLp(printPath, copies, `WhatsApp ${file.name}`.slice(0, 80), printer)
    return {
      name: file.name,
      mediaType: file.mediaType,
      printer,
      jobId: result.jobId,
    }
  } finally {
    await unlink(sourcePath).catch(() => {})
    if (renderedPdfPath) await unlink(renderedPdfPath).catch(() => {})
  }
}

async function printDocumentPayload({ kind, quote, document, layout = 'a4' }, copies) {
  if (kind === 'guarantee' && !document) throw new Error('Missing guarantee document data')
  if (kind !== 'guarantee' && !quote) throw new Error('Missing quotation data')
  const printer = selectDocumentPrinter({ kind, layout })
  const isCard = kind === 'guarantee' && layout === 'card'

  let browser
  let tmp
  try {
    const html = kind === 'guarantee'
      ? await buildGuaranteeHtml(document, layout)
      : await buildQuotationHtml(quote)
    browser = await launchPuppeteerBrowser()
    const page = await browser.newPage()

    if (shouldUseCardImageEngine(isCard)) {
      const cardWidthPx = Math.ceil((86 / 25.4) * 96)
      const cardHeightPx = Math.ceil((54 / 25.4) * 96)
      await page.setViewport({
        width: cardWidthPx,
        height: cardHeightPx,
        deviceScaleFactor: 4,
      })
      await page.setContent(html, { waitUntil: 'networkidle0' })
      const png = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: cardWidthPx, height: cardHeightPx },
      })
      tmp = join(tmpdir(), `shiv-card-${Date.now()}.png`)
      await writeFile(tmp, png)
      const printResult = await printCardImage(tmp, copies, `Shiv ${kind ?? 'card'}`, printer)
      return {
        printer,
        jobId: printResult.jobId,
      }
    }

    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf(isCard
      ? {
          width: '86mm',
          height: '54mm',
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        }
      : { format: 'A4', printBackground: true })
    tmp = join(tmpdir(), `shiv-print-${Date.now()}.pdf`)
    await writeFile(tmp, pdf)
    const printResult = await printFileWithLp(tmp, copies, `Shiv ${kind ?? 'quotation'}`, printer, isCard ? EPSON_CARD_PRINT_SETTINGS : [])
    return {
      printer,
      jobId: printResult.jobId,
    }
  } finally {
    await browser?.close().catch(() => {})
    if (tmp) await unlink(tmp).catch(() => {})
  }
}

async function cloudRequest(path, options = {}) {
  if (!CLOUD_API_URL) throw new Error('CLOUD_API_URL is not configured')
  const response = await fetch(`${CLOUD_API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(CLOUD_API_KEY ? { Authorization: `Bearer ${CLOUD_API_KEY}` } : {}),
      ...(options.headers ?? {}),
    },
  })
  const json = await response.json().catch(() => null)
  if (!response.ok || json?.ok === false) {
    throw new Error(json?.error ?? `Cloud API returned HTTP ${response.status}`)
  }
  return json
}

async function markCloudJob(path, body) {
  await cloudRequest(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

async function printCloudJob(job) {
  const copies = sanitizeCopies(job.copies)
  if (job.kind === 'quotation') {
    const quote = job.payload?.quote ?? job.payload
    return await printDocumentPayload({ kind: 'quotation', quote }, copies)
  }

  if (job.kind === 'guarantee') {
    const document = job.payload?.document ?? job.payload
    const layout = job.payload?.layout ?? 'a4'
    return await printDocumentPayload({ kind: 'guarantee', document, layout }, copies)
  }

  if (job.kind === 'raw-file') {
    const files = Array.isArray(job.payload?.files) ? job.payload.files : [job.payload]
    const results = []
    for (let i = 0; i < files.length; i += 1) {
      results.push(await printUploadedFile(decodeUploadedFile(files[i], i), copies))
    }
    return { files: results }
  }

  throw new Error(`Unsupported cloud print job kind: ${job.kind}`)
}

let cloudPollRunning = false

async function pollCloudPrintJobs() {
  if (!CLOUD_API_URL || cloudPollRunning) return
  cloudPollRunning = true
  try {
    const response = await cloudRequest('/api/print-jobs/claim', {
      method: 'POST',
      body: JSON.stringify({ printerId: PRINTER_AGENT_ID, limit: 3 }),
    })
    const jobs = Array.isArray(response.jobs) ? response.jobs : []

    for (const job of jobs) {
      try {
        await markCloudJob(`/api/print-jobs/${job._id}/printing`, { printerId: PRINTER_AGENT_ID })
        await printCloudJob(job)
        await markCloudJob(`/api/print-jobs/${job._id}/complete`, { printerId: PRINTER_AGENT_ID })
        console.log(`[cloud-print] completed ${job._id}`)
      } catch (err) {
        console.error(`[cloud-print] failed ${job._id}`, err)
        await markCloudJob(`/api/print-jobs/${job._id}/fail`, {
          printerId: PRINTER_AGENT_ID,
          error: String(err.message ?? err),
        }).catch(markErr => console.error('[cloud-print] failed to mark failure', markErr))
      }
    }
  } catch (err) {
    console.warn('[cloud-print] poll failed:', err.message ?? err)
  } finally {
    cloudPollRunning = false
  }
}

function buildWhatsAppPrintPage() {
  const uploadUrl = `${PRINT_SERVER_PUBLIC_URL}/whatsapp-print`
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Shiv WhatsApp Print</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f7f9;
      color: #151922;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    main {
      width: min(560px, 100%);
      background: white;
      border: 1px solid #dde2ea;
      border-radius: 8px;
      box-shadow: 0 16px 40px rgba(21, 25, 34, 0.10);
      padding: 22px;
    }
    h1 {
      font-size: 24px;
      line-height: 1.2;
      margin: 0 0 8px;
      letter-spacing: 0;
    }
    p {
      margin: 0 0 18px;
      color: #596273;
      line-height: 1.5;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 700;
      color: #303747;
      margin-bottom: 8px;
    }
    input[type="file"],
    input[type="number"] {
      width: 100%;
      border: 1px solid #cbd3df;
      border-radius: 6px;
      padding: 12px;
      font: inherit;
      background: #fff;
    }
    .row {
      display: grid;
      gap: 16px;
      margin-bottom: 16px;
    }
    button,
    a.button {
      width: 100%;
      border: 0;
      border-radius: 6px;
      background: #117a37;
      color: white;
      font: inherit;
      font-weight: 800;
      padding: 13px 16px;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
    }
    button:disabled {
      cursor: wait;
      opacity: 0.65;
    }
    a.button {
      display: block;
      margin-top: 10px;
      background: #263244;
    }
    .status {
      min-height: 24px;
      margin-top: 14px;
      font-size: 14px;
      color: #303747;
      white-space: pre-wrap;
    }
    .error { color: #b42318; }
    .ok { color: #067647; }
    small {
      display: block;
      margin-top: 14px;
      color: #7a8392;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
  </style>
</head>
<body>
  <main>
    <h1>Shiv WhatsApp Print</h1>
    <p>Select photos or PDFs from WhatsApp and print them on the shop computer.</p>
    <form id="printForm">
      <div class="row">
        <div>
          <label for="files">Images or PDFs</label>
          <input id="files" name="files" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" multiple required />
        </div>
        <div>
          <label for="copies">Copies</label>
          <input id="copies" name="copies" type="number" min="1" max="20" value="1" />
        </div>
      </div>
      <button id="submitButton" type="submit">Print Selected Files</button>
      <a class="button" href="/whatsapp-print/share">Share This Link on WhatsApp</a>
      <div id="status" class="status"></div>
    </form>
    <small>Link: ${escapeHtml(uploadUrl)}<br />Allowed: PDF, JPG, PNG, WEBP, GIF. Max ${WHATSAPP_MAX_FILES} files, ${Math.round(WHATSAPP_MAX_FILE_BYTES / 1024 / 1024)} MB each.</small>
  </main>
  <script>
    const form = document.getElementById('printForm')
    const filesInput = document.getElementById('files')
    const copiesInput = document.getElementById('copies')
    const button = document.getElementById('submitButton')
    const status = document.getElementById('status')

    function readFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error(file.name + ': could not read file'))
        reader.onload = () => {
          const result = String(reader.result || '')
          resolve({
            name: file.name,
            mediaType: file.type || 'application/octet-stream',
            data: result.includes(',') ? result.slice(result.indexOf(',') + 1) : result,
          })
        }
        reader.readAsDataURL(file)
      })
    }

    form.addEventListener('submit', async event => {
      event.preventDefault()
      status.className = 'status'
      const selected = Array.from(filesInput.files || [])
      if (!selected.length) {
        status.className = 'status error'
        status.textContent = 'Select at least one file.'
        return
      }
      if (selected.length > ${WHATSAPP_MAX_FILES}) {
        status.className = 'status error'
        status.textContent = 'Select ${WHATSAPP_MAX_FILES} files or fewer.'
        return
      }

      button.disabled = true
      status.textContent = 'Reading files...'
      try {
        const files = await Promise.all(selected.map(readFile))
        status.textContent = 'Sending to printer...'
        const response = await fetch('/whatsapp-print/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files, copies: copiesInput.value }),
        })
        const json = await response.json().catch(() => null)
        if (!response.ok || !json || !json.ok) {
          throw new Error((json && json.error) || 'Print failed')
        }
        status.className = 'status ok'
        status.textContent = 'Printed ' + json.jobs.length + ' file(s).\\n' + json.jobs.map(job => job.name + (job.jobId ? ' - ' + job.jobId : '')).join('\\n')
        form.reset()
        copiesInput.value = '1'
      } catch (error) {
        status.className = 'status error'
        status.textContent = error && error.message ? error.message : String(error)
      } finally {
        button.disabled = false
      }
    })
  </script>
</body>
</html>`
}

async function writeJSON(url, value) {
  await writeFile(url, `${JSON.stringify(value, null, 2)}\n`)
}

function uniquePush(list, value) {
  const clean = String(value ?? '').trim()
  if (!clean) return false
  if (list.some(existing => normalizeNameKey(existing) === normalizeNameKey(clean))) return false
  list.push(clean)
  return true
}

function splitCustomerParts(value) {
  const parts = String(value ?? '').split(',').map(part => part.trim()).filter(Boolean)
  return {
    name: parts[0] ?? '',
    place: parts.slice(1).join(', '),
  }
}

function learnNameCorrections(beforeName, afterName) {
  const before = splitCustomerParts(beforeName).name
  const after = splitCustomerParts(afterName).name
  if (!before || !after || normalizeNameKey(before) === normalizeNameKey(after)) return []

  const learned = []
  const data = readJSON(NAME_CORRECTIONS_URL, { preferredNames: [], ocrCorrections: {} })
  const beforeTokens = before.match(/\b[a-z][a-z'.-]{2,}\b/gi) ?? []
  const afterTokens = after.match(/\b[a-z][a-z'.-]{2,}\b/gi) ?? []

  for (const token of afterTokens) uniquePush(data.preferredNames, titleCaseName(token))

  if (beforeTokens.length === afterTokens.length) {
    for (let i = 0; i < beforeTokens.length; i += 1) {
      const from = normalizeNameKey(beforeTokens[i])
      const to = titleCaseName(afterTokens[i])
      if (!from || HONORIFICS.has(from) || normalizeNameKey(to) === from) continue
      data.ocrCorrections[from] = to
      learned.push(`name:${from}->${to}`)
    }
  }

  return learned.length ? [{ url: NAME_CORRECTIONS_URL, data, learned }] : []
}

function learnPlaceCorrections(beforeData, afterData) {
  const beforePlace = beforeData.address || splitCustomerParts(beforeData.customerName).place
  const afterPlace = afterData.address || splitCustomerParts(afterData.customerName).place
  if (!beforePlace || !afterPlace || normalizeNameKey(beforePlace) === normalizeNameKey(afterPlace)) return []

  const data = readJSON(PLACE_CORRECTIONS_URL, { preferredPlaces: [], ocrCorrections: {} })
  uniquePush(data.preferredPlaces, afterPlace)
  data.ocrCorrections[normalizeNameKey(beforePlace)] = afterPlace
  return [{ url: PLACE_CORRECTIONS_URL, data, learned: [`place:${beforePlace}->${afterPlace}`] }]
}

function cleanedLearnedItem(item) {
  return {
    category: item.category ?? 'readymade-door',
    heightInches: item.heightInches ?? null,
    heightSoot: item.heightSoot ?? 0,
    widthInches: item.widthInches ?? null,
    widthSoot: item.widthSoot ?? 0,
    sizeLabel: item.sizeLabel ?? null,
    qty: item.qty ?? 1,
    amount: item.amount ?? null,
    guaranteeYears: item.guaranteeYears ?? 0,
  }
}

function itemChanged(beforeItem, afterItem) {
  return JSON.stringify(cleanedLearnedItem(beforeItem ?? {})) !== JSON.stringify(cleanedLearnedItem(afterItem ?? {})) ||
    normalizeProductKey(beforeItem?.brandName) !== normalizeProductKey(afterItem?.brandName)
}

function learnProductCorrections(beforeItems, afterItems) {
  const before = Array.isArray(beforeItems) ? beforeItems : []
  const after = Array.isArray(afterItems) ? afterItems : []
  const data = readJSON(PRODUCT_CORRECTIONS_URL, [])
  const learned = []

  for (let i = 0; i < after.length; i += 1) {
    const corrected = after[i]
    const original = before[i] ?? {}
    const correctedBrand = String(corrected?.brandName ?? '').trim()
    const originalBrand = String(original?.brandName ?? '').trim()
    if (!correctedBrand) continue
    if (originalBrand && !itemChanged(original, corrected)) continue

    const correctedKey = normalizeProductKey(correctedBrand)
    const originalKey = normalizeProductKey(originalBrand || correctedBrand)
    const brandChanged = normalizeProductKey(originalBrand) !== correctedKey
    if (originalBrand && !brandChanged) continue
    let entry = data.find(item => normalizeNameKey(item.canonicalBrandName) === normalizeNameKey(correctedBrand))

    if (!entry) {
      entry = {
        canonicalBrandName: correctedBrand,
        match: [correctedBrand],
        ...cleanedLearnedItem(corrected),
      }
      data.push(entry)
      learned.push(`product:new:${correctedBrand}`)
    } else {
      Object.assign(entry, cleanedLearnedItem(corrected))
    }

    entry.match = Array.isArray(entry.match) ? entry.match : []
    for (const match of [originalBrand, correctedBrand, originalKey, correctedKey]) {
      if (!match) continue
      if (!entry.match.some(existing => normalizeProductKey(existing) === normalizeProductKey(match))) {
        entry.match.push(match)
        learned.push(`product:match:${match}->${correctedBrand}`)
      }
    }
  }

  return learned.length ? [{ url: PRODUCT_CORRECTIONS_URL, data, learned }] : []
}

async function learnFromScan(beforeData, afterData) {
  const pending = [
    ...learnNameCorrections(beforeData.customerName, afterData.customerName),
    ...learnPlaceCorrections(beforeData, afterData),
    ...learnProductCorrections(beforeData.items, afterData.items),
  ]

  const learned = []
  for (const update of pending) {
    await writeJSON(update.url, update.data)
    learned.push(...update.learned)
  }

  if (learned.length) {
    await appendFile(SCAN_FEEDBACK_URL, `${JSON.stringify({ at: new Date().toISOString(), learned, before: beforeData, after: afterData })}\n`)
    NAME_DATA = loadNameData()
    PLACE_DATA = loadPlaceData()
    PRODUCT_CORRECTIONS = loadProductCorrections()
  }

  return learned
}

// ── Claude Sonnet: image → JSON directly ─────────────────────────────────────
async function scanWithClaude(image, mediaType) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const t0 = Date.now()
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: JSON_MAX_TOKENS,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
        { type: 'text', text: EXTRACT_PROMPT },
      ],
    }],
  })
  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return { data: normalizeScanData(parseJSON(text)), ms: Date.now() - t0, provider: 'claude' }
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/status', (_req, res) => res.json({
  ok: true,
  server: 'Shiv Print Server',
  printer: PRINT_PRINTER,
  printers: {
    color: COLOR_PRINTER,
    blackAndWhite: BW_PRINTER,
  },
}))
app.get('/scan-bill', (_req, res) => res.json({ ok: true, message: 'Use POST with { image, mediaType }. Scanner uses Claude only.' }))

// ── Scan Bill ─────────────────────────────────────────────────────────────────
app.post('/scan-bill', async (req, res) => {
  const { image, mediaType = 'image/jpeg' } = req.body
  if (!image) return res.status(400).json({ error: 'Missing image (base64)' })

  try {
    const result = await scanWithClaude(image, mediaType)
    console.log(`[scan-bill:claude] ${result.ms}ms`, JSON.stringify(result.data, null, 2))
    res.json({ ok: true, data: result.data, ms: result.ms })
  } catch (err) {
    console.error('[scan-bill error]', err)
    res.status(500).json({ error: String(err) })
  }
})

app.post('/scan-bill/learn', async (req, res) => {
  const { before, after } = req.body
  if (!before || !after) return res.status(400).json({ error: 'Missing before/after scan data' })

  try {
    const learned = await learnFromScan(before, after)
    const normalizedAfter = normalizeScanData(after)
    res.json({ ok: true, learned, data: normalizedAfter })
  } catch (err) {
    console.error('[scan-bill learn error]', err)
    res.status(500).json({ error: String(err) })
  }
})

// -- WhatsApp Upload Print ----------------------------------------------------
app.get('/whatsapp-print', (_req, res) => {
  res.type('html').send(buildWhatsAppPrintPage())
})

app.get('/whatsapp-print/share', (_req, res) => {
  const message = `Open this Shiv Hardware print link to send PDFs and images to the shop printer: ${PRINT_SERVER_PUBLIC_URL}/whatsapp-print`
  res.redirect(`https://wa.me/?text=${encodeURIComponent(message)}`)
})

app.get('/whatsapp-print/status', (_req, res) => {
  res.json({
    ok: true,
    printer: PRINT_PRINTER,
    printers: {
      color: COLOR_PRINTER,
      blackAndWhite: BW_PRINTER,
    },
    link: `${PRINT_SERVER_PUBLIC_URL}/whatsapp-print`,
    allowedMediaTypes: [...WHATSAPP_ALLOWED_MEDIA_TYPES],
    maxFiles: WHATSAPP_MAX_FILES,
    maxFileMb: Math.round(WHATSAPP_MAX_FILE_BYTES / 1024 / 1024),
  })
})

app.post('/whatsapp-print/jobs', async (req, res) => {
  const copies = sanitizeCopies(req.body?.copies)
  const rawFiles = Array.isArray(req.body?.files) ? req.body.files : []
  if (!rawFiles.length) return res.status(400).json({ error: 'Missing files' })
  if (rawFiles.length > WHATSAPP_MAX_FILES) return res.status(400).json({ error: `Maximum ${WHATSAPP_MAX_FILES} files allowed` })

  try {
    const files = rawFiles.map(decodeUploadedFile)
    const jobs = []
    for (const file of files) {
      jobs.push(await printUploadedFile(file, copies))
    }

    res.json({
      ok: true,
      printer: jobs[0]?.printer ?? PRINT_PRINTER,
      printers: {
        color: COLOR_PRINTER,
        blackAndWhite: BW_PRINTER,
      },
      copies,
      jobs,
    })
  } catch (err) {
    console.error('[whatsapp-print error]', err)
    res.status(500).json({ error: String(err.message ?? err) })
  }
})

// ── Print ─────────────────────────────────────────────────────────────────────
app.post('/print', async (req, res) => {
  const { kind, quote, document, layout = 'a4' } = req.body
  const copies = sanitizeCopies(req.body.copies)
  if (kind === 'guarantee' && !document) return res.status(400).json({ error: 'Missing guarantee document data' })
  if (kind !== 'guarantee' && !quote) return res.status(400).json({ error: 'Missing quotation data' })

  try {
    const printResult = await printDocumentPayload({ kind, quote, document, layout }, copies)
    res.json({
      ok: true,
      printer: printResult.printer,
      jobId: printResult.jobId,
    })
  } catch (err) {
    console.error('[print error]', err)
    res.status(500).json({ error: String(err) })
  }
})

// ── Render PNG ───────────────────────────────────────────────────────────────
app.post('/render-png', async (req, res) => {
  const { kind, quote, document, layout = 'a4' } = req.body
  const scale = Math.min(3, Math.max(1, Number(req.body.scale) || 2))
  if (kind === 'guarantee' && !document) return res.status(400).json({ error: 'Missing guarantee document data' })
  if (kind !== 'guarantee' && !quote) return res.status(400).json({ error: 'Missing quotation data' })

  let browser
  try {
    const html = kind === 'guarantee'
      ? await buildGuaranteeHtml(document, layout)
      : await buildQuotationHtml(quote)
    browser = await launchPuppeteerBrowser()
    const page = await browser.newPage()
    const width = Math.round((210 / 25.4) * 96)
    const height = Math.round((297 / 25.4) * 96)
    await page.setViewport({ width, height, deviceScaleFactor: scale })
    await page.setContent(html, { waitUntil: 'networkidle0' })
    await page.emulateMediaType('print')
    const target = await page.$('.page')
    const box = target ? await target.boundingBox() : null
    if (!box) throw new Error('Failed to measure A4 page for PNG render')
    const png = await page.screenshot({ type: 'png', clip: box })
    res.json({ ok: true, image: png.toString('base64'), mime: 'image/png' })
  } catch (err) {
    console.error('[render-png error]', err)
    res.status(500).json({ error: String(err) })
  } finally {
    await browser?.close().catch(() => {})
  }
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✓  Shiv Print Server running`)
  console.log(`   Local:   http://localhost:${PORT}`)
  console.log(`   Phone:   ${PRINT_SERVER_PUBLIC_URL}`)
  console.log(`   WhatsApp print: ${PRINT_SERVER_PUBLIC_URL}/whatsapp-print`)
  console.log(`   Default printer: ${PRINT_PRINTER}`)
  console.log(`   Color/ID printer: ${COLOR_PRINTER}`)
  console.log(`   B/W laser printer: ${BW_PRINTER}`)
  console.log(`   Browser: ${CHROME_PATH ?? 'Puppeteer managed Chrome'}`)
  if (CLOUD_API_URL) {
    console.log(`   Cloud API: ${CLOUD_API_URL}`)
    console.log(`   Cloud printer agent: ${PRINTER_AGENT_ID}`)
    setInterval(pollCloudPrintJobs, CLOUD_POLL_INTERVAL_MS)
    pollCloudPrintJobs()
  } else {
    console.log('   Cloud polling: disabled')
  }
  if (!process.env.ANTHROPIC_API_KEY) console.warn('⚠  ANTHROPIC_API_KEY not set')
  console.log()
})
