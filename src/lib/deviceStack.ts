/**
 * Which physical stack this device photographs into.
 *
 * Two thousand slips are scanned far faster by two people with two phones than
 * by one, and each builds their own stack of paper as they go. Nothing on the
 * server can work out which stack a photograph's slip landed on — it is decided
 * by whose hand is holding the phone — so it is set on the device once, before
 * any photograph is taken, and stamped on every shot after that.
 *
 * Unset means the device is not building a lettered stack, which is the right
 * answer for one person working alone.
 */

const KEY = 'shiv-panel:capture-stack'

export function deviceStack(): string | undefined {
  try {
    return localStorage.getItem(KEY)?.trim() || undefined
  } catch {
    // A locked-down browser is a device with no stack, not a broken shutter.
    return undefined
  }
}

export function setDeviceStack(stack: string): void {
  try {
    const clean = stack.trim().toUpperCase()
    if (clean) localStorage.setItem(KEY, clean)
    else localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
