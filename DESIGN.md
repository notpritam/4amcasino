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

## 3D midnight lounge

The 3D table uses teal wool felt, a walnut floor, brass window frames, warm perimeter
lamps, and a quiet city backdrop. Keep the space above the entire playing surface
open: no ceiling meshes, chandeliers, floating decoration, or pot labels across the
board in overhead view. Both runouts have equal-size, separate rows; private and
public opponent cards rest at their own places on the felt.

Characters sit on a cushion at 0.61 with hips at 0.73, bent thighs/knees, and grounded
boots. Upper-body gestures pivot at the pelvis. Chairs retain their canonical room
positions and orientation for every viewer; they never follow a gesture. Standing,
the chair aisle, walking, turning, and sitting are separate movement stages. Leg
IK keeps the soles grounded and the stride follows distance travelled. Gestures
layer on the current posture, with a short blend when interrupted; they cannot
move the character off its walking path. Targeted effects share a visible wind-up,
flight/contact, recoil, and recovery timeline. Reduced motion settles movement
immediately and keeps interaction feedback.

The room perimeter contains a TV wall, drinks counter, sofa corners, a dance area,
and a city-view spot. Use click/tap destinations around fixed furniture; reserve
dragging for the camera. A destination ring shows where the player is going. A
break reserves the seat and chips; a live, unfolded hand delays departure. Return
and choosing an empty chair use the same approach and sitting stages. Reactions
remain available to unseated members.

The TV has a real video surface, an original silent ambient loop, a public table
channel, and local-file playback. Label playback as local to the device. Keep
play/pause, mute, volume, seeking, fullscreen, recovery, and closing accessible.
Honor reduced motion and pause hidden playback.

Card and chip places belong to the felt, independently of the wider seating
layout. Both runouts, public opponent cards, and the viewer's private cards must
remain clear of the rail and chip stacks from all nine seats. The large-card
viewer and shared 2D controls remain available. The world viewport keeps a fixed
height across turns; the dock scrolls internally. Put betting actions before the
card rail on phones and bring the dock to its top when the player's turn begins.
