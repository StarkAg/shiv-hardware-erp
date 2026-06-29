const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shivDesktop', {
  isElectron: true,
  getPrinters: () => ipcRenderer.invoke('printers:list'),
  printCurrentPage: (options) => ipcRenderer.invoke('print:current-page', options),
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
