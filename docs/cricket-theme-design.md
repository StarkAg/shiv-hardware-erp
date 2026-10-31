# Cricket theme for Attendance: what we learned and what we built

Signs (`DESIGN.md`) stays the look of every Shiv Hardware app. The cricket theme
is one exception, asked for by the owner on 31 Oct 2026: a switch, off by
default, in the attendance app only. It changes how the app looks and feels and
never what it records or pays.

## What we studied

A screen recording of a rival student app, "The Campus Web" (BETA). We only saw
the video: its audio track was silent, and how it was built is inferred from
what is on screen.

### The thinking worth copying

1. **The boring number becomes a story.** Falling below 75% attendance is not a
   red figure, it is an enemy. Each short subject is a boss with a name, a rank,
   an HP bar and "79 classes to go". The number has not changed, but it now
   means something.
2. **Real data drives the fantasy.** The opening film names the student's actual
   subjects and counts the ones that have fallen. That is why it lands.
3. **The app is alive when you do nothing.** Bosses appear from smoke and taunt
   you when idle. The mascot on Marks has lines of its own.
4. **Every touch answers back.** Tab changes, pull to refresh and taps on the
   avatar all do something, and each theme answers differently.
5. **Things to find.** A WANTED poster "raised by every win", "4 of 10 powers
   found", "Your decree", "2 of 8 tried". There is a reason to come back.
6. **A theme is a whole world.** Art, words, icons, nav rail, section names,
   transitions, sound. "Decrees" and "The Realm" replace plain headings.
7. **It asks permission for the loud parts.** Separate switches for "Rubber
   effects" and "Theme sounds", a skip button, and "Watch the story" to replay.
8. **Motion hides the cut.** Pixel strips, shatter and flashes cover the moment
   the screen changes, so a page swap feels like an event.

### What they showed on screen

- Tabs: Dashboard, Attendance, More, Planner, Marks, in a floating pill. More
  holds Events, Mess, Clubs, CGPA, Notes, Exam Time Table, Attendance and Marks
  Updates, Faculty Finder, eCurricula Solver.
- 11 themes with preview cards: Campus Glow, Dark, Monochrome, High Contrast,
  Midnight, Spider-Man, Luffy, Halloween, Doomsday, Batman, Jujutsu Kaisen.
- Choosing Doomsday: pixel strips close from both sides, zoom to the face, eyes
  glow, then a 21 second skippable film built from real data, ending with the
  tab icons lighting up one by one and a welcome by name.
- Luffy: two rubber arms grab the header on pull to refresh, then snap back with
  a page jiggle. On a tab change an arm shoots from the avatar to the tab and
  the page warps like rubber. Sounds: a boing on tabs, drums on tapping Luffy, a
  snap on refresh.
- Doomsday: metal rail with torches for the nav, pixel tab icons, glowing card
  corners, castle backdrop. A tab change shatters the screen into polygons with
  green bolts and rocks, and energy runs along the nav to the new tab.
- Dashboard: Standings, Alerts, holidays with Plan holiday. Attendance: Present,
  Absent and Total chips, a 75% marker on the bar, a forecast row.

### How it was made (inferred)

AI pixel art cut-outs; a few poses per character instead of full sprite sheets;
separate overlay images for projectiles, bolts and smoke; a CSS "camera" panning
and zooming one big image; clip-path polygons of a page copy for the shatter; an
SVG curve with a fist image for the stretchy arm; theme packs plugged into the
same layouts.

### What they got wrong, which we must not copy

- Copyrighted characters. We use no real players, no IPL or team names or logos.
- Toasts stuck over the data ("Session expired. Sign in." covering figures).
- Cut-off text, and bosses that did not match the subjects listed under them.
- Motion so heavy that the numbers are hard to read.

## Our version: the shop is a cricket ground

A hardware shop's staff are not students with subjects. What carries over is the
thinking, so the story is rebuilt from what this app really holds.

| In the app | In the theme | Why it fits |
|---|---|---|
| Staff member | Batter | Each has their own innings for the month |
| Present | FOUR, 4 runs | The everyday good thing |
| Half day | Two runs, a quick run | Half of a four, the sums stay true |
| Absent | OUT, a wicket | Stumps fly, umpire's finger goes up |
| Shop closed | Rain stops play | Nobody's fault, nothing counted |
| Tuesday off | Rest day | The weekly holiday |
| Save and lock | Stumps | Cricket's own word for the end of a day's play |
| Password on a locked day | Third umpire | A decision needs review to be overturned |
| Change history | Match referee | Red flag on a past day changed stays red |
| Month | Scorecard | Rows and columns already look like one |
| Stats | Points table | Sorted by runs |
| Pay | Purse, with a run chase | See below |
| 20 days for Tuesday pay | Target of 80 runs | 20 days x 4 runs, the rule in `pay.js` |
| Missed Monday or Wednesday | Chase lost | Same rule, same wording beside it |
| 25 full days | Century | 25 x 4, a full month reads as a hundred |

