# Branch `front-desk-layout` — desk layout and readability

Presentation only. Two stylesheets changed, nothing else:

- `apps/web/app/globals.css`
- `apps/web/app/desks/IdentitySheet.module.css`

No component, hook, route, package or test was touched. Every rule added is a
layout, colour or typography declaration; nothing gates an action, changes what
the desk does, or alters the order of anything in the DOM.

The desk screen carries a lot at once — a conversation, a sheet, a team of seven,
Sparky, a row of suggestions and a turn's four cards — and each piece was
positioned against a fixed number. This branch makes those numbers derive from
each other, so a change in one does not push another off screen.

---

## The desk column

### 1. The team row had no case for three columns

`.stage` can show the conversation (`.split`) and a sheet (`.panel`) at once. The
seats were positioned for one of them, not both: the same `±150px` / `±50px`
offsets applied either way, so with both open the row reached under the
conversation on one side and under the sheet on the other.

A `.stage.split.panel` case closes the seats to `±96px` / `±32px` and draws the
row at `scale(0.5)`. The specialists follow with their own multiplier.

### 2. The specialists sat on top of each other

Their seats come from `specialistSeat()` as `58px` apart, a spacing chosen for
the table at full size. Beside a conversation the row is drawn at `scale(0.62)`
but the names are not scaled with it, so three of them crowded into the space of
one. The offsets are multiplied for display (`1.95` beside a conversation, `1.3`
in the narrow strip, `0.62` of `--x` in the open graph). The source values are
untouched, so `TeamRow.tsx` and `look.ts` keep working as they are.

In the open graph they are placed from `--x` rather than `--row`: `--row` is
symmetric about the centre, which put the middle specialist exactly behind
Sparky's head.

### 3. The Uniswap seats read as a lesser team

`AgentPortrait` is given `size={72}` for the four seats and `size={48}` for the
three specialists, and each state scaled them differently again. On screen the
Uniswap agents came out between 28px and 34px against 36px to 72px for the rest.

The portrait is brought to `72px` and every state's scale matched to the seats
beside it, so they are now the same size in all four: 72px on the desk, 44.6px
beside a conversation, 36px with a sheet open too, 57.6px in the open graph. The
partner mark beside the name grows from `1.15em` to `1.5em`.

The size is set with `!important` because the component writes it as an inline
style, which a stylesheet cannot otherwise override.

### 4. Sparky landed on the row above him

Three states put him in a different place, and each was a fixed percentage that
did not know how tall the row below the title had become:

| State | Was | Now |
|---|---|---|
| Conversation open | `top: 56%` | `min(68%, calc(100% - 190px))` |
| Turn folded to chips | `top: 56%` | `min(74%, calc(100% - 180px))` |
| Open graph | `clamp(690px, 62vh, calc(100vh - 60px))` | derived, see §6 |

Each cap is applied last, so a short window always wins over the preferred
position. On a window under 820px tall his head is drawn at `scale(0.6)` rather
than pressed against the row.

The row itself drops from `236px` to `256px`, and to `272px` once a turn folds,
which is what puts air under the desk's own line.

### 5. The eyebrow above the desk name

`Desk` sat above `EQLTY Desk`, saying the same thing twice. It is hidden and its
line kept as `padding-top` on the block, so the space it held stays as room over
the title. Hidden in CSS rather than removed from `DeskView.tsx`, so the markup
is untouched.

---

## The turn's four cards

### 6. They ended at different heights, then clipped their text

Each card is absolutely positioned under its own seat, so there is no shared row
to stretch them against. The first attempt gave them a `min-height` — which did
nothing, because on a short window the number was below what the content already
measured, so each card still grew on its own.

They are now given one `height`, derived from the room actually left rather than
from a fixed number:

```
--card-h: clamp(212px, calc((100vh - 250px - var(--graph-top)) / 1.25), 320px)
```

`1.25` is the scale the cards are drawn at; `250px` is what the layout below them
spends (110px clear of the bottom edge, a 48px gap, 92px of head and name).
Sparky's own position is then derived from the same figures:

