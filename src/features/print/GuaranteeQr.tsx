import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/**
 * QR block printed on a guarantee card. Scanning it opens the card online, so
 * a customer (or the shop, years later) can verify the guarantee without the
 * paper slip.
 *
 * `size` is a CSS length — the callers pass print units ("32mm" on the A4
 * sheet, "12mm" on the compact PVC card overlay). The bitmap is rendered far
 * larger than that and scaled down, because a QR generated at 12mm of CSS
 * pixels turns to mush on a 300dpi thermal print.
 */
export function GuaranteeQr({ value, size }: { value: string; size: string }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(value, {
      width: 512,
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(() => {
        if (!cancelled) setSrc(null)
      })
    return () => {
      cancelled = true
    }
  }, [value])

  // Reserve the space even before the bitmap resolves, so the print layout
  // never reflows underneath an absolutely-positioned QR.
  if (!src) return <div style={{ width: size, height: size }} />

  return (
    <img
      src={src}
      alt=""
      width={undefined}
      style={{ width: size, height: size, display: 'block', imageRendering: 'pixelated' }}
    />
  )
}
