const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')

let mainWindow = null

function appPath(...parts) {
  return path.join(app.getAppPath(), ...parts)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#f5f2ea',
    icon: appPath('public', 'assets', 'letterhead', 'shiv-logo.png'),
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

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
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
