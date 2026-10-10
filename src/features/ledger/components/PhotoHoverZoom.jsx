import React from 'react';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Put the zoom window beside the tile without moving the voucher page. */
export function placeZoomPane(tile, viewport) {
  const gap = 12;
  const rightRoom = viewport.width - tile.right - gap - 16;
  const leftRoom = tile.left - gap - 16;
  const onRight = rightRoom >= leftRoom;
  const width = Math.max(180, Math.min(660, onRight ? rightRoom : leftRoom));
  const height = Math.min(680, viewport.height - 32);
  return {
    left: onRight ? clamp(tile.right + gap, 16, viewport.width - width - 16)
      : clamp(tile.left - width - gap, 16, viewport.width - width - 16),
    top: clamp(tile.top, 16, viewport.height - height - 16),
    width,
    height,
  };
}

/**
 * The tile uses object-fit: cover. Map the cursor through that crop so the
 * second pane magnifies the same point of the original photo.
 */
export function zoomGeometry(tile, source, pane, pointer) {
  const sourceWidth = Math.max(1, source.width);
  const sourceHeight = Math.max(1, source.height);
  const coverScale = Math.max(tile.width / sourceWidth, tile.height / sourceHeight);
  const coveredWidth = sourceWidth * coverScale;
  const coveredHeight = sourceHeight * coverScale;
  const cropX = (coveredWidth - tile.width) / 2;
  const cropY = (coveredHeight - tile.height) / 2;
  const x = clamp((pointer.x - tile.left + cropX) / coveredWidth, 0, 1);
  const y = clamp((pointer.y - tile.top + cropY) / coveredHeight, 0, 1);

  const scale = Math.max(pane.width / sourceWidth, pane.height / sourceHeight) * 1.25;
  const enlargedWidth = sourceWidth * scale;
  const enlargedHeight = sourceHeight * scale;
  const offsetX = clamp(pane.width / 2 - x * enlargedWidth, pane.width - enlargedWidth, 0);
  const offsetY = clamp(pane.height / 2 - y * enlargedHeight, pane.height - enlargedHeight, 0);

  const lensLeft = tile.left - cropX - offsetX / scale * coverScale;
  const lensTop = tile.top - cropY - offsetY / scale * coverScale;
  const lensRight = lensLeft + pane.width / scale * coverScale;
  const lensBottom = lensTop + pane.height / scale * coverScale;
  const visibleLeft = clamp(lensLeft, tile.left, tile.right);
  const visibleTop = clamp(lensTop, tile.top, tile.bottom);
  return {
    backgroundSize: `${enlargedWidth}px ${enlargedHeight}px`,
    backgroundPosition: `${offsetX}px ${offsetY}px`,
    lens: {
      left: visibleLeft,
      top: visibleTop,
      width: Math.max(0, Math.min(lensRight, tile.right) - visibleLeft),
      height: Math.max(0, Math.min(lensBottom, tile.bottom) - visibleTop),
    },
  };
}

/**
 * The enlarged view floats over the page but never takes the mouse: it used to
 * be a button you could click for the full photo, and lying over the next
 * thumbnails it stopped them being hovered (or their X pressed) until it went.
 * The thumbnail itself opens the full photo.
 */
export default function PhotoHoverZoom({ url, label, pane, zoom }) {
  return (
    <>
      <div className="photo-hover-portal" aria-hidden="true" style={{
        left: pane.left,
        top: pane.top,
        width: pane.width,
        height: pane.height,
        backgroundImage: `url("${url}")`,
        backgroundSize: zoom.backgroundSize,
        backgroundPosition: zoom.backgroundPosition,
      }}>
        {label && <span className="photo-hover-label">{label}</span>}
      </div>
      {zoom.lens.width > 0 && zoom.lens.height > 0 && (
        <span className="photo-zoom-lens" aria-hidden="true" style={zoom.lens} />
      )}
    </>
  );
}
