/**
 * The latest lines of a long account, so the newest are not a long scroll down.
 * Anything still waiting (a bill to price, a delivery with no bill, a bill on
 * its way to the books) stays in view however old it is. Hiding a few lines is
 * no help, so an account only folds when at least `slack` would go.
 */
const stillWaiting = (item) =>
  item.kind === 'pending' || item.kind === 'posting' || (item.kind === 'received' && item.g.open);

export function recentLines(stream, keep = 30, slack = 10) {
  const cut = stream.length - keep;
  const older = stream.slice(0, Math.max(cut, 0)).filter((item) => !stillWaiting(item));
  if (older.length < slack) return { shown: stream, older: [], before: null };
  const hidden = new Set(older);
  const entries = older.filter((item) => item.kind === 'entry');
  return { shown: stream.filter((item) => !hidden.has(item)), older, before: entries.at(-1)?.r ?? null };
}
