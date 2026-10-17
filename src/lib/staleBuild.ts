/**
 * A tab left open across a deploy.
 *
 * Every screen is its own file, fetched the first time it is opened, and each
 * deploy names those files afresh (DayPaper-c7yIjEzU.js) and takes the old
 * ones down. A panel opened before the deploy still asks for the old names,
 * gets nothing, and the screen never comes: "Failed to fetch dynamically
 * imported module", or a party account that will not open.
 *
 * The cure is the page the deploy put up, so the tab reloads itself — once.
 * A second failure inside a minute is something else (the shop is offline,
 * the site is down) and is left on screen to be read out, rather than
 * reloading for ever.
 */
const KEY = 'shiv-panel:stale-reload-at'

export function isStaleBuild(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error ?? '')
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(message)
}

/** Reloads onto the current deploy; false when it already tried a moment ago. */
export function reloadForNewBuild(): boolean {
  let last = 0
  try { last = Number(sessionStorage.getItem(KEY)) || 0 } catch { /* private window */ }
  if (Date.now() - last < 60_000) return false
  try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* reload anyway */ }
  window.location.reload()
  return true
}

/** Vite's own signal that a screen's files could not be fetched. */
export function watchForNewBuild() {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild()) event.preventDefault()
  })
}
