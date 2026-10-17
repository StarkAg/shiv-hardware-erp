import { useEffect, useMemo } from 'react';
import { useQuery } from 'convex/react';

/**
 * Bump this whenever a query's shape changes. Answers cached on a device are
 * from whatever the code looked like last time it ran, and handing a row that
 * predates a field to a component that reads that field is a crash — which is
 * exactly what adding `contra` to the ledger did.
 */
const VERSION = 'v2';
const PREFIX = `shivledger:q:${VERSION}:`;

// Everything from an earlier version is dead weight, and a trap. Clear it.
try {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('shivledger:q:') && !key.startsWith(PREFIX)) {
      localStorage.removeItem(key);
    }
  }
} catch {
  /* private browsing — nothing was cached to begin with */
}

const read = (key) => {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota or private browsing — the app just opens cold next time */
  }
};

/**
 * `useQuery`, except it answers with the last figures seen on this device
 * instead of `undefined` while Convex connects.
 *
 * That is the whole reason this app has no loading state: it opens on the
 * numbers it closed on and swaps them for live ones the moment the socket is
 * up — normally before anyone has finished reading the screen. Only a device
 * that has never opened the app starts empty.
 */
export function useLive(fnRef, args, key) {
  const live = useQuery(fnRef, args ?? {});
  // A different key is a different slot — switch to it rather than showing
  // one party's figures under another party's name. Read in the same render
  // as the key changes: switching in an effect left one render answering the
  // new party with the old party's figures, and the ledger page remembers its
  // newest bill photo off that answer — under the new party's id.
  const cached = useMemo(() => read(key), [key]);

  useEffect(() => {
    if (live !== undefined) write(key, live);
  }, [live, key]);

  return live !== undefined ? live : cached;
}

