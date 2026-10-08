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

/** Safari, and every browser on an iPhone, which are all Safari underneath. */
const isWebKit = () =>
  /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg\//.test(navigator.userAgent) ||
  /iPhone|iPad|iPod/.test(navigator.userAgent)

/**
 * Puts the picture's own bytes into the <img> and waits until it is decoded,
 * so the copy taken of the page has it. A picture still loading, or only
 * linked by address, is what came out blank.
 */
async function inlineImage(img: HTMLImageElement): Promise<void> {
  try {
    if (img.src && !img.src.startsWith('data:')) {
      const blob = await (await fetch(img.src)).blob()
      img.src = await new Promise<string>((done, fail) => {
        const reader = new FileReader()
        reader.onload = () => done(String(reader.result))
        reader.onerror = () => fail(reader.error)
        reader.readAsDataURL(blob)
      })
    }
    await img.decode()
  } catch {
    // A picture that will not load is left as it is; the rest still goes.
  }
}

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
    await Promise.all([...host.querySelectorAll('img')].map(inlineImage))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const node = (host.firstElementChild as HTMLElement | null) ?? host
    const options = { quality, pixelRatio: scale, backgroundColor: '#ffffff' }
    // On an iPhone the first picture taken leaves out the images — the
    // visiting card at the top of a quotation came out as a blank space —
    // because Safari has not drawn them inside the picture yet. The second is
    // whole. Elsewhere one is enough.
    if (isWebKit()) await toJpeg(node, options)
    const url = await toJpeg(node, options)
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
export async function shareJpeg(blob: Blob, fileName: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([blob], fileName, { type: 'image/jpeg' })
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      // The picture alone. A title or text rides along as WhatsApp's caption
      // ("SH-2026-0002 - Water Proof Block Board 19mm"), which the shop does
      // not want under a quotation sent to a customer.
      await navigator.share({ files: [file] })
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
