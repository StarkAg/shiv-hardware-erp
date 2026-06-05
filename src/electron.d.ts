export {}

type DesktopPrintOptions = {
  copies?: number
  deviceName?: string
}

type DesktopPrinter = {
  name: string
  displayName?: string
  description?: string
  isDefault?: boolean
}

declare global {
  interface Window {
    shivDesktop?: {
      isElectron: true
      getPrinters: () => Promise<DesktopPrinter[]>
      printCurrentPage: (options?: DesktopPrintOptions) => Promise<{ ok: true }>
    }
  }
}
