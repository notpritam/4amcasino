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
viewer and shared 2D controls remain available.

The 3D world fills the entire dynamic viewport. Header, navigation, cards, and
actions float as compact translucent glass widgets; no page track or opaque
full-width band reserves space for UI. Empty space between widgets passes input
to the canvas. Use the glass backing on a pseudo-element where a widget contains
fixed dialogs, so blur cannot trap those dialogs inside its bounds. Readability
comes from pale text, a restrained translucent dark backing, and a stronger
fallback for reduced transparency or unsupported backdrop filtering.

Camera presets and the card widget collapse independently. Hide empty idle card
placeholders. A clear-view control hides the HUD and leaves a keyboard-accessible
restore button; Escape also restores it. Poker turns, unanswered ready checks,
run-it-twice prompts, and private-card offers restore required controls. The
canvas and camera never resize when these controls change. On phones, actions
precede the card widget and the bounded overlay scrolls internally; account and
table dialogs keep the full viewport available for focus and scrolling.

The lounge perimeter uses a layered city skyline with instanced lit windows,
walnut portal frames, upholstered wall alcoves, brass sconces, and illuminated
bar shelves. Warm local lights distinguish seating and the drinks counter;
cool city fill and a soft warm table key keep characters and cards readable.
Only the main key casts realtime shadows. No new furniture enters the walking
lanes or playing area.

After taking a break, WASD and arrow keys steer relative to the camera while the
world has focus. Releasing keys, focusing UI, opening a decision prompt, switching
windows, or losing connection stops steering. Chair exits finish before direct
movement takes over. Swept floor checks slide along obstacles; diagonal movement
uses the same speed as forward movement. Reduced motion keeps direct steering
continuous while disabling gait flourishes. Click destinations and return-to-seat
hand control back to the path planner. Shared movement coalesces to four updates
per second and includes the final stop; authoritative server corrections remain
in charge of occupied arrival spots.
