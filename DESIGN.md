# 4AM Casino design language

- **Canvas:** light slate-100 app with full dark mode; the landing page and phone
  table are always night (slate-950) - it is called 4AM.
- **Accent:** indigo-600 (actions, pots, brand). Emerald = winning/positive,
  rose = losing/negative/fold, amber = committed chips, bounties, and the
  chip-leader crown. Never purple-to-blue gradients.
- **Type:** Bricolage Grotesque for display and every number (NumberFlow
  animates chips); Onest for sentences. Amounts always use the display face.
- **Cards:** the real `PlayingCard` component everywhere, including marketing
  visuals; card backs are the user-picked colorway; face-down "encrypted" cards
  use indigo hatching.
- **Signature moves:** barber-pole stripes on whoever is acting; gold ring on the
  winning five; grainy near-black share cards; ciphertext as texture.
- **Motion:** springs for emphasis, ease-out for entrances, no bounce easing;
  everything respects prefers-reduced-motion.
- **Copy rules:** no em dashes in UI copy, active voice, buttons say exactly what
  happens, errors say what to do next.
- **Tools:** `npx impeccable detect apps/web/src` must stay clean.

## Cypherpunk theme ('cyber')

The default theme (Settings offers Light / Dark / Cyber). Terminal green on
green-black, "encrypted by design": accent #5cff72 with ink #041007 on neon
fills, surfaces #050a07 to #0a130e, danger is magenta #ff2e88, borders are
rgb(92 255 114 / .2-.3). Display type Unbounded, body JetBrains Mono, corners
squared (2-4px). Implemented as a `.cyber` scope in index.css that remaps the
slate and indigo Tailwind variables, so components keep writing plain
slate/indigo utilities - never hardcode the green in components. The table
plays on a wireframe grid, not felt. Magenta appears only as flourish
(// comments, card offset shadows, chroma text) - never for primary actions.
