import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * A picker that takes typing as well as picking. It filters as you type, walks
 * on the arrow keys, and — when the name typed is not on the list — offers to
 * open a ledger under it, so a new bank or supplier does not send anyone off to
 * the masters screen mid-voucher.
 */
export default function Combo({
  options,
  value,
  onChange,
  onCreate,
  createGroup,
  placeholder = 'Type or pick',
  autoFocus,
  // Marks this field as a stop on the form's Enter walk.
  nav,
}) {
  const selected = options.find((o) => o.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const field = useRef(null);
  const list = useRef(null);

  const typed = query.trim();
  const matches = useMemo(() => {
    if (!typed) return options;
    const q = typed.toLowerCase();
    return options
      .filter((o) => o.name.toLowerCase().includes(q))
      // Names that start with what was typed are what the typist meant.
      .sort((a, b) => {
        const as = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bs = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return as - bs || a.name.localeCompare(b.name);
      });
  }, [options, typed]);

  const exact = matches.some((o) => o.name.toLowerCase() === typed.toLowerCase());
  const canCreate = Boolean(onCreate) && typed.length > 0 && !exact;
  const rows = canCreate ? matches.length + 1 : matches.length;

  useEffect(() => setAt(0), [typed, open]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (box.current && !box.current.contains(e.target)) close();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    const row = list.current?.children[at];
    if (row) row.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const pick = (option) => {
    onChange(option.id);
    close();
    // Blur rather than hold focus: the form's Enter walk moves on from here,
    // and a picker that keeps the cursor would swallow the next Enter.
    field.current?.blur();
  };

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await onCreate(typed);
      if (id) onChange(id);
      close();
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      return setAt((i) => (rows === 0 ? 0 : (i + step + rows) % rows));
    }
    if (e.key === 'Enter') {
      if (!open) return undefined;
      e.preventDefault();
      if (canCreate && at === matches.length) return create();
      const option = matches[at];
      return option ? pick(option) : undefined;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      return close();
    }
    return undefined;
  };

  return (
    <div className={`combo${open ? ' open' : ''}`} ref={box}>
      <input
        ref={field}
        type="text"
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        autoFocus={autoFocus}
        data-vf={nav ? '1' : undefined}
        value={open ? query : selected?.name ?? ''}
        placeholder={open ? selected?.name ?? placeholder : placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onMouseDown={() => setOpen(true)}
        onKeyDown={onKey}
      />
      <span className="combo-caret" aria-hidden="true">▾</span>

      {open && (
        <div className="combo-list" ref={list} role="listbox">
          {matches.map((o, i) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              className={`combo-row${i === at ? ' at' : ''}${o.id === value ? ' on' : ''}`}
              onMouseEnter={() => setAt(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
            >
              <span className="combo-name">{o.name}</span>
              {o.hint && <span className="combo-hint">{o.hint}</span>}
            </button>
          ))}

          {canCreate && (
            <button
              type="button"
              className={`combo-row make${at === matches.length ? ' at' : ''}`}
              onMouseEnter={() => setAt(matches.length)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={create}
            >
              <span className="combo-name">{busy ? 'Opening…' : `Open “${typed}”`}</span>
              {createGroup && <span className="combo-hint">under {createGroup}</span>}
            </button>
          )}

          {matches.length === 0 && !canCreate && <div className="combo-none">No match</div>}
        </div>
      )}
    </div>
  );
}
