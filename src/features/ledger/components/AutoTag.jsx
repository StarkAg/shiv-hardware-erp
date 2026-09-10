import React from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { labelled } from '../lib/tags';

/**
 * Which mark goes on every photograph from now on.
 *
 * Said as a sentence rather than shown as a selected swatch, because what
 * matters is not which colour is highlighted but the promise that everything
 * scanned after this carries it. Pick a colour and the next photograph has it;
 * pick the same one again and nothing is marked at all.
 *
 * Not a dropdown. A colour you have to open a list to see is a colour you
 * cannot check at a glance, and this is meant to be checked before a batch,
 * standing at the counter.
 */
export default function AutoTag({ autoTag, names, compact }) {
  const setAutoTag = useMutation(api.tags.setAutoTag);
  const palette = labelled(names);
  const now = palette.find((t) => t.id === autoTag);

  return (
    <span className="autotag">
      {compact ? 'new scans' : 'New scans are marked'}
      {now ? (
        <span className="autotag-now">
          <span className={`tagdot t-${now.id}`} style={{ '--dot': '11px' }} />
          {now.label}
        </span>
      ) : (
        <span className="autotag-off">nothing</span>
      )}
      <span className="swatches">
        {palette.map((t) => (
          <button
            type="button"
            key={t.id}
            className={`tagswatch small t-${t.id}${autoTag === t.id ? ' on' : ''}`}
            title={autoTag === t.id ? `${t.label} — click to stop marking` : `Mark new scans ${t.label}`}
            aria-label={t.label}
            onClick={() => setAutoTag({ tag: autoTag === t.id ? null : t.id })}
          />
        ))}
      </span>
    </span>
  );
}
