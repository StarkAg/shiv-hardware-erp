/**
 * IPP, spoken straight to a network printer: no Windows driver, no print
 * program. The file goes to the printer as it is (a PDF or a JPEG) and the
 * printer draws it itself, which is the quickest way onto paper.
 *
 *   getPrinterAttributes(url)                    what the printer is and takes
 *   printJob(url, data, { format, copies, ... }) sends one file to print
 *
 * `url` is the printer's IPP address, e.g. http://192.168.29.184:631/ipp/print.
 * Only the parts of RFC 8010/8011 that these two operations need.
 */

import http from 'node:http'
import https from 'node:https'

const TAG = {
  operation: 0x01, job: 0x02, end: 0x03, printer: 0x04, unsupported: 0x05,
  integer: 0x21, boolean: 0x22, enum: 0x23,
  octetString: 0x30, dateTime: 0x31, resolution: 0x32, rangeOfInteger: 0x33, begCollection: 0x34,
  textWithLanguage: 0x35, nameWithLanguage: 0x36, endCollection: 0x37,
  text: 0x41, name: 0x42, keyword: 0x44, uri: 0x45, uriScheme: 0x46, charset: 0x47, naturalLanguage: 0x48,
  mimeMediaType: 0x49, memberAttrName: 0x4a,
}
const OP = { printJob: 0x0002, getPrinterAttributes: 0x000b }

/** Status codes below 0x0100 are success (some with a note). */
export const ippOk = (status) => status < 0x0100

let nextRequestId = 1

function attr(tag, name, values) {
  const parts = []
  const list = Array.isArray(values) ? values : [values]
  list.forEach((value, i) => {
    const nameBytes = Buffer.from(i === 0 ? name : '', 'utf8')
    let valueBytes
    if (tag === TAG.integer || tag === TAG.enum) {
      valueBytes = Buffer.alloc(4)
      valueBytes.writeInt32BE(value)
    } else if (tag === TAG.boolean) {
      valueBytes = Buffer.from([value ? 1 : 0])
    } else {
      valueBytes = Buffer.from(String(value), 'utf8')
    }
    const head = Buffer.alloc(3)
    head.writeUInt8(tag, 0)
    head.writeUInt16BE(nameBytes.length, 1)
    const len = Buffer.alloc(2)
    len.writeUInt16BE(valueBytes.length)
    parts.push(head, nameBytes, len, valueBytes)
  })
  return Buffer.concat(parts)
}

function request(operation, printerUri, groups) {
  const head = Buffer.alloc(8)
  head.writeUInt8(2, 0) // IPP 2.0
  head.writeUInt8(0, 1)
  head.writeUInt16BE(operation, 2)
  head.writeUInt32BE(nextRequestId++, 4)
  const body = [head]
  for (const [groupTag, attrs] of groups) {
    if (!attrs.length) continue
    body.push(Buffer.from([groupTag]), ...attrs)
  }
  body.push(Buffer.from([TAG.end]))
  return Buffer.concat(body)
}

function operationAttrs(printerUri, extra = []) {
  return [
    attr(TAG.charset, 'attributes-charset', 'utf-8'),
    attr(TAG.naturalLanguage, 'attributes-natural-language', 'en'),
    attr(TAG.uri, 'printer-uri', printerUri),
    attr(TAG.name, 'requesting-user-name', 'shiv-print-server'),
    ...extra,
  ]
}

/** An IPP response: its status and every attribute, by group, as name -> value(s). */
export function parseResponse(buf) {
  const out = { version: `${buf[0]}.${buf[1]}`, status: buf.readUInt16BE(2), requestId: buf.readUInt32BE(4), groups: [] }
  let i = 8
  let group = null
  let lastName = null
  let depth = 0
  while (i < buf.length) {
    const tag = buf[i]
    if (tag === TAG.end) break
    if (tag < 0x10) {
      group = { tag, attrs: {} }
      out.groups.push(group)
      i += 1
      continue
    }
    const nameLen = buf.readUInt16BE(i + 1)
    const name = buf.toString('utf8', i + 3, i + 3 + nameLen)
    i += 3 + nameLen
    const valueLen = buf.readUInt16BE(i)
    const raw = buf.subarray(i + 2, i + 2 + valueLen)
    i += 2 + valueLen
    // Collections (media-col and the like) are skipped whole: not needed here.
    if (tag === TAG.begCollection) { depth += 1; continue }
    if (tag === TAG.endCollection) { depth -= 1; continue }
    if (depth > 0) continue
    let value
    if (tag === TAG.integer || tag === TAG.enum) value = raw.readInt32BE(0)
    else if (tag === TAG.boolean) value = raw[0] === 1
    else if (tag === TAG.rangeOfInteger) value = [raw.readInt32BE(0), raw.readInt32BE(4)]
    else if (tag === TAG.resolution) value = `${raw.readInt32BE(0)}x${raw.readInt32BE(4)}${raw[8] === 3 ? 'dpi' : 'dpcm'}`
    else if (tag === TAG.dateTime || tag === TAG.octetString) value = raw.toString('hex')
    else value = raw.toString('utf8')
    const key = nameLen ? name : lastName
    if (nameLen) lastName = name
    if (!group || !key) continue
    if (key in group.attrs && !nameLen) {
      const prev = group.attrs[key]
      group.attrs[key] = Array.isArray(prev) ? [...prev, value] : [prev, value]
    } else {
      group.attrs[key] = value
    }
  }
  return out
}

