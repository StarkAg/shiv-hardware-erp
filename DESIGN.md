# Shiv design language: "Signs"

One look for every Shiv Hardware app. Chosen by Tony on 11 Oct 2026, first
built in the two Workshop apps (`workshop-web/`). The working copy of
everything below is `workshop-web/src/index.css`: copy from it, do not
re-invent it.

## The idea

A screen is read like the signs on a factory floor, by trained staff who use
it every day. White ground, black print, three colours that each mean one
thing, and one action per screen in a fixed place.

It must be:

- **Easy**: one glance says where a thing stands and what to do next.
- **Industrial**: plain, square, heavy lettering. No decoration.
- **Readable in the sun** and with one hand.

## Colour: one meaning each

| Colour | Hex | Means | Used for |
|---|---|---|---|
| White | `#ffffff` | the wall | every screen's ground |
| Black | `#0e1318` | print | text, rules, the selected filter |
| Grey print | `#4c5660` | small print | labels, times, secondary lines |
| Hairline | `#c9cfd5` | a division | lines between rows, outlines of steps to come |
| Key grey | `#edf0f3` | a quiet button | secondary buttons, filter boxes |
| **Blue** | `#0054b4` | **do this** | the step that is yours, the button that does it, call buttons |
| **Green** | `#007a3d` | **done** | finished steps, the button that finishes or sends |
| **Yellow** | `#ffcc00` | **wait** | a step that is with the other side (black print on it) |
| **Red** | `#b3202a` | **delete** | delete and errors, nothing else |

Rules:

- Never use a colour for anything but its meaning. No colour for decoration.
- Yellow is a ground, never a text colour. Print on yellow is black.
- White print only on blue, green, red or black.
- There is no dark mode. A sign is white. Set `color-scheme: light`.

## Shape: two shapes

- **Circle** = do this now (a blue round call button, the blue step that is yours).
- **Square** = a state (done, waiting, to come) and every ordinary button.
- No rounded corners anywhere else. No drop shadows. No gradients. No cards
  inside cards: divide with space and hairlines.
- A quiet button shows it can be pressed with a 4px darker bottom edge
  (`box-shadow: inset 0 -4px 0 #c9cfd5`), and moves down 2px when pressed.
- Heavy 4px black rules mark the edges of a screen: under the header, above
  the foot button. A 2px black rule opens a list of rows.

## Lettering: Barlow

The free relative of the DIN lettering used on signs. The font files ship
inside each app (`src/fonts/`, latin subset, SIL Open Font License) so the
app looks the same offline.

- **Barlow Condensed** 700/800, UPPERCASE: names, titles, labels, buttons, big figures.
- **Barlow Semi Condensed** 500/600: everything read as a line (addresses, values, sentences).

| Use | Size |
|---|---|
| Smallest text allowed | 12px (only filter labels) |
| Label, small print | 14 to 15px |
| A line of text | 16px |
| A value (a phone number, a figure in a row) | 19 to 20px |
| A row's name in a list | 22px condensed |
| Screen title | 27 to 28px condensed |
| The step in hand | 34px condensed |
| The big figure | 72px condensed |

Always `font-variant-numeric: tabular-nums` on numbers. Uppercase labels get
3 to 5% letter spacing. Nothing under 12px, ever.

## Layout: the same places every time

1. **Header**: back, the name, a round blue call button. 4px rule under it.
2. **Where it stands**: steps as a row of signs (green tick, blue circle or
   yellow square with the number, grey outline for steps to come).
3. **The step in hand**: one panel. Blue if it is yours, yellow if it is with
   someone else, green when finished. Its title at the left, whose turn at the right.
4. **Facts as rows**: a grey label, the value, one action at the end of the row.
5. **The one action**: a single full-width button at the foot of the screen,
   always in the same place under the thumb. Blue to start a thing (take the
   photo, new order), green to finish or send it.

A list is rows divided by hairlines, each opening with its sign, not boxes.

Sizes that do not change: tap targets at least 44px (main buttons 56 to
64px), 12px side margins, app column at most 640px wide on a big screen.

## Words

- Short and plain. The staff are trained: no instructions where the button says it.
- Say whose turn it is: "Yours to do", "With the shop", "With the workshop".
- Count work in **pieces**, not boards (a job may be an aluminium door or windows).
- Sentence case in lines, UPPERCASE only through the condensed lettering.
- No emojis (`npm run check:emoji`). Icons are inline SVG, 2px stroke, one set.

## Must pass before shipping

- Every text passes contrast (4.5 to 1). Grey print `#4c5660` is the lightest allowed on white.
- Every field has a label (`aria-label` if none is shown).
- Focus can be seen on every button and field (black ring; white ring on blue or green).
- Nothing clipped at 320px wide; nothing scrolls sideways.
- A screen under an open sheet cannot be tabbed into (`Sheet` in `workshop-web/src/ui.jsx`).

To check a screen, the web-designer skill's scan does all of this:

```
node ~/.claude/skills/web-designer/scripts/shoot.mjs http://localhost:PORT/ --app --widths 320,390,768,1280
```

## Bringing an app over

1. Copy `workshop-web/src/fonts/` and the top of `workshop-web/src/index.css`
   (the `@font-face` rules, `:root` tokens, base rules, `.key`, `.dock`, `.round`).
2. Replace the app's colours with the tokens. Map by meaning, not by look:
   the main action becomes blue or green, status becomes a sign, delete stays red.
3. Remove rounded corners, shadows, tinted icon squares and any dark mode.
4. Move the screen's one main action to a `.dock` at the foot.
5. Set `theme-color` and the manifest colours to `#ffffff`. Bump the service worker version.
6. Shoot every screen with the command above and look at each picture.

## Where it is live

| App | Folder | State |
|---|---|---|
| Shiv Workshop, Workshop Counter | `workshop-web/` | Signs, 11 Oct 2026 |
| Everything else | | still the older parchment and brass look |