```
--turn-y: min(
  max(calc(var(--graph-top) + 92px + var(--card-h) * 1.25 + 48px), 58vh),
  calc(100vh - 110px)
)
```

`Focus` is pinned to the bottom of each card with `margin-top: auto`, so the four
buttons sit on one line, and the steps list scrolls inside its own card rather
than losing its last step when one agent reports more than the others.

`--card-h` is declared on `.stage`, **not** on `.st-team`: Sparky sits above
`.st-team` in the tree, a custom property set on a descendant is not visible to
its ancestor, and a declaration on `.st-team` would also shadow any override made
higher up.

Checked by evaluating the expression at window heights from 720px to 1200px: the
cards and Sparky keep a positive gap at every step, and he stays clear of the
bottom edge throughout.

### 7. The plan's pill flashed inside the card

There are two of them: a full-width button inside the Trader's card while the
turn runs, and a pill once the turn folds. One replacing the other read as the
button jumping.

The in-card one is hidden while the graph is open — the plan is not settled until
the turn ends — and the card keeps that height for what its agent is saying.

The pill itself leaves the Trader's seat and centres under the whole scene, below
Sparky and his line, since it is the desk's offer rather than that one seat's.
Only the pill moves: the Trader's status chip stays on its seat with the others.
Its `top` is measured from its own card, which already sits inside the row, so
the row's top and the card's offset under the seat are subtracted explicitly —
and a second `min()` floors it 70px above the bottom edge, so following Sparky
can never carry it off screen.

### 8. Small type in the cards was below readable contrast

`.st-card-label` (8px) and `.st-card-steps` (9px) used `--mute` (`#6b7794`), which
measures **3.81:1** against the card's own background (`#161b2e`). The step
markers used `#3b4561` at **1.80:1**.

`--mute-2` (`#8f9bb9`) is added for small type over a panel: **6.14:1**. The step
markers move to `#59658c`: **2.98:1**. `--mute` is unchanged everywhere else.

---

## The suggestions row

### 9. It covered the team, then flickered, then clipped its ends

It was a two-column grid that grew downward over the agents' heads. It is now a
single horizontal row that scrolls sideways, with snapping, which frees about
130px of height in the band where Sparky and the specialists were crowding.

**The flicker** came from `backdrop-filter: blur(10px)` on each card: inside a
scrolling container Chromium re-rasterises it every frame. The filter is dropped
and the background opacity raised from `0.72` to `0.88`, which looks the same and
holds still. The entrance was also shortened, from 460ms to 380ms with a 45ms
stagger instead of 70ms.

**The ends** fade the row out with `mask-image` rather than painting a dark
gradient over it. The first attempt did paint one, and on the right of the desk —
where the background carries the chain's glow — it read as a black patch. A mask
takes the row's own opacity down instead, so whatever colour is behind shows
through. Two discs are added back into the mask so the chevrons stay solid inside
the part that fades.

The first and last card keep clear of the chevrons with a margin **on the cards**,
not padding on the row: padding would pen the fades inside the content box and
stop them reaching the edge.

Card text drops to 11.5px / 9.5px, and to 11px / 9px on a window under 840px tall.

---

## Elsewhere

### 10. A hash walked out of the chat bubble

A request id, an address or a transaction hash arrives as one unbroken run of
characters with nowhere to break. `.st-turn p` gets `overflow-wrap: anywhere`,
which breaks inside a word only when there is no other option; ordinary text
still wraps on spaces.

### 11. `--mono` was used but never defined

`IdentitySheet.module.css` sets `font: 11px/1.6 var(--mono)` on `.packet` (the
signed evidence packet) and `font: 10px var(--mono)` on `.badge`. `--mono` was
not defined anywhere, so `var(--mono)` had no value, the `font` **shorthand**
became invalid, and the whole declaration was dropped — not just the family.
Both fell back to the inherited font and size, which is why a hash rendered in
the UI's sans-serif at the wrong size. `--mono` is now a token in `:root`; both
call sites were already correct.

