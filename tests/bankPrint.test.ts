import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
// @ts-expect-error plain ESM module without types
import { addressOf, createBankPrinterStore, isBankFile, parseBankNames } from '../print-server/bank-print.mjs'

describe('bank prints', () => {
  it('knows SBI PDFs by name, any case, with or without a folder', () => {
    const p = parseBankNames(undefined)
    expect(isBankFile('SBIDocument_26_Nov_2026 (1).pdf', p)).toBe(true)
    expect(isBankFile('sbidocument_x.PDF', p)).toBe(true)
    expect(isBankFile('C:\\Users\\x\\SBIDocument_a.pdf', p)).toBe(true)
    expect(isBankFile('bill.pdf', p)).toBe(false)
    expect(parseBankNames('off')).toEqual([])
  })

  it('keeps the chosen printer on disk, the Epson until one is chosen', async () => {
    const file = pathToFileURL(join(mkdtempSync(join(tmpdir(), 'bank-')), 'bank-printer.json'))
    const store = createBankPrinterStore(file, 'EPSON')
    expect(await store.get()).toBe('EPSON')
    await store.set('HP')
    expect(await createBankPrinterStore(file, 'EPSON').get()).toBe('HP')
  })

  it('reads a printer address from a URL or a bare host', () => {
    expect(addressOf('http://192.168.29.232:80/WSD/DEVICE')).toEqual({ host: '192.168.29.232', ports: [80] })
    expect(addressOf('http://192.168.29.184:631/ipp/print')).toEqual({ host: '192.168.29.184', ports: [631] })
    expect(addressOf('192.168.1.5')).toEqual({ host: '192.168.1.5', ports: [80, 631, 9100] })
    expect(addressOf('')).toBeNull()
  })
})
