const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { pathToFileURL, fileURLToPath } = require('node:url')
const { autoUpdater } = require('electron-updater')
const screens = require('./screens.cjs')

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
const APP_TITLE = IS_QUOTATION_APP ? 'Shiv Counter' : 'Shiv Hardware Panel'

// Own profile folder. Both builds share package name "shiv-panel", so by
// default they'd share %APPDATA%\shiv-panel — and with the panel open, the
// quotation app's window blocked ~12s on the panel's locked browser storage
// before it could even paint (and then couldn't save locally at all).
// Must run before the app is ready.
// The data folder keeps the app's first name: renamed Shiv Counter (2026-10-10),
// a new folder would have started it empty — cards, settings and all.
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
  // Electron window. A blank window is the app's own: a bill opened to look at
  // beside the list (src/lib/billWindow.ts), which the app then writes into.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 660, height: 900, minWidth: 0, minHeight: 0, autoHideMenuBar: true, icon: appIconPath(), backgroundColor: '#ddd7cb' },
      }
    }
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // counter.html's <title> is the counter website's name; keep the app's own.
  if (IS_QUOTATION_APP) mainWindow.on('page-title-updated', (e) => e.preventDefault())

  if (process.env.VITE_DEV_SERVER_URL) {
    const devUrl = process.env.VITE_DEV_SERVER_URL.replace(/\/+$/, '')
    mainWindow.loadURL(IS_QUOTATION_APP ? `${devUrl}/${ENTRY_HTML}` : devUrl)
  } else {
    // Screens a deploy put in that will not load are left for the installer's own.
    mainWindow.webContents.on('did-fail-load', (_event, code, _text, _url, isMainFrame) => {
      if (!isMainFrame || code === -3 || !showing || showing.packaged) return
      refusedScreens.add(showing.builtAt)
      showScreens()
    })
    showScreens()
    const stop = screens.watch(app.getPath('userData'), offerNewScreens)
    const stopSite = watchScreensSite()
    mainWindow.on('closed', () => { stop(); stopSite() })
  }
}

// ── Screens (electron/screens.cjs) ───────────────────────────────────────────
// The copy of the screens in the window, and any that failed to load this run.
let showing = null
const refusedScreens = new Set()
let askingAboutScreens = false

function newestScreens() {
  return screens.pick({
    packagedDir: appPath('dist'),
    userData: app.getPath('userData'),
    entry: ENTRY_HTML,
    refused: refusedScreens,
  })
}

function showScreens() {
  showing = newestScreens()
  mainWindow.loadFile(path.join(showing.dir, ENTRY_HTML))
  screens.prune(app.getPath('userData'), [showing.dir])
}

// The panel website serves the same build as these screens, a minute after a push.
const SCREENS_SITE = 'https://shiv-panel.vercel.app'
/**
 * How often the website is looked at for newer screens. Shiv Counter is the
 * counter's working screen all day, and a push every few minutes put an
 * "Update ready" box in front of the quotation being written each time; it
 * looks every three hours, and asks at most once while it is open (taken or
 * not, the newest screens are there when it next opens). The panel app looks
 * every five minutes, as before.
 */
const SCREENS_EVERY = IS_QUOTATION_APP ? 3 * 60 * 60_000 : 5 * 60_000
const ASK_ONCE = IS_QUOTATION_APP
let askedThisRun = false

/**
 * Looks at the website for newer screens: soon after opening, then every few
 * minutes. What it takes is named in current.json, so the watch above offers it.
 * An installed app only: a build run from the repo shows the repo's own dist.
 */
function watchScreensSite() {
  if (!app.isPackaged) return () => {}
  let looking = false
  const look = async () => {
    if (looking || !showing) return
    looking = true
    try {
      await screens.fetchNewer({
        site: SCREENS_SITE,
        userData: app.getPath('userData'),
        have: newestScreens(),
        refused: refusedScreens,
        fetch: (url, init) => net.fetch(url, init),
      })
    } catch { /* offline, or the site is mid-deploy: the next look will do */ } finally {
      looking = false
    }
  }
  const first = setTimeout(look, 5000)
  const every = setInterval(look, SCREENS_EVERY)
  return () => { clearTimeout(first); clearInterval(every) }
}

