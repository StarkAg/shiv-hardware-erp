/**
 * How the plain app tells the cricket theme that something happened. It is one
 * window event: with the theme off nobody listens, so it costs nothing.
 *
 * Types: mark, allin, rain, stumps, tab, overturned, notout, settings.
 */
export function cricketEvent(type, detail = {}) {
  window.dispatchEvent(new CustomEvent('shiv-cricket', { detail: { type, ...detail } }))
}