The run chase is the one idea we are most sure of. "Attend 3 more days to unlock
Tuesday pay" becomes "Need 12 runs". It is the same fact as the bonus rule, in a
shape everybody in India reads at a glance.

### Rules the theme keeps

- **It never decides anything.** All of it is display over `statusFor` and
  `monthPay`. No mark, lock, rate or wage goes through theme code. `score.js`
  works out runs from marks and writes nothing.
- **Money stays plain.** The Pay figures keep their plain words, and rupees are
  never shown outside the PIN-gated Pay tab: not in the film, not in the ticker.
- **A mark must stay fast.** Effects sit in a layer that ignores touches, so the
  next row can be tapped mid-animation. A stamp is gone in under a second.
- **Letters stay.** P, half and N are still on the keys, and the words Present,
  Absent and Closed stay readable under the cricket words.
- **Data never sits on art.** Figures are on solid panels. Art is behind them.
- **It respects the phone.** `prefers-reduced-motion` and the effects switch
  turn off the motion; the sound switch silences it. The film can be skipped.
- **Off means off.** When the theme is off the code is not even downloaded
  (`cricket/lazy.jsx`), and the screen is the plain Signs one.

## How it is switched

- **Everyone:** the field `theme` on the one `attendanceMeta` row in Convex,
  `"cricket"` or empty. Flip it from the bottom of Stats, Cricket theme (asks the
  edit password and writes a line in the change history), or edit that field in
  the Convex dashboard. Phones read it once when they open, like the staff list.
- **One phone, to try it:** open the app with `?cricket=1`. It lasts until that
  browser tab closes; `?cricket=0` forces it off the same way.
- **Per phone:** Effects and Sounds in the theme's Ground settings sheet (the
  pixel bat key in the header). Stored on that phone.

## Where the code is

- `attendance-web/src/cricket/theme.jsx`: reads the switch, holds the words that change. Always loaded, tiny.
- `attendance-web/src/cricket/ThemeSwitch.jsx`: the switch in Stats. Always loaded.
- `attendance-web/src/cricket/bus.js`: `cricketEvent()`; App.jsx calls this and it
  does nothing when the theme is off. Always loaded, tiny.
- `attendance-web/src/cricket/lazy.jsx`: the only doorway from App.jsx to the rest.
- `attendance-web/src/cricket/score.js`: runs, wickets, chase, milestones, ticker.
- `attendance-web/src/cricket/CricketLayer.jsx`: ground strip with its day score, ticker, overlays, reactions, pull to refresh.
- `attendance-web/src/cricket/Film.jsx`: the opening film.
- `attendance-web/src/cricket/Replay.jsx`: today's play, every marked player in turn, then the card.
- `attendance-web/src/cricket/Sprite.jsx`: sprite frames and pixel icons.
- `attendance-web/src/cricket/Panels.jsx`: points table, run chase, Ground settings.
- `attendance-web/src/cricket/sound.js`: every sound, synthesised, no audio files.
- `attendance-web/src/cricket/cricket.css`: all of it scoped under `.ck`.
- `attendance-web/scripts/make-cricket-art.py`: draws every sprite from code into
  `src/cricket/art/`. Original art, redraw with `python3` and it needs only Pillow.

## Next, if it earns its keep

More shots to find, a real day-time ground for bright sun, and the Workshop or
Khata apps only if the owner asks. Nothing here applies outside attendance.

## Today's play: how staff see the marks

Only the owner marks, so only the owner's phone saw the effects. So every phone plays
the whole team's day when the app is opened, or comes back after 30 seconds away.

- It plays only when the day is done: everyone has a mark, or the day is saved.
- Once per phone for one set of marks; if a mark changes, it plays once more.
- It reads marks fresh from Convex, never the cache. Rain-only days do not play.
- Absent players are shown by name, at the owner's request. The film still names no one for absences.
- It obeys the Effects switch, and Ground settings has "Watch today's play".
- A phone will not make sound before a tap, so it asks "Tap for sound" rather than saving the sounds up.
