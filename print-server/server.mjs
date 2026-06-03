// Shiv Hardware Print Server
// POST /scan-bill  { image, mediaType }             → guarantee card data
// POST /print      { quote, copies }                → PDF → printer

import { readFileSync } from 'fs'
try {
  readFileSync(new URL('.env', import.meta.url), 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=')
    if (k?.trim() && !k.startsWith('#')) process.env[k.trim()] = v.join('=').trim()
  })
} catch {}

import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import { exec } from 'child_process'
import { appendFile, writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildQuotationHtml } from './template.mjs'

const PORT = 3333
const JSON_MAX_TOKENS = 2048
const HONORIFICS = new Set(['jee', 'ji', 'sir', 'madam'])
const NAME_WORD_RE = /^[a-z][a-z'.-]{2,}$/i
const NAME_CORRECTIONS_URL = new URL('data/name-corrections.json', import.meta.url)
const PLACE_CORRECTIONS_URL = new URL('data/place-corrections.json', import.meta.url)
const PRODUCT_CORRECTIONS_URL = new URL('data/product-corrections.json', import.meta.url)
const SCAN_FEEDBACK_URL = new URL('data/scan-feedback.jsonl', import.meta.url)
const app = express()
app.use(cors())
app.use(express.json({ limit: '20mb' }))

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
      "guaranteeYears": 0 or 1 or 3 or 7 or 10 or 25
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
- Board size shorthand: 7x4 means sizeLabel "7x4", heightInches 84, heightSoot 0, widthInches 48, widthSoot 0; 8x4 means sizeLabel "8x4", heightInches 96, heightSoot 0, widthInches 48, widthSoot 0.
- 19mm board/sheet => category block-board-19. 12mm board/sheet => category block-board-12.
- If a board line looks like "19mm A" but context/amount matches this shorthand, read it as "19mm PF"; do not mark 19mm PF as guaranteed unless explicitly told otherwise.
- "6MM Panther PF" or "Panther PF" is a guaranteed 6mm plywood product: category plywood-6, 7x4 means heightInches 84 and widthInches 48, qty 1 if written 1 Pc, guaranteeYears 10.
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
    normalized.heightInches = 84
    normalized.heightSoot = 0
    normalized.widthInches = 48
    normalized.widthSoot = 0
  }
  if (/\b8\s*x\s*4\b/i.test(brandName)) {
    normalized.sizeLabel = '8x4'
    normalized.heightInches = 96
    normalized.heightSoot = 0
    normalized.widthInches = 48
    normalized.widthSoot = 0
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
app.get('/status', (_req, res) => res.json({ ok: true, server: 'Shiv Print Server' }))
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

// ── Print ─────────────────────────────────────────────────────────────────────
app.post('/print', async (req, res) => {
  const { quote, copies = 1 } = req.body
  if (!quote) return res.status(400).json({ error: 'Missing quote data' })
  try {
    const html = await buildQuotationHtml(quote)
    const { default: puppeteer } = await import('puppeteer')
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({ format: 'A4', printBackground: true })
    await browser.close()
    const tmp = join(tmpdir(), `shiv-print-${Date.now()}.pdf`)
    await writeFile(tmp, pdf)
    await new Promise((ok, fail) =>
      exec(`lp -n ${copies} "${tmp}"`, (err, stdout) => {
        if (err) fail(err); else { console.log('[print]', stdout.trim()); ok() }
      }),
    )
    await unlink(tmp)
    res.json({ ok: true })
  } catch (err) {
    console.error('[print error]', err)
    res.status(500).json({ error: String(err) })
  }
})

app.listen(PORT, '0.0.0.0', () => {
  const ip = '192.168.29.174'
  console.log(`\n✓  Shiv Print Server running`)
  console.log(`   Local:   http://localhost:${PORT}`)
  console.log(`   Phone:   http://${ip}:${PORT}`)
  if (!process.env.ANTHROPIC_API_KEY) console.warn('⚠  ANTHROPIC_API_KEY not set')
  console.log()
})
