import { describe, expect, it } from 'vitest'
import { placeZoomPane, zoomGeometry } from '../src/features/ledger/components/PhotoHoverZoom'

const tile = { left: 100, top: 80, right: 500, bottom: 680, width: 400, height: 600 }
const source = { width: 400, height: 600 }
const pane = { left: 512, top: 80, width: 600, height: 600 }

describe('photo magnifier', () => {
  it('places the second window beside the photo without moving it', () => {
    const right = placeZoomPane(tile, { width: 1365, height: 900 })
    expect(right.left).toBeGreaterThan(tile.right)

    const nearRight = { ...tile, left: 900, right: 1300 }
    const left = placeZoomPane(nearRight, { width: 1365, height: 900 })
    expect(left.left + left.width).toBeLessThan(nearRight.left)
  })

  it('shows the crop under the cursor and keeps its lens inside the photo', () => {
    const topLeft = zoomGeometry(tile, source, pane, { x: tile.left, y: tile.top })
    const center = zoomGeometry(tile, source, pane, { x: 300, y: 380 })
    const bottomRight = zoomGeometry(tile, source, pane, { x: tile.right, y: tile.bottom })

    expect(topLeft.lens.left).toBeCloseTo(tile.left)
    expect(topLeft.lens.top).toBeCloseTo(tile.top)
    expect(center.lens.left).toBeGreaterThan(topLeft.lens.left)
    expect(center.lens.top).toBeGreaterThan(topLeft.lens.top)
    expect(bottomRight.lens.left + bottomRight.lens.width).toBeCloseTo(tile.right)
    expect(bottomRight.lens.top + bottomRight.lens.height).toBeCloseTo(tile.bottom)
    expect(topLeft.backgroundPosition).toBe('0px 0px')
    expect(bottomRight.backgroundPosition).not.toBe(topLeft.backgroundPosition)
  })
})
