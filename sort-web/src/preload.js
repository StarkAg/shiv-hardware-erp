/**
 * Pulls photographs into the browser's cache before they are asked for.
 *
 * The naming screen shows one slip at a time, so by the time a photograph is
 * on screen it is already too late to start fetching it. These are phone
 * cameras over a shop's wifi: a cold fetch is a second or two of blank card on
 * every single slip, which is what turns a rhythm into a wait.
 *
 * Each URL is fetched once per session and then left alone — the browser's own
 * cache serves the second request, and the Image object is dropped as soon as
 * it has done its job.
 */
const done = new Set()

export function preload(urls) {
  for (const url of urls ?? []) {
    if (!url || done.has(url)) continue
    done.add(url)
    const img = new Image()
    // Behind whatever the visible slip is still loading.
    img.decoding = 'async'
    if ('fetchPriority' in img) img.fetchPriority = 'low'
    img.src = url
  }
}
