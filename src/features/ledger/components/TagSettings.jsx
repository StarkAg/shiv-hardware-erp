import React, { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { labelled } from '../lib/tags';

/**
 * What the colours mean here, and which one goes on new photographs.
 *
 * The palette is fixed at seven; this is only the naming of it. Marking a
 * pile as it is shot has to cost nothing at the counter or it will not
 * happen, so one colour can be nominated and every photograph taken after
 * that carries it until the shop says otherwise.
 */
export default function TagSettings({ names, autoTag, onClose }) {
  const nameTag = useMutation(api.tags.nameTag);
  const setAutoTag = useMutation(api.tags.setAutoTag);
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(labelled(names).map((t) => [t.id, t.named ? t.label : '']))
  );

  const palette = labelled(names);

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal narrow">
        <h2>Marks</h2>
        <div className="hint">
          Seven colours, named however the shop likes. Nominate one and every
          photograph taken from then on carries it — which is how a day's pile
          gets marked without anybody remembering to do it.
        </div>

        <div className="tagsettings">
          {palette.map((t) => (
            <div className="tagsetrow" key={t.id}>
              <span className={`tagdot t-${t.id}`} style={{ '--dot': '13px' }} />
              <input
                value={draft[t.id] ?? ''}
                placeholder={t.name}
                onChange={(e) => setDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                onBlur={() => nameTag({ tag: t.id, name: draft[t.id] ?? '' })}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                aria-label={`Name for ${t.name}`}
              />
              <button
                type="button"
                className={`chip${autoTag === t.id ? ' on' : ''}`}
                onClick={() => setAutoTag({ tag: autoTag === t.id ? null : t.id })}
                title="Put this on every new photograph"
              >
                {autoTag === t.id ? 'on new photos' : 'use for new'}
              </button>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
