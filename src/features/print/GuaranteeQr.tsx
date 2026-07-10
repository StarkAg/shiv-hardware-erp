import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/**
 * Tiny QR component for guarantee cards. Renders an inline SVG so it survives
 * printing (PNGs often get re-sampled by older drivers), and re-generates only
 * when the URL changes. `size` is a CSS length — passing `mm` keeps it
 * print-accurate across the A4 page and the 54mm PVC label.
 */
export function GuaranteeQr({ value, size, className = '' }: { value: string; size: string; className?: string }) {
  const [svg, setSvg] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    QRCode.toString(value, {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((out) => {
        if (!cancelled) setSvg(out)
      })
      .catch(() => {
        if (!cancelled) setSvg('')
      })
    return () => {
      cancelled = true
    }
  }, [value])

  return (
    <div
      className={className}
      style={{ width: size, height: size, lineHeight: 0 }}
      // dangerouslySetInnerHTML — the svg is generated locally from qrcode lib, no XSS risk.
      dangerouslySetInnerHTML={{ __html: svg }}
      aria-label={`QR for guarantee card ${value}`}
      role="img"
    />
  )
}