### 12. The identity sheet spoke a different visual language

It is the ENS surface, and it used green for links, focus rings and input
backgrounds where the rest of the app uses coral, with square grey buttons
instead of the app's pills.

Links, focus and inputs now use the app's accent, and buttons are pills with the
standard hover. **Green is kept where it carries meaning** — a confirmed activity
dot, a live action — and dropped where it was decoration. The pending dot moves
to the app's amber (`#ffb020`) and the reverted dot to `var(--err)`, both already
used for those states elsewhere.

### 13. The public `/ens` page scrolled twice

`page.tsx` puts `.publicPage` and `.body` on the same element and both set
overflow, so the page scrolled inside itself. `.publicPage` uses `min-height`
with visible overflow instead. `.body h1` gets the display face, since the page's
only `h1` was rendering at the browser default.

### 14. The header clipped its own controls

Inside a desk it carries up to eleven: six actions, the team switch, Dashboard,
the gear, the wallet chip and Log out. With no wrap and no breakpoint, Log out
and the wallet were cut off the right edge as soon as the window narrowed.

It now gives way in order and only as far as it must: the gaps close at 1400px,
the wallet chip shortens and the labels drop half a point at 1200px, and the row
wraps rather than letting anything be cut.

### 15. Smaller things

- **The Sparky glow jumped** instead of sliding when the conversation opened: a
  second `.st-blob` rule declaring `transition: filter` replaced the `left`
  transition rather than adding to it. Both are now in one declaration.
- **"They draft. You approve." was left-aligned** when it wrapped. The column
  centres the box, but nothing centred the lines inside it. `text-align: center`
  with `text-wrap: balance`, and a half-space of padding to give back the
  trailing letter-space that the tracking adds after the last character.
- **The status pills under the seats** are each as wide as their own word, which
  is right; what did not match was where they sat. The Trader's card is the only
  one that also carries the plan's pill, and it had a different box because of
  it. Every card on the team now centres its contents the same way.
- **Scrollbars** are dark app-wide: no track, a translucent blue thumb, coral on
  hover.
- **Keyboard focus** had six `:focus-visible` rules and the browser's ring
  everywhere else. One base rule covers buttons, links, selects, summaries and
  anything with `tabindex`, in `var(--coral)`. More specific rules still win.
- **The featured desk card** was washed green from edge to edge. The chain's
  green is pulled down and right, where the team stands, and the card's base
  returns to the app's own dark, so the title reads against it.
- **The team seats scale** at `max-width: 820px` and `680px`, so the row stops
  reaching past both edges on a narrow window.

---

## Not done, deliberately

- **`<title>` / metadata on `/ens`.** The tab reads as the bare URL. Adding it is
  a code change in `page.tsx`, outside this branch's scope.
- **Focus trapping in the Settings and Memory panels.** Both are `role="dialog"`
  without `aria-modal`, and both stay tabbable while closed. Fixing it needs
  focus management in JavaScript, not CSS.
- **Unused images.** `public/sparky.png` and `public/sparky-full.png` are no
  longer referenced (~1.3 MB). Left in place.
- **Auto-advancing the suggestions.** A suggestion is a button: if the strip
  moves on its own, a click lands on whichever card slid into place, and holding
  each one long enough to read would leave it nearly static either way.

---

## Checks

| | |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run typecheck -w @perkos/runtime-web` | 0 errors |
| `npm test` | 738 / 745 pass |
| `npm run build -w @perkos/runtime-web` | compiles, no warnings |
| Braces in both stylesheets | balanced |

The 7 failing tests are unrelated to this branch and fail the same way on `main`:
they assert POSIX `0600` file modes, which Windows reports as `0666`.

Contrast figures were computed against the real background each token sits on
(`--panel` `#0a0e1a` and the card's `#161b2e`) with the WCAG relative-luminance
formula. Vertical fit was checked by evaluating the `--card-h` and `--turn-y`
expressions at window heights from 720px to 1200px.
