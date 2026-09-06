---
name: 4AM Casino — Zeus
description: Private poker tables with a Zeus account interface and an immersive lounge.
colors:
  primary: 'oklch(62.3% 0.214 259.815)'
  primary-deep: 'oklch(54.6% 0.245 262.881)'
  canvas: '#ffffff'
  surface: '#f7f7f7'
  border: '#ebebeb'
  ink: '#171717'
  muted: '#707070'
typography:
  body:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '14px'
    lineHeight: '20px'
  title:
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
    fontSize: '24px'
    fontWeight: 600
rounded:
  control: '10px'
  panel: '16px'
  sidebar: '24px'
spacing:
  small: '8px'
  medium: '12px'
  panel: '20px'
  section: '24px'
components:
  sidebar:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.sidebar}'
    padding: '12px'
    width: '260px'
  panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
    padding: '20px'
---

# Design System: 4AM Casino

## Overview

**Creative North Star: "Zeus around the table"**

Use the official Zeus UI design system selected by the user at myzeusui.com:
white canvas, neutral panels, Inter typography, blue actions, and a floating icon
sidebar. Poker remains the content. The immersive 3D lounge uses the same action
language in transparent widgets over its night scene.

**Key Characteristics:**

- One account appearance, with no light, dark, or cyber selector.
- Compact navigation that expands to show names and real tables.
- Actual account data, honest empty states, readable gains and losses.
- A full viewport for the 3D world, independent of the control state.

## Colors

The normative palette comes from `@zeus/tokens` 0.2.3. `zeus.css` bridges existing
slate and indigo utility names to the neutral and blue palette. Primary colors in
the frontmatter retain the source OKLCH values. Emerald means positive results,
rose means losses or a fold, and amber means committed chips or blind positions.
Small text on neutral panels uses the darker muted tone for contrast.

Night colors are scoped to the 3D environment and its glass controls. They are
part of that scene, not a second user-selectable application theme. Card-back
colorways and four-color suits remain player preferences.

## Typography

Inter is self-hosted and used for both headings and body copy. The official Zeus
SDK supplies control metrics; use tabular numbers for chips, timestamps, and
charts. Keep labels in normal sentence case. Card ranks and cryptographic hashes
retain their appropriate card and monospace treatments.

## Layout

The desktop sidebar floats twelve pixels from the viewport edges. It is sixty
pixels wide as an icon rail and expands to the width recorded above. Its width is
persisted. Below 768 pixels, a keyboard-accessible navigation drawer replaces the
rail. Search uses the same destination list, including settlement and settings.

Account panels use a responsive grid with zero minimum column widths to prevent
long content from pushing the viewport wider. The lobby is checked down to 320
pixels. The 3D world always occupies the dynamic viewport; its floating controls
never reserve a page track or resize the canvas.

## Elevation & Depth

Use Zeus tonal surfaces with restrained shadows on navigation and raised
controls. Selected navigation uses the official blue gradient and inset highlight.
Keep ordinary account panels quiet. Glass controls use a translucent dark backing,
a subtle border, and a stronger fallback for reduced transparency.

## Shapes

Controls are softly rounded; panels have broader corners, and the floating
sidebar has the broadest corners. Preserve actual playing-card proportions and
round status chips only where their meaning calls for a badge.

## Components

### Shared controls and navigation

Use `Button` and `InputBase` from `@zeus/ui/base` through the shared adapters.
Preserve native form submission, disabled state, keyboard focus, and accessible
names. Icons in the shared sidebar and settings navigation use Remix Icon.
The navigation supports collapse, search, active routes, account status, and a
mobile focus trap. Links from a live table open account destinations separately.

### Charts

Use the actual Zeus `ChartCard` and `ChartLegend` around the existing Recharts
plots. Winnings are cumulative chips with a visible zero line and a domain that
includes losses. Never substitute sample history. Include period filters,
explicit empty states, and an accessible data table. Respect reduced motion.

### Playing cards

Use `PlayingCard` everywhere, including marketing. Face-up and face-down cards
have image roles and accessible names; invisible spacing slots stay out of the
accessibility tree. Use dark text on bright blind badges.

### 3D midnight lounge

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

## Do's and Don'ts

- Do use the installed Zeus SDK and tokens for shared application controls.
- Do preserve native forms and all existing poker actions during visual changes.
- Do show real account data and readable negative chart values.
- Do keep the world canvas stable when controls appear, collapse, or hide.
- Don't restore old theme selectors or global cyber overrides.
- Don't let UI typing steer the character.
- Don't put scenery or HUD labels across the overhead card area.