/** Newer screens have been put in: take them now, or when the app next opens. */
async function offerNewScreens() {
  if (askingAboutScreens || !mainWindow || mainWindow.isDestroyed() || !showing) return
  if (ASK_ONCE && askedThisRun) return
  const newest = newestScreens()
  if (newest.builtAt <= showing.builtAt) return
  // The same commit built twice (here by a deploy, and by the website) is no update.
  if (newest.commit && newest.commit === showing.commit) return
  askingAboutScreens = true
  askedThisRun = true
  try {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Update now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `${APP_TITLE} has an update.`,
      detail: 'It takes a second. Anything typed and not yet saved is cleared. Later: it is there when the app next opens.',
    })
    if (response === 0 && !mainWindow.isDestroyed()) showScreens()
  } finally {
    askingAboutScreens = false
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

// ── Card backs (the Card backs screen) ───────────────────────────────────────
// The design side of a blank PVC card, from the screens' own card-backs/ folder
// (scripts/export-card-backs.ps1). Each design is the card plus a 3 mm bleed,
// so it is drawn 60 x 92 mm, 3 mm up and left of the slot: a card sitting a
// little off in the tray still prints to its edge. The tray canvas (about
// 204 x 291 mm) has room for the bleed round both slots.
const CARD_BACK_BLEED_MM = 3

// payload: { files: [slot1File | null, slot2File | null] }
ipcMain.handle('card:print-backs', async (event, payload = {}) => {
  if (process.platform !== 'win32') throw new Error('Card back printing needs Windows')
  const pageUrl = event.sender.getURL()
  // Beside the page being shown (the installer's dist/ or newer screens); public/ in dev.
  const dir = pageUrl.startsWith('file:')
    ? path.join(path.dirname(fileURLToPath(pageUrl)), 'card-backs')
    : appPath('public', 'card-backs')
  const pick = (name) => {
    if (!name) return null
    if (!/^[\w.-]+\.jpg$/.test(String(name))) throw new Error(`Not a card back: ${name}`)
    const file = path.join(dir, name)
    if (!fs.existsSync(file)) throw new Error(`Card back not found: ${name}`)
    return file
  }
  const [one, two] = (payload.files || []).slice(0, 2).map(pick)
  if (!one && !two) throw new Error('No card back chosen')

  const config = cardPrintConfig()
  const { CARD_W_MM, CARD_H_MM } = await import(pathToFileURL(appPath('print-server', 'template.mjs')).href)
  const printer = await findCardPrinter(config, event.sender)
  const b = CARD_BACK_BLEED_MM
  // Slot 2 alone: its image goes first, drawn at the slot-2 position.
  const left = one ? config.slotLeftMm : config.slot2LeftMm
  const top = one ? config.slotTopMm : config.slot2TopMm
  const args = [
    '-ImagePath', one || two,
    '-PrinterName', printer,
    '-DevmodeFile', unpackedPath('print-server', 'data', 'epson-card.devmode'),
    '-JobName', 'Shiv card backs',
    '-SlotLeftMm', String(left - b), '-SlotTopMm', String(top - b),
    '-Slot2LeftMm', String(config.slot2LeftMm - b), '-Slot2TopMm', String(config.slot2TopMm - b),
    '-CardWidthMm', String(CARD_W_MM + 2 * b), '-CardHeightMm', String(CARD_H_MM + 2 * b),
    '-OffsetXmm', String(config.offsetXmm), '-OffsetYmm', String(config.offsetYmm),
    '-ScalePercent', String(config.scalePercent),
  ]
  if (one && two) args.push('-ImagePath2', two)
  const output = await runCardScript(args)
  console.log(`[card-backs] ${printer} ${one ? path.basename(one) : '-'} | ${two ? path.basename(two) : '-'}`, output)
  return { ok: true, printer }
})
