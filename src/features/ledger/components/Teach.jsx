import React, { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useLive } from '../lib/cache';

const LABEL = {
  rule: 'told',
  alias: 'name',
  correction: 'fixed',
};

/**
 * What the shop has taught the reader.
 *
 * Corrections made while approving are recorded on their own; this is for
 * the things nobody would think to correct twice — how a hand forms a 7, what
 * a customer is really called, which column the total lives in. Everything
 * here is read back into the next bill's prompt.
 */
export default function Teach() {
  const lessons = useLive(api.review.lessons, {}, 'review:lessons') ?? [];
  const teach = useMutation(api.review.teach);
  const setLesson = useMutation(api.review.setLesson);
  const forget = useMutation(api.review.forget);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    const text = note.trim();
    if (!text) return;
    setNote('');
    await teach({ note: text });
  };

  const active = lessons.filter((l) => l.active).length;

  return (
    <div className="teach">
      <button className="teach-head" onClick={() => setOpen(!open)}>
        <span>What it has been taught</span>
        <span className="count">
          {active} in use{lessons.length !== active ? ` · ${lessons.length - active} off` : ''}
        </span>
        <span className="teach-caret">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="teach-body">
          <form className="teach-add" onSubmit={add}>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. a circled O/A means the bill goes on that customer's account"
            />
            <button className="btn" type="submit" disabled={!note.trim()}>
              Teach
            </button>
          </form>

          {lessons.length === 0 ? (
            <p className="hint">
              Nothing yet. Every correction you make while approving is remembered here.
            </p>
          ) : (
            <ul className="teach-list">
              {lessons.map((l) => (
                <li key={l._id} className={l.active ? '' : 'off'}>
                  <span className={`tag ${l.kind}`}>{LABEL[l.kind] ?? l.kind}</span>
                  <span className="teach-text">
                    {l.kind === 'rule'
                      ? l.note
                      : l.kind === 'alias'
                        ? `“${l.wrong}” is the account ${l.right}`
                        : `${l.field}: “${l.wrong}” → “${l.right}”`}
                  </span>
                  <button
                    className="link"
                    onClick={() => setLesson({ id: l._id, active: !l.active })}
                  >
                    {l.active ? 'stop using' : 'use again'}
                  </button>
                  <button className="link warn" onClick={() => forget({ id: l._id })}>
                    forget
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
