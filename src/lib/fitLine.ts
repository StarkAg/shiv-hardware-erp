/**
 * One line, never dots. `box` has a fixed width and holds its text in a single
 * inline-block child. If the text is wider than the box, the font shrinks to
 * fit (down to 70%), then whatever is left over is squeezed horizontally with
 * scaleX — so any length shows whole on one line.
 *
 * Mirrors FIT_SCRIPT in print-server/template.mjs, which does the same on the
 * printed card. Keep them in sync.
 */
export function fitLine(box: HTMLElement) {
  const inner = box.firstElementChild as HTMLElement | null
  if (!inner) return
  // Start from the natural size every time, so a shorter value grows back.
  inner.style.fontSize = ''
  inner.style.transform = ''
  // Fractional widths (offsetWidth/clientWidth round to whole px and let a
  // sub-pixel overflow through). Only the ratio is used, so a CSS-scaled
  // preview thumbnail measures the same as the full-size card.
  const width = (el: HTMLElement) => el.getBoundingClientRect().width
  const room = width(box)
  let need = width(inner)
  if (!room || need <= room) return
  const base = parseFloat(getComputedStyle(inner).fontSize)
  inner.style.fontSize = `${Math.max(base * 0.7, (base * room) / need)}px`
  need = width(inner)
  if (need > room) {
    inner.style.transformOrigin = 'left center'
    inner.style.transform = `scaleX(${room / need})`
  }
}
