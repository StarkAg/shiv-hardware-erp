/**
 * Colour marks for accounts, in the manner of Finder tags.
 *
 * A short fixed palette — colours you can tell apart at a glance and remember
 * the meaning of. What each one means is the shop's business: these names
 * describe the colour, and the shop's own name for it, where it has given one,
 * is kept in the books and shown instead.
 *
 * The hues are pulled toward the warm ground the app sits on rather than being
 * straight system colours, which look like stickers on parchment.
 */
export const TAGS = [
  { id: 'red', name: 'Red', light: '#c0392f', dark: '#e8635a' },
  { id: 'orange', name: 'Orange', light: '#c2731a', dark: '#e79b45' },
  { id: 'yellow', name: 'Yellow', light: '#b8951f', dark: '#e0c04a' },
  { id: 'green', name: 'Green', light: '#2f7d4f', dark: '#5cb883' },
  { id: 'blue', name: 'Blue', light: '#2b6fa8', dark: '#66a9dd' },
  { id: 'purple', name: 'Purple', light: '#7a4f9e', dark: '#b088d8' },
  { id: 'pink', name: 'Pink', light: '#b03e6f', dark: '#e58bb2' },
  { id: 'grey', name: 'Grey', light: '#7a736c', dark: '#a8a29e' },
];

export const TAG_BY_ID = Object.fromEntries(TAGS.map((t) => [t.id, t]));

/** Only the marks that still exist, in palette order rather than click order. */
export const orderTags = (tags) =>
  TAGS.filter((t) => (tags ?? []).includes(t.id));

/**
 * What this shop calls each colour, falling back to the colour's own name.
 *
 * The palette is the app's; the meanings are the shop's. A shop that has named
 * green "current" should see "current" everywhere, and one that has named
 * nothing should still see a usable palette rather than blanks.
 */
export function labelled(tagNames) {
  const named = Object.fromEntries((tagNames ?? []).map((t) => [t.id, t.name]));
  return TAGS.map((t) => ({ ...t, label: named[t.id] ?? t.name, named: Boolean(named[t.id]) }));
}
