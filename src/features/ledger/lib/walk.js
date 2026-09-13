/**
 * Where Enter goes next on a voucher.
 *
 * The rule lives here rather than inside the form so it can be read - and
 * tested - on its own: the walk moves field by field in screen order, stops to
 * ask the date once the party is named, and accepts the voucher off the end.
 *
 * `stops` are the field ids in order ('date', 'ref', 'party', …); `from` is the
 * one Enter was pressed in.
 */
export function nextStep({ stops, from, dateAsked }) {
  const at = stops.indexOf(from);
  if (at === -1) return { do: 'nothing' };
  // The date is a step of its own; landing on it opens it.
  if (from === 'date') return { do: 'ask-date' };
  // Named the party, so say what day this is - once per voucher.
  if (from === 'party' && !dateAsked) return { do: 'ask-date' };
  const next = stops[at + 1];
  if (next) return { do: 'focus', stop: next };
  // Opened against a party already - from their ledger, say - the cursor starts
  // at the amount and never passes the party, so the last Enter asks the date
  // and writes the voucher once it is answered.
  return dateAsked ? { do: 'submit' } : { do: 'ask-date', then: 'submit' };
}
