import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { toJpeg } from 'html-to-image'

/**
 * A quotation or a card as a JPG, made on the phone itself.
 *
 * The picture used to be drawn by the print server on the shop PC, so sharing
 * only worked on the shop Wi-Fi — and not even there from the website, which a
 * phone may not use to reach a plain-http address. Drawing it here, from the
 * very layout that prints, means it is instant and works anywhere.
 */

/** Draws `element` off-screen at its printed size and returns it as a JPEG. */
export async function elementToJpeg(element: ReactElement, { scale = 2, quality = 0.92 } = {}): Promise<Blob> {
  const host = document.createElement('div')
  // Off-screen, not hidden: a hidden element has no size to draw.
  Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', background: '#fff', zIndex: '-1' })
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    flushSync(() => root.render(element))
    // Fonts and pictures (logos, the QR code, a card's background) must be in
    // before the picture is taken, or they come out blank.
    await document.fonts?.ready
    await Promise.all([...host.querySelectorAll('img')].map((img) =>
      img.complete ? Promise.resolve() : new Promise((done) => { img.onload = img.onerror = () => done(undefined) })))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const node = (host.firstElementChild as HTMLElement | null) ?? host
    const url = await toJpeg(node, { quality, pixelRatio: scale, backgroundColor: '#ffffff', cacheBust: true })
    return await (await fetch(url)).blob()
  } finally {
    root.unmount()
    host.remove()
  }
}

/**
 * Shares a JPEG the way the phone shares a photo — WhatsApp, anywhere — or,
 * where the browser cannot share files, saves it to be sent by hand.
 * Returns how it went, for the message shown after.
 */
export async function shareJpeg(blob: Blob, fileName: string, text: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([blob], fileName, { type: 'image/jpeg' })
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: text, text })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      // Any other refusal: save it instead, below.
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'saved'
}
