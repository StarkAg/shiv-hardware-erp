/**
 * Which of the two apps this is.
 *
 * One build serves both sites, and the address says which: the counter's
 * (shivhardware-workshop-counter.vercel.app) is the shop's side, anything else
 * the workshop's. On a computer running this from the repo, add ?side=shop.
 * index.html makes the same test for the name, icon and manifest.
 */
const shop = /counter/i.test(window.location.hostname) || /[?&]side=shop\b/.test(window.location.search)

export const SIDE = shop ? 'shop' : 'workshop'
export const OTHER = shop ? 'workshop' : 'shop'
export const APP_NAME = shop ? 'Workshop Counter' : 'Workshop'
export const ICON = shop ? '/counter/icon-192.png' : '/workshop/icon-192.png'
/** What each side is called in the other's thread. */
export const SIDE_NAME = { shop: 'Shop', workshop: 'Workshop' }
