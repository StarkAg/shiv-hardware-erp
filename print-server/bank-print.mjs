/**
 * Bank prints (SBI's PDFs) and the shop's printers as the Counter's Printers
 * screen shows them.
 *
 * Which printer the bank PDFs go to is chosen on that screen and kept in
 * data/bank-printer.json. Until one is chosen they go to the Epson (owner's
 * ask, 26 Nov 2026). They print black and white wherever they go.
 *
 * BANK_PRINT_NAMES in .env: the file names that count as bank prints, split
 * by ";", * and ? wildcards. Default: SBIDocument_*.pdf.
 *
 * Online / offline: Windows' own state of a printer is not enough. A Wi-Fi
 * printer that is switched off still shows "Normal" for minutes. So a printer
 * on the network is also knocked on at its address (port 80, 631 or 9100);
 * one that does not answer is offline.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { Socket } from 'node:net'
import { globToRegExp } from './watch-print.mjs'

export const DEFAULT_BANK_NAMES = 'SBIDocument_*.pdf'

export function parseBankNames(value) {
  const text = String(value ?? DEFAULT_BANK_NAMES).trim()
  if (!text || /^(off|false|no|0)$/i.test(text)) return []
  return text.split(';').map((s) => s.trim()).filter(Boolean).map(globToRegExp)
}

/** True for a file that is a bank print, by its name. */
export function isBankFile(name, patterns) {
  const n = String(name ?? '').split(/[\\/]/).pop()
  return Boolean(n) && patterns.some((re) => re.test(n))
}

/** The chosen bank printer, kept on disk; `fallback` until one is chosen. */
export function createBankPrinterStore(fileUrl, fallback) {
  let printer = fallback
  let loaded = false
  return {
    async get() {
      if (!loaded) {
        loaded = true
        try {
          const saved = JSON.parse(await readFile(fileUrl, 'utf8'))
          if (saved?.printer) printer = String(saved.printer)
        } catch { /* none chosen yet */ }
      }
      return printer
    },
    async set(name) {
      printer = String(name)
      loaded = true
      await writeFile(fileUrl, JSON.stringify({ printer, at: new Date().toISOString() }, null, 2))
      return printer
    },
  }
}

/** "http://192.168.29.232:80/WSD/DEVICE", "192.168.29.184" -> { host, ports }. */
export function addressOf(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  try {
    if (/^[a-z]+:\/\//i.test(raw)) {
      const u = new URL(raw)
      const port = Number(u.port) || (u.protocol === 'https:' ? 443 : u.protocol === 'ipp:' ? 631 : 80)
      return u.hostname ? { host: u.hostname, ports: [port] } : null
    }
  } catch { return null }
  if (/^[\w.-]+$/.test(raw)) return { host: raw, ports: [80, 631, 9100] }
  return null
}

/** Whether something answers at host on any of the ports, within ms. */
export function knock({ host, ports }, ms = 1500) {
  return new Promise((resolve) => {
    let left = ports.length
    let done = false
    const sockets = []
    const finish = (ok) => {
      if (done) return
      if (ok || --left <= 0) {
        done = true
        for (const s of sockets) s.destroy()
        resolve(ok)
      }
    }
    for (const port of ports) {
      const s = new Socket()
      sockets.push(s)
      s.setTimeout(ms)
      s.once('connect', () => finish(true))
      s.once('timeout', () => finish(false))
      s.once('error', () => finish(false))
      s.connect(port, host)
    }
  })
}

// Not printers anyone prints a bank statement on.
const VIRTUAL = /pdf|onenote|fax|xps|thermal|test/i
const READY = new Set(['Normal', 'Idle', 'Printing', 'Processing', 'WarmingUp'])

// Every printer with its Windows state and, for a network one, its address
// (a TCP/IP port's host, or the location a Wi-Fi (WSD) printer gave Windows).
const LIST_SCRIPT = `
$wsd = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Print\\Monitors\\WSD Port\\Ports'
$cim = @{}; Get-CimInstance Win32_Printer | ForEach-Object { $cim[$_.Name] = $_ }
$ports = @{}; Get-PrinterPort | ForEach-Object { $ports[$_.Name] = $_ }
$out = @(Get-Printer | ForEach-Object {
  $p = $_; $addr = $null
  $port = $ports[$p.PortName]
  if ($port -and $port.PrinterHostAddress) { $addr = $port.PrinterHostAddress }
  if (-not $addr) {
    $uuid = (Get-ItemProperty "$wsd\\$($p.PortName)" -ErrorAction SilentlyContinue).'Printer UUID'
    if ($uuid) {
      $loc = (Get-PnpDeviceProperty -InstanceId "SWD\\DAFWSDProvider\\urn:uuid:$uuid" -KeyName DEVPKEY_Device_LocationInfo -ErrorAction SilentlyContinue).Data
      if ($loc) { $addr = "$loc" }
    }
  }
  $c = $cim[$p.Name]
  [pscustomobject]@{ name = $p.Name; status = "$($p.PrinterStatus)"; port = $p.PortName; workOffline = [bool]$c.WorkOffline; errorState = [int]$c.DetectedErrorState; address = $addr }
})
ConvertTo-Json @($out) -Compress
`

/**
 * The shop's printers, each { name, online, reason, address }.
 * execFileAsync runs PowerShell; knownAddresses (name -> URL) fills in any
 * address Windows does not know, such as an IPP printer from .env.
 */
export function createPrinterStatus({ execFileAsync, knownAddresses = new Map(), cacheMs = 5000 }) {
  let cache = null
  let inFlight = null

  async function look() {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', LIST_SCRIPT], { windowsHide: true, timeout: 30000 })
    const parsed = JSON.parse(String(stdout || '').trim() || '[]')
    const rows = (Array.isArray(parsed) ? parsed : [parsed]).filter((p) => p?.name && !VIRTUAL.test(p.name))
    return await Promise.all(rows.map(async (p) => {
      const address = p.address || knownAddresses.get(p.name) || null
      const target = addressOf(address)
      let reason = null
      if (p.workOffline) reason = 'Set to use offline in Windows'
      else if (!READY.has(p.status)) reason = `Windows says ${p.status}`
      else if (p.errorState && p.errorState !== 2) reason = 'Printer reports an error'
      if (!reason && target && !(await knock(target))) reason = 'Not answering: switched off or not on the Wi-Fi'
      return { name: p.name, online: !reason, reason, address: target?.host ?? null, port: p.port }
    }))
  }

  return {
    async list({ fresh = false } = {}) {
      if (!fresh && cache && Date.now() - cache.at < cacheMs) return cache.printers
      if (!inFlight) {
        inFlight = look().then((printers) => {
          cache = { at: Date.now(), printers }
          return printers
        }).finally(() => { inFlight = null })
      }
      return await inFlight
    },
    async get(name, opts) {
      return (await this.list(opts)).find((p) => p.name === name) ?? null
    },
  }
}
