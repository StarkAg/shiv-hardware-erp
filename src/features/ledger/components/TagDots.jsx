import React, { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react'
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { TAGS, orderTags } from '../lib/tags';

/**
 * The marks on an account, and the way to change them.
 *
 * Read-only it is just dots. Given a ledger id it becomes a button: click the
 * dots and the full palette opens, click a colour to add or remove it. Several
 * at once is allowed, because one customer can be both slow to pay and worth
 * keeping.
 */
export default function TagDots({ tags, ledgerId, size = 9 }) {
  const toggle = useMutation(api.masters.toggleTag);
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const on = orderTags(tags);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!ledgerId) {
    if (on.length === 0) return null;
    return (
      <span className="tagdots" style={{ '--dot': `${size}px` }}>
        {on.map((t) => (
          <span key={t.id} className={`tagdot t-${t.id}`} title={t.name} />
        ))}
      </span>
    );
  }

  return (
    <span className="tagpick" ref={box}>
      <button
        type="button"
        className={`tagdots pickable${on.length === 0 ? ' empty' : ''}`}
        style={{ '--dot': `${size}px` }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        aria-label={on.length ? `Tags: ${on.map((t) => t.name).join(', ')}` : 'Add a tag'}
      >
        {on.length === 0 ? (
          <span className="tagdot hollow" />
        ) : (
          on.map((t) => <span key={t.id} className={`tagdot t-${t.id}`} />)
        )}
      </button>

      {open && (
        <span className="tagmenu" onClick={(e) => e.stopPropagation()}>
          {TAGS.map((t) => {
            const chosen = (tags ?? []).includes(t.id);
            return (
              <button
                type="button"
                key={t.id}
                className={`tagswatch t-${t.id}${chosen ? ' on' : ''}`}
                title={t.name}
                onClick={() => toggle({ id: ledgerId, tag: t.id })}
              >
                {chosen && <span className="tagtick"><Check size={12} aria-hidden="true" /></span>}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}
