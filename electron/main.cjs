const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { autoUpdater } = require('electron-updater')

let mainWindow = null

// ── Auto-update state (mirrored to the renderer via `update:status`) ─────────
let updateState = { status: 'idle', version: app.getVersion(), info: null, error: null }

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', updateState)
  }
}

function appPath(...parts) {
  return path.join(app.getAppPath(), ...parts)
}

// One Electron shell, two desktop apps. The packaged package.json carries
// `shivEntry` (set via electron-builder extraMetadata): 'counter' builds the
// Shiv Quotation app — quotations + guarantee cards from counter.html — while
// anything else is the full Shiv Hardware Panel. SHIV_ENTRY overrides in dev.
const ENTRY = (() => {
  if (process.env.SHIV_ENTRY) return process.env.SHIV_ENTRY
  try {
    return require(appPath('package.json')).shivEntry || 'main'
  } catch {
    return 'main'
  }
})()
const IS_QUOTATION_APP = ENTRY === 'counter'
const ENTRY_HTML = IS_QUOTATION_APP ? 'counter.html' : 'index.html'
const APP_TITLE = IS_QUOTATION_APP ? 'Shiv Quotation' : 'Shiv Hardware Panel'

// Own profile folder. Both builds share package name "shiv-panel", so by
// default they'd share %APPDATA%\shiv-panel — and with the panel open, the
// quotation app's window blocked ~12s on the panel's locked browser storage
// before it could even paint (and then couldn't save locally at all).
// Must run before the app is ready.
if (IS_QUOTATION_APP) app.setPath('userData', path.join(app.getPath('appData'), 'Shiv Quotation'))

function appIconPath() {
  const icon = IS_QUOTATION_APP ? 'quotation-icon.ico' : 'favicon.ico'
  return app.isPackaged
    ? appPath('dist', icon)
    : appPath('public', icon)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: APP_TITLE,
    backgroundColor: '#f5f2ea',
    icon: appIconPath(),
    webPreferences: {
      preload: appPath('electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // Web links (e.g. a card's "Open online") go to the real browser, not a bare
  // Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // counter.html's <title> is the counter website's name; keep the app's own.
  if (IS_QUOTATION_APP) mainWindow.on('page-title-updated', (e) => e.preventDefault())

  if (process.env.VITE_DEV_SERVER_URL) {
    const devUrl = process.env.VITE_DEV_SERVER_URL.replace(/\/+$/, '')
    mainWindow.loadURL(IS_QUOTATION_APP ? `${devUrl}/${ENTRY_HTML}` : devUrl)
  } else {
    mainWindow.loadFile(appPath('dist', ENTRY_HTML))
  }
}

function setupAutoUpdater() {
  // Auto-update only makes sense for an installed (packaged) build.
  if (!app.isPackaged) {
    setUpdateState({ status: 'dev-disabled' })
    return
  }
  // The quotation app has no release feed; it's rebuilt locally from this repo.
  if (IS_QUOTATION_APP) {
    setUpdateState({ status: 'dev-disabled' })
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    setUpdateState({ status: 'downloading', info, error: null }),
  )
  autoUpdater.on('update-not-available', (info) =>
    setUpdateState({ status: 'up-to-date', info }),
  )
  autoUpdater.on('download-progress', (p) =>
    setUpdateState({ status: 'downloading', progress: Math.round(p.percent) }),
  )
  autoUpdater.on('error', (err) =>
    setUpdateState({ status: 'error', error: String(err && err.message ? err.message : err) }),
  )
  autoUpdater.on('update-downloaded', async (info) => {
    setUpdateState({ status: 'downloaded', info })
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `${APP_TITLE} ${info.version} has been downloaded.`,
      detail: 'Restart the app to finish installing the update.',
    })
    if (response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall())
    }
  })

  // Check shortly after launch, then poll every 6 hours while running.
  autoUpdater.checkForUpdates().catch(() => {})
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000)
}

app.whenReady().then(() => {
  createWindow()
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('update:get-state', () => updateState)

ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { status: 'dev-disabled' }
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    setUpdateState({ status: 'error', error: String(err && err.message ? err.message : err) })
  }
  return updateState
})

