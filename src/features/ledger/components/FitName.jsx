import React, { useLayoutEffect, useRef } from 'react';

/**
 * A name on one line, never cut and never dots. Wider than its box, it is
 * squeezed sideways with the letters kept their full height, the way Tally
 * fits a long name into a column. Sits in a flex row, which gives it its room.
 */
export default function FitName({ children }) {
  const box = useRef(null);
  const text = useRef(null);

  useLayoutEffect(() => {
    const fit = () => {
      // Layout widths, which a transform does not change, so the measure never
      // feeds on its own last result.
      const room = box.current?.clientWidth;
      const need = text.current?.offsetWidth;
      if (!room || !need) return;
      text.current.style.transform = need > room ? `scaleX(${room / need})` : '';
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(box.current);
    document.fonts?.ready.then(fit);
    return () => watch.disconnect();
  }, [children]);

  return (
    <span className="fitname" ref={box}>
      <span className="fitname-text" ref={text}>{children}</span>
    </span>
  );
}
