const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shivDesktop', {
  isElectron: true,
  getPrinters: () => ipcRenderer.invoke('printers:list'),
  printCurrentPage: (options) => ipcRenderer.invoke('print:current-page', options),
  // PVC guarantee cards straight to the Epson on this PC (no print server). Windows only:
  // elsewhere (a Mac) it stays undefined, so the card goes to the shop PC's print server.
  printGuaranteeCardsDirect: process.platform === 'win32'
    ? (payload) => ipcRenderer.invoke('card:print-direct', payload)
    : undefined,
  // Card backs (designs from the screens' card-backs/ folder) into tray slot 1 and/or 2.
  printCardBacksDirect: process.platform === 'win32'
    ? (payload) => ipcRenderer.invoke('card:print-backs', payload)
    : undefined,
  // Auto-update bridge
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.removeListener('update:status', handler)
  },
})
