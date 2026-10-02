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

type DesktopUpdateState = {
  status: string
  version?: string
  progress?: number
  info?: { version?: string } | null
  error?: string | null
}

declare global {
  // Injected at build time by Vite (see vite.config.ts `define`).
  const __APP_VERSION__: string

  interface Window {
    shivDesktop?: {
      isElectron: true
      getPrinters: () => Promise<DesktopPrinter[]>
      printCurrentPage: (options?: DesktopPrintOptions) => Promise<{ ok: true }>
      /** PVC guarantee cards straight to the Epson on this PC (no print server). */
      printGuaranteeCardsDirect?: (payload: {
        documents: import('./lib/types').GuaranteeDocument[]
        slot?: 1 | 2
        copies?: number
      }) => Promise<{ ok: true; printer: string }>
      getUpdateState?: () => Promise<DesktopUpdateState>
      checkForUpdates?: () => Promise<DesktopUpdateState>
      installUpdate?: () => Promise<void>
      onUpdateStatus?: (cb: (state: DesktopUpdateState) => void) => () => void
    }
  }
}
