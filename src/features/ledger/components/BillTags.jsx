import React, { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react'
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { labelled, orderTags } from '../lib/tags';

/**
 * The marks on one bill, and the way to change them.
 *
 * Same idea as the dots on an account, except a bill lives in two places over
 * its life — a photograph in the pile, then a voucher in the books — so this
 * is told which one it is looking at and marks whichever it was given.
 */
export default function BillTags({ tags, inboxId, voucherId, names, size = 10 }) {
  const toggle = useMutation(api.tags.toggleOnBill);
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const on = orderTags(tags);
  const palette = labelled(names);
  const nameOf = (id) => palette.find((t) => t.id === id)?.label ?? id;

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

  return (
    <span className="tagpick" ref={box}>
      <button
        type="button"
        className={`billtags${on.length === 0 ? ' empty' : ''}`}
        style={{ '--dot': `${size}px` }}
        onClick={() => setOpen(!open)}
        aria-label={on.length ? `Marks: ${on.map((t) => nameOf(t.id)).join(', ')}` : 'Add a mark'}
      >
        {on.length === 0 ? (
          <span className="tagdot hollow" />
        ) : (
          on.map((t) => (
            <span key={t.id} className={`tagchip t-${t.id}`}>
              <span className={`tagdot t-${t.id}`} />
              {nameOf(t.id)}
            </span>
          ))
        )}
      </button>

      {open && (
        <span className="tagmenu wide" onClick={(e) => e.stopPropagation()}>
          {palette.map((t) => {
            const chosen = (tags ?? []).includes(t.id);
            return (
              <button
                type="button"
                key={t.id}
                className={`tagrow${chosen ? ' on' : ''}`}
                onClick={() => toggle({ tag: t.id, inboxId, voucherId })}
              >
                <span className={`tagdot t-${t.id}`} />
                <span className="tagrow-name">{t.label}</span>
                {chosen && <span className="tagtick"><Check size={12} aria-hidden="true" /></span>}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}
