import React from 'react';

/**
 * What a screen shows in the one case `useLive` cannot answer instantly: a
 * device that has never held this query's result. Rather than an empty table
 * or the word "loading", the page draws itself in outline, so the layout is
 * already in place when the figures arrive a moment later.
 */
export const Bar = ({ w = '100%', h = 13 }) => (
  <span className="sk" style={{ width: w, height: h }} />
);

export function TableSkeleton({ cols = 5, rows = 7, wide = 3 }) {
  const widths = ['62%', '48%', '80%', '54%', '70%', '44%', '66%', '52%', '58%'];
  return (
    <div className="table-wrap">
      <div className="scroller">
        <table className="ledger sk-table">
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                {Array.from({ length: cols }).map((_, c) => (
                  <td key={c} className={c >= wide ? 'num' : undefined}>
                    <Bar w={c >= wide ? '58%' : widths[(r + c) % widths.length]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CardsSkeleton({ count = 3 }) {
  return (
    <div className="summary">
      {Array.from({ length: count }).map((_, i) => (
        <div className="card" key={i}>
          <Bar w="52%" h={9} />
          <Bar w="76%" h={24} />
          <Bar w="38%" h={9} />
        </div>
      ))}
    </div>
  );
}

export function GridSkeleton({ count = 6 }) {
  return (
    <div className="pendinggrid">
      {Array.from({ length: count }).map((_, i) => (
        <div className="pendingcard" key={i}>
          <div className="shot sk" />
          <div className="pendingbody">
            <Bar w="64%" h={15} />
            <Bar w="82%" h={10} />
            <Bar w="44%" h={30} />
          </div>
        </div>
      ))}
    </div>
  );
}
