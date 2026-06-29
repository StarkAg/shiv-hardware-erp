const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('node:path')
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

function appIconPath() {
  return app.isPackaged
    ? appPath('dist', 'favicon.ico')
    : appPath('public', 'favicon.ico')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
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

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(appPath('dist', 'index.html'))
  }
}

function setupAutoUpdater() {
  // Auto-update only makes sense for an installed (packaged) build.
  if (!app.isPackaged) {
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
      message: `Shiv Hardware Panel ${info.version} has been downloaded.`,
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
