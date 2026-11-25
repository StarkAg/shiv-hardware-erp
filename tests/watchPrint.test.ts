import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM module without types
import { createFolderWatcher, globToRegExp, parseWatchList } from '../print-server/watch-print.mjs'

const setup = (opts: { canPrint?: () => Promise<boolean> } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'watch-'))
  const data = mkdtempSync(join(tmpdir(), 'watch-data-'))
  const printed: { name: string; mode: string | null }[] = []
  const watcher = createFolderWatcher({
    rules: parseWatchList(`${dir}|SBIDocument_*.pdf|bw`, 'C:/home'),
    seenFile: join(data, 'seen.json'),
    printFile: async (item: { name: string; mode: string | null }) => { printed.push({ name: item.name, mode: item.mode }) },
    log: () => {},
    ...opts,
  })
  const add = (name: string, body = '%PDF-1.4 test') => writeFileSync(join(dir, name), body)
  return { dir, data, printed, watcher, add }
}

describe('watched-folder printing', () => {
  it('reads the rules, ~ included, and "off"', () => {
    const [rule] = parseWatchList('~/Downloads|SBIDocument_*.pdf|bw', 'C:/Users/Stark')
    expect(rule.dir.replace(/\\/g, '/')).toBe('C:/Users/Stark/Downloads')
    expect(rule.mode).toBe('bw')
    expect(parseWatchList(undefined, 'C:/h')).toHaveLength(1) // the SBI default
    expect(parseWatchList('off', 'C:/h')).toEqual([])
    expect(parseWatchList('C:/x|*.pdf|weird', 'C:/h')[0].mode).toBeNull()
  })

  it('matches names the way Explorer does', () => {
    const re = globToRegExp('SBIDocument_*.pdf')
    expect(re.test('SBIDocument_25_Nov_2026.pdf')).toBe(true)
    expect(re.test('sbidocument_1.PDF')).toBe(true)
    expect(re.test('SBIDocument_25_Nov_2026 (1).pdf')).toBe(true)
    expect(re.test('my SBIDocument_1.pdf')).toBe(false)
    expect(re.test('SBIDocument_1.pdf.crdownload')).toBe(false)
  })

  it('leaves what was there on the first run, then prints each new file once, after it settles', async () => {
    const { add, watcher, printed } = setup()
    add('SBIDocument_old.pdf')
    await watcher.scan() // first look: noted, not printed
    add('SBIDocument_new.pdf')
    add('Other.pdf')
    add('SBIDocument_half.pdf.crdownload')
    await watcher.scan() // seen once: not yet steady
    expect(printed).toEqual([])
    await watcher.scan() // steady: prints
    await watcher.scan()
    await watcher.scan()
    expect(printed).toEqual([{ name: 'SBIDocument_new.pdf', mode: 'bw' }])
  })

  it('never prints a file twice across a restart, but prints one that came while it was off', async () => {
    const first = setup()
    await first.watcher.scan()
    first.add('SBIDocument_a.pdf')
    await first.watcher.scan(); await first.watcher.scan()
    expect(first.printed.map((p) => p.name)).toEqual(['SBIDocument_a.pdf'])

    // "Restart": a new watcher on the same folder and the same seen-file.
    writeFileSync(join(first.dir, 'SBIDocument_b.pdf'), '%PDF b')
    const printed: string[] = []
    const again = createFolderWatcher({
      rules: parseWatchList(`${first.dir}|SBIDocument_*.pdf|bw`, 'C:/h'),
      seenFile: join(first.data, 'seen.json'),
      printFile: async (item: { name: string }) => { printed.push(item.name) },
      log: () => {},
    })
    await again.scan(); await again.scan(); await again.scan()
    expect(printed).toEqual(['SBIDocument_b.pdf'])
  })

  it('prints a file again when it is downloaded again (new size or time)', async () => {
    const { add, watcher, printed, dir } = setup()
    await watcher.scan()
    add('SBIDocument_x.pdf', 'one')
    await watcher.scan(); await watcher.scan()
    add('SBIDocument_x.pdf', 'one, longer')
    utimesSync(join(dir, 'SBIDocument_x.pdf'), new Date(), new Date(Date.now() + 5000))
    await watcher.scan(); await watcher.scan()
    expect(printed.map((p) => p.name)).toEqual(['SBIDocument_x.pdf', 'SBIDocument_x.pdf'])
  })

  it('holds a file while no printer is usable and prints it once one is back', async () => {
    let up = false
    const { add, watcher, printed } = setup({ canPrint: async () => up })
    await watcher.scan()
    add('SBIDocument_wait.pdf')
    await watcher.scan(); await watcher.scan(); await watcher.scan()
    expect(printed).toEqual([])
    up = true
    await watcher.scan(); await watcher.scan()
    expect(printed.map((p) => p.name)).toEqual(['SBIDocument_wait.pdf'])
  })
})
