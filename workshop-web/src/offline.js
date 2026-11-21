import { useEffect } from 'react'

/**
 * A live read, as it is: nothing kept on the device (Tony, 21 Nov 2026), so
 * what shows is always the books' own copy. A copy kept from before is
 * thrown away.
 */
export function useKept(key, live) {
  useEffect(() => { try { localStorage.removeItem(key) } catch { /* nothing kept */ } }, [key])
  return live
}

/**
 * A photo brought down to the width it is shown at (see vercel.json "images").
 * One still on its way up is the phone's own copy, and is shown as it is.
 */
export const sized = (url, width) => (url.startsWith('blob:') ? url : `/_vercel/image?url=${encodeURIComponent(url)}&w=${width}&q=70`)
export const SMALL = 256
export const BUBBLE = 640

// Nothing is kept on the device any more (Tony, 21 Nov 2026): photos load
// from the site each time, like the app itself. Left as a call that does
// nothing, so the app goes on as it was.
export async function savePhotos() {}
