const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shivDesktop', {
  isElectron: true,
  getPrinters: () => ipcRenderer.invoke('printers:list'),
  printCurrentPage: (options) => ipcRenderer.invoke('print:current-page', options),
})
