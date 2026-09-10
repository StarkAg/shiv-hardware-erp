import React, { useState } from 'react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';
import Review from './Review';
import Pending from './Pending';
import Photos from './Photos';
import Panel from './Panel';

/**
 * The stages of one bill, in the order a bill goes through them.
 *
 * Photographed, read, checked, approved — and unpriced if it was approved
 * without a figure. These were four tabs sitting among the reports, so working
 * a pile meant hunting the same bill across the nav bar to find out where it
 * had got to. They are one screen now, and the strip is the only thing that
 * moves.
 */
export const STAGES = [
  ['review', 'Review'],
  ['doubt', 'In doubt'],
  // Called Pending because that is what it has always been called. The stage
  // id stays `unpriced` — it is what /?tab=pending resolves to and what the
  // remembered stage is stored under.
  ['unpriced', 'Pending'],
  ['photos', 'Photographs'],
];

const REMEMBERED = 'shivledger:bills-stage';

const isStage = (id) => STAGES.some(([s]) => s === id);

/** Where a bill at each stage is, in numbers, for the strip. */
function billCounts(counts, pendingCount) {
  return {
    review: counts.ready ?? 0,
    doubt: counts.doubt ?? 0,
    unpriced: pendingCount,
    photos: null,           // counting every photograph costs a heavy query
    unread: counts.unread ?? 0,
    failed: counts.failed ?? 0,
    reading: counts.reading ?? 0,
  };
}

/**
 * What is waiting for a person, for the pill on the nav bar.
 *
 * Bills set aside as doubtful and bills filed unpriced are parked on purpose,
 * so they are left out: a badge that never comes down is one nobody reads.
 */
export const needsYou = (counts) => (counts.unread ?? 0) + (counts.ready ?? 0);

/**
 * One indicator: how many, and how loudly.
 *
 * `tone` is the whole point of these — a bill nobody has read yet and a bill
 * whose reading failed are not the same news, and a strip that says both in
 * the same grey says neither.
 */
function Ind({ n, tone, title }) {
  if (!n) return null;
  return (
    <span className={`ind${tone ? ` ${tone}` : ''}`} title={title}>
      {n}
    </span>
  );
}

export default function Bills({ masters, pending, initialStage, onViewBill, onOpen }) {
  const [stage, setStage] = useState(() => {
    if (isStage(initialStage)) return initialStage;
    try {
      const held = localStorage.getItem(REMEMBERED);
      return isStage(held) ? held : 'review';
    } catch {
      return 'review';
    }
  });

  const counts = useLive(api.review.counts, {}, 'review:counts') ?? {
    ready: 0, reading: 0, failed: 0, doubt: 0, unread: 0,
  };
  const n = billCounts(counts, pending?.length ?? 0);

  const go = (id) => {
    setStage(id);
    try {
      localStorage.setItem(REMEMBERED, id);
    } catch { /* private browsing — it just will not stick */ }
  };

  return (
    <>
      <div className="stages">
        {STAGES.map(([id, label]) => (
          <button
            key={id}
            className={`stage${stage === id ? ' on' : ''}`}
            onClick={() => go(id)}
          >
            {label}
            <Ind n={n[id]} title={`${n[id]} at this stage`} />
            {/* Both of these belong to Review, and both are the sort of thing
                that goes unnoticed on a screen you are not looking at. */}
            {id === 'review' && (
              <>
                <Ind n={n.unread} tone="amber" title={`${n.unread} photographed, not read yet`} />
                <Ind n={n.failed} tone="red" title={`${n.failed} could not be read`} />
              </>
            )}
          </button>
        ))}
      </div>

      {stage === 'review' && <Review masters={masters} />}
      {stage === 'doubt' && <Review masters={masters} only="doubt" />}
      {stage === 'unpriced' && (
        <Pending rows={pending} masters={masters} onViewBill={onViewBill} onOpen={onOpen} />
      )}
      {stage === 'photos' && (
        <Panel>
          <Photos onOpen={onOpen} />
        </Panel>
      )}
    </>
  );
}