/**
 * One IPP request, sent CHUNKED. The shop HP takes the request with a
 * Content-Length, waits about 30 s for a document it already has, and aborts
 * the job (jobs 24-26, 25 Nov 2026); sent chunked, as phones send, it answered
 * in 0.6 s and printed (job 27). So every request goes chunked.
 */
function send(url, body, timeoutMs) {
  const target = new URL(url.replace(/^ipp:/i, 'http:').replace(/^ipps:/i, 'https:'))
  const client = target.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = client.request({
      host: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 631),
      path: target.pathname + target.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/ipp', 'Transfer-Encoding': 'chunked' },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode > 299) return reject(new Error(`printer answered HTTP ${res.statusCode}`))
        try { resolve(parseResponse(Buffer.concat(chunks))) } catch (err) { reject(err) }
      })
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error(`printer did not answer within ${Math.round(timeoutMs / 1000)} s`)))
    req.on('error', reject)
    for (let i = 0; i < body.length; i += 65536) req.write(body.subarray(i, i + 65536))
    req.end()
  })
}

const ippUri = (url) => url.replace(/^http:/i, 'ipp:').replace(/^https:/i, 'ipps:')
const listOf = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])

/** The printer's own description: formats, sizes, colour modes, trays, state. */
export async function getPrinterAttributes(url, { timeoutMs = 5000 } = {}) {
  const body = request(OP.getPrinterAttributes, ippUri(url), [
    [TAG.operation, operationAttrs(ippUri(url), [attr(TAG.keyword, 'requested-attributes', ['all', 'media-col-database'])])],
  ])
  const res = await send(url, body, timeoutMs)
  if (!ippOk(res.status)) throw new Error(`printer refused Get-Printer-Attributes (0x${res.status.toString(16)})`)
  return res.groups.find((g) => g.tag === TAG.printer)?.attrs ?? {}
}

/** Formats the printer reads by itself, from its attributes. */
export const formatsOf = (attrs) => listOf(attrs['document-format-supported'])

/**
 * Sends one file to print. `format` is its type (application/pdf, image/jpeg…).
 * Job settings the printer does not list as supported are left out rather
 * than risk a refusal.
 */
export async function printJob(url, data, {
  format, copies = 1, jobName = 'Shiv Print', color = null, media = 'iso_a4_210x297mm',
  orientation = null, fit = true, quality = null, attrs = null, timeoutMs = 120000,
} = {}) {
  const supports = (name, value) => !attrs || listOf(attrs[`${name}-supported`]).includes(value)
  const job = []
  if (copies > 1) job.push(attr(TAG.integer, 'copies', copies))
  if (media && supports('media', media)) job.push(attr(TAG.keyword, 'media', media))
  if (color != null) {
    const mode = color ? 'color' : 'monochrome'
    if (supports('print-color-mode', mode)) job.push(attr(TAG.keyword, 'print-color-mode', mode))
  }
  if (orientation && supports('orientation-requested', orientation === 'landscape' ? 4 : 3)) {
    job.push(attr(TAG.enum, 'orientation-requested', orientation === 'landscape' ? 4 : 3))
  }
  if (fit && supports('print-scaling', 'fit')) job.push(attr(TAG.keyword, 'print-scaling', 'fit'))
  if (quality && supports('print-quality', quality)) job.push(attr(TAG.enum, 'print-quality', quality))

  const head = request(OP.printJob, ippUri(url), [
    [TAG.operation, operationAttrs(ippUri(url), [
      attr(TAG.name, 'job-name', jobName.slice(0, 120)),
      attr(TAG.mimeMediaType, 'document-format', format),
    ])],
    [TAG.job, job],
  ])
  const res = await send(url, Buffer.concat([head, data]), timeoutMs)
  const jobAttrs = res.groups.find((g) => g.tag === TAG.job)?.attrs ?? {}
  if (!ippOk(res.status)) {
    const message = res.groups.find((g) => g.tag === TAG.operation)?.attrs['status-message']
    throw new Error(`printer refused the job (0x${res.status.toString(16)}${message ? `: ${message}` : ''})`)
  }
  return { jobId: jobAttrs['job-id'] ?? null, state: jobAttrs['job-state'] ?? null, status: res.status }
}