ipcMain.handle('update:install', () => {
  if (updateState.status === 'downloaded') autoUpdater.quitAndInstall()
})

ipcMain.handle('printers:list', async (event) => {
  return event.sender.getPrintersAsync()
})

ipcMain.handle('print:current-page', async (event, options = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) throw new Error('No active window to print')

  const copies = Math.max(1, Number(options.copies ?? 1) || 1)
  const deviceName = typeof options.deviceName === 'string' && options.deviceName.trim()
    ? options.deviceName.trim()
    : undefined

  return new Promise((resolve, reject) => {
    win.webContents.print(
      {
        silent: true,
        printBackground: true,
        copies,
        deviceName,
      },
      (success, failureReason) => {
        if (success) {
          resolve({ ok: true })
          return
        }

        reject(new Error(failureReason || 'Silent print failed'))
      },
    )
  })
})

// ── Direct PVC guarantee-card printing (no print server) ─────────────────────
// The desktop app runs on the same PC as the Epson L8050, so it does what the
// print server's devmode engine does, in-process: build the card HTML with the
// same print-server/template.mjs, render it at 4x in a hidden window (the inline
// fit script runs there too), then hand the PNG to tools/print-card-gdi.ps1 with
// the captured Disc/ID Card Tray DEVMODE. Only WhatsApp still needs the server.

// Defaults = the calibrated values in print-server/.env (2026-10). A build can
// override them via package.json `cardPrint` (electron-builder.quotation.cjs
// copies the current .env values in at build time — never the .env itself).
const CARD_PRINT_DEFAULTS = {
  printer: '',                       // '' = first installed printer matching /L8050|EPSON/
  slotLeftMm: 8, slotTopMm: 35,
  slot2LeftMm: 82, slot2TopMm: 35,
  offsetXmm: 0, offsetYmm: 0, scalePercent: 100,
  // The QR on the card must open the hosted Shiv Hardware site — same URL the
  // print server prints (GUARANTEE_PUBLIC_URL + '/' + number).
  guaranteePublicUrl: 'https://www.shivhardware.store/Gaurantee',
  // The short link (qr-redirect/) printed on every card: <short>/<number>/<token>.
  // Same as GUARANTEE_SHORT_URL in src/lib/printServer.ts.
  guaranteeShortUrl: 'https://gcvf.vercel.app',
}

function cardPrintConfig() {
  let fromBuild = {}
  try { fromBuild = require(appPath('package.json')).cardPrint || {} } catch { /* defaults */ }
  return { ...CARD_PRINT_DEFAULTS, ...fromBuild }
}

// PowerShell can't read inside app.asar; these files are asarUnpack'ed.
function unpackedPath(...parts) {
  return appPath(...parts).replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked')
}

async function renderCardPng(html) {
  const SCALE = 4 // same sharpness as the print server's deviceScaleFactor
  const w = Math.ceil((54 / 25.4) * 96) * SCALE
  const h = Math.ceil((86 / 25.4) * 96) * SCALE
  const file = path.join(os.tmpdir(), `shiv-card-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.html`)
  fs.writeFileSync(file, html, 'utf8')
  const win = new BrowserWindow({
    show: false,
    width: w,
    height: h,
    useContentSize: true,
    webPreferences: { offscreen: true, zoomFactor: SCALE, sandbox: true, contextIsolation: true },
  })
  try {
    await win.loadFile(file)
    // Two frames so the fit script's font/scale changes are painted.
    await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h })
    return image.toPNG()
  } finally {
    win.destroy()
    fs.rmSync(file, { force: true })
  }
}

async function findCardPrinter(config, webContents) {
  const printers = await webContents.getPrintersAsync()
  const names = printers.map((p) => p.name)
  if (config.printer) {
    if (names.includes(config.printer)) return config.printer
    throw new Error(`Printer "${config.printer}" is not installed on this PC`)
  }
  const match = names.find((n) => /L8050/i.test(n)) || names.find((n) => /EPSON/i.test(n))
  if (!match) throw new Error('No Epson printer found on this PC')
  return match
}

