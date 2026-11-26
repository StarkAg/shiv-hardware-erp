import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
// @ts-expect-error plain ESM module without types
import { addressOf, createRouteStore, isBankFile, parseBankNames, pickRoute, settingsFor } from '../print-server/bank-print.mjs'

const DEFAULTS = {
  bank: { printer: 'EPSON', color: true, fallback: 'HP' },
  quotation: { printer: 'EPSON', color: true, fallback: 'HP' },
}
const dir = () => mkdtempSync(join(tmpdir(), 'routes-'))

describe('bank prints', () => {
  it('knows SBI PDFs by name, any case, with or without a folder', () => {
    const p = parseBankNames(undefined)
    expect(isBankFile('SBIDocument_26_Nov_2026 (1).pdf', p)).toBe(true)
    expect(isBankFile('sbidocument_x.PDF', p)).toBe(true)
    expect(isBankFile('C:\\Users\\x\\SBIDocument_a.pdf', p)).toBe(true)
    expect(isBankFile('bill.pdf', p)).toBe(false)
    expect(parseBankNames('off')).toEqual([])
  })

  it('reads a printer address from a URL or a bare host', () => {
    expect(addressOf('http://192.168.29.232:80/WSD/DEVICE')).toEqual({ host: '192.168.29.232', ports: [80] })
    expect(addressOf('http://192.168.29.184:631/ipp/print')).toEqual({ host: '192.168.29.184', ports: [631] })
    expect(addressOf('192.168.1.5')).toEqual({ host: '192.168.1.5', ports: [80, 631, 9100] })
    expect(addressOf('')).toBeNull()
  })
})

describe('print routes', () => {
  it('keeps each job on disk: the defaults until chosen, a fallback of none kept as none', async () => {
    const d = dir()
    const file = pathToFileURL(join(d, 'print-routes.json'))
    const store = createRouteStore(file, DEFAULTS)
    expect(await store.get('quotation')).toEqual(DEFAULTS.quotation)
    await store.set('quotation', { color: false, fallback: null })
    await store.set('bank', { printer: 'HP' })
    const again = createRouteStore(file, DEFAULTS)
    expect(await again.get('quotation')).toEqual({ printer: 'EPSON', color: false, fallback: null })
    expect(await again.get('bank')).toEqual({ printer: 'HP', color: true, fallback: 'HP' })
    await expect(store.set('bill', {})).rejects.toThrow()
  })

  it('takes the bank printer chosen before routes existed', async () => {
    const d = dir()
    writeFileSync(join(d, 'bank-printer.json'), JSON.stringify({ printer: 'USB HP' }))
    const store = createRouteStore(pathToFileURL(join(d, 'print-routes.json')), DEFAULTS, pathToFileURL(join(d, 'bank-printer.json')))
    expect((await store.get('bank')).printer).toBe('USB HP')
    expect((await store.get('quotation')).printer).toBe('EPSON')
  })

  it('prints on the fallback only when the first is offline and the fallback online', async () => {
    const online = (up: string[]) => async (name: string) => ({ online: up.includes(name), reason: up.includes(name) ? null : 'off' })
    const route = { printer: 'EPSON', color: true, fallback: 'HP' }
    expect(await pickRoute(route, online(['EPSON', 'HP']))).toMatchObject({ printer: 'EPSON', fallback: null, online: true })
    expect(await pickRoute(route, online(['HP']))).toMatchObject({ printer: 'HP', fallback: { from: 'EPSON', to: 'HP' }, online: true })
    expect(await pickRoute(route, online([]))).toMatchObject({ printer: 'EPSON', online: false })
    expect(await pickRoute({ ...route, fallback: null }, online(['HP']))).toMatchObject({ printer: 'EPSON', online: false })
  })

  it('sets colour or black and white, and a tray only for the Epson', () => {
    const base = ['fit', 'color', 'portrait', 'paper=A4', 'bin=Rear Paper Feeder']
    expect(settingsFor(base, 'EPSONE46549 (L8050 Series)', false)).toEqual(['fit', 'portrait', 'paper=A4', 'bin=Rear Paper Feeder', 'monochrome'])
    expect(settingsFor(base, 'NPI33F31D (HP LaserJet Tank MFP 2606sdw)', true)).toEqual(['fit', 'portrait', 'paper=A4', 'color'])
  })
})
