/**
 * A stable identity for this browser, used to hold bill locks.
 *
 * The id never changes for the life of the browser profile, so a reload
 * reclaims its own lock rather than being blocked by it. The name is what
 * another counter sees — editable, because "Counter 3" means something to the
 * shop and a random id doesn't.
 */
const ID_KEY = 'shiv-panel:device-id'
const NAME_KEY = 'shiv-panel:device-name'

export function deviceId(): string {
  try {
    let v = localStorage.getItem(ID_KEY)
    if (!v) {
      v = Math.random().toString(36).slice(2, 10)
      localStorage.setItem(ID_KEY, v)
    }
    return v
  } catch {
    return 'anon'   // private mode: locks still work, just not across reloads
  }
}

export function deviceName(): string {
  try {
    let v = localStorage.getItem(NAME_KEY)
    if (!v) {
      v = `Counter ${1 + Math.floor(Math.random() * 9)}`
      localStorage.setItem(NAME_KEY, v)
    }
    return v
  } catch {
    return 'Another counter'
  }
}

export function setDeviceName(name: string) {
  try { localStorage.setItem(NAME_KEY, name.trim() || deviceName()) } catch { /* ignore */ }
}