function runCardScript(args) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', unpackedPath('print-server', 'tools', 'print-card-gdi.ps1'), ...args],
      { windowsHide: true, timeout: 120000 },
      (err, stdout, stderr) => {
        const output = [stdout, stderr].map((t) => t && t.trim()).filter(Boolean).join('\n')
        if (err) { err.message = `${err.message}${output ? `\n${output}` : ''}`; reject(err); return }
        resolve(output)
      })
  })
}

// payload: { documents: GuaranteeDocument[1..2], slot?: 1|2, copies?: number,
//            previewOnly?: true }  previewOnly renders and returns the card PNG
//            (data URL) plus the printer it would use — nothing is printed.
ipcMain.handle('card:print-direct', async (event, payload = {}) => {
  if (process.platform !== 'win32') throw new Error('Direct card printing needs Windows')
  const docs = (payload.documents || []).filter(Boolean).slice(0, 2)
  if (!docs.length) throw new Error('No guarantee card to print')
  const config = cardPrintConfig()
  const slot = Number(payload.slot) === 2 && docs.length === 1 ? 2 : 1
  const copies = Math.max(1, Number(payload.copies) || 1)

  const { buildGuaranteeHtml, CARD_W_MM, CARD_H_MM } = await import(pathToFileURL(appPath('print-server', 'template.mjs')).href)
  const base = String(config.guaranteePublicUrl || '').replace(/\/+$/, '')
  // number + secret token: the hosted page only opens a card when both match
  // (Convex getGuaranteeByNumber). Same URL as src/lib/printServer.ts guaranteeOnlineUrl.
  const cardUrl = (doc) => {
    if (!base || !doc.number) return ''
    const short = String(config.guaranteeShortUrl || '').replace(/\/+$/, '')
    if (short && doc.token) return `${short}/${encodeURIComponent(doc.number)}/${encodeURIComponent(doc.token)}`
    const url = `${base}/${encodeURIComponent(doc.number)}`
    return doc.token ? `${url}?k=${encodeURIComponent(doc.token)}` : url
  }
  const pngs = []
  for (const doc of docs) {
    const qrUrl = cardUrl(doc)
    const png = await renderCardPng(await buildGuaranteeHtml({ ...doc, qrUrl }, 'card'))
    const file = path.join(os.tmpdir(), `shiv-card-${Date.now()}-${pngs.length + 1}.png`)
    fs.writeFileSync(file, png)
    pngs.push(file)
  }

  const printer = await findCardPrinter(config, event.sender)
  if (payload.previewOnly) {
    const image = `data:image/png;base64,${fs.readFileSync(pngs[0]).toString('base64')}`
    for (const f of pngs) fs.rmSync(f, { force: true })
    return { ok: true, printer, image, qrUrl: cardUrl(docs[0]) }
  }
  const left = slot === 2 ? config.slot2LeftMm : config.slotLeftMm
  const top = slot === 2 ? config.slot2TopMm : config.slotTopMm
  const args = [
    '-ImagePath', pngs[0],
    '-PrinterName', printer,
    '-DevmodeFile', unpackedPath('print-server', 'data', 'epson-card.devmode'),
    '-Copies', String(copies),
    '-JobName', `Shiv guarantee ${docs[0].number || ''}`.trim(),
    '-SlotLeftMm', String(left), '-SlotTopMm', String(top),
    '-Slot2LeftMm', String(config.slot2LeftMm), '-Slot2TopMm', String(config.slot2TopMm),
    '-CardWidthMm', String(CARD_W_MM), '-CardHeightMm', String(CARD_H_MM),
    '-OffsetXmm', String(config.offsetXmm), '-OffsetYmm', String(config.offsetYmm),
    '-ScalePercent', String(config.scalePercent),
  ]
  if (pngs[1]) args.push('-ImagePath2', pngs[1])

  try {
    const output = await runCardScript(args)
    console.log(`[card-direct] ${printer} slot=${slot}${pngs[1] ? '+2' : ''}`, output)
    return { ok: true, printer }
  } finally {
    for (const f of pngs) fs.rmSync(f, { force: true })
  }
})
