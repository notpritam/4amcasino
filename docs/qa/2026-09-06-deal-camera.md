# 3D Deal controls and viewer-centred camera

The hand recap and floating side widgets now stop above the measured poker dock.
Long content scrolls within its widget, including the complete character studio
on short screens. A new result restores hidden controls. The host's 3D action is
labelled **Deal hand**; the 2D action and the server protocol are unchanged.

Table, Close, and Overhead cameras centre the viewer's physical seat. Close/Table
distance accounts for the oval's different seat radii. Changing seats or returning
from the lounge re-centres the table camera; chip updates preserve a manual orbit.
Side, Lounge, and TV remain independent destinations. Perimeter architecture cuts
away when the camera looks through it into the room, then returns when the camera
moves inside. Characters and chairs retain their shared world coordinates.

## Reproductions and verification

Before the fix, seat 4 projected off-centre (NDC x = -0.286). A long abort result
intercepted the Deal button on a 390×844 viewport. Further browser checks found
that the nine-player list also intercepted Deal, and rotating to landscape left
a stale zero clearance. The final measurement uses dock height plus its anchored
bottom gap. A desktop capture also revealed the window frame across the player's
head and table after camera centring; the cutaway removes that obstruction.

- **142 web tests passed across 9 files**, including camera projection for all nine
  seats, geometry-based sightline checks, physical seating, walking, and gestures.
- Web TypeScript check and production web/server build passed. Existing large-chunk
  advisories remain.
- Chromium with real software WebGL checked **54 seat/view/viewport combinations**:
  nine seats × Table/Close/Overhead × desktop/phone. Every viewer projected to the
  horizontal centre and stayed in frame.
- Browser checks confirmed manual orbit survives chip updates, Side view survives
  seat changes, Return to seat restores the centred camera, and animated camera
  transitions settle on the viewer.
- Long abort and nine-player showdown fixtures at **1440×900, 390×844, 844×390,
  and 320×700** remained scrollable above the dock. Deal clicks dispatched
  `start_hand`; Ready dispatched `im_ready`. Disconnected actions stayed disabled;
  non-hosts had no Deal control.
- Players, Character studio, TV, Lounge, React, and Help widgets left Deal clear at
  **1440×900, 390×844, and 844×390**, including rotation and widget scrolling.
  The studio's Save button was reachable by scrolling in each viewport. New results
  restored a hidden HUD with Deal accessible.
- Canvas bounds stayed unchanged across tested result/widget transitions. No
  uncaught browser errors occurred in the successful regression runs.

These browser checks used intercepted HTTP/WebSocket traffic and synthetic players
and hands. They verify UI dispatch and rendering, not a new live multiplayer deal,
Safari compatibility, or physical-device frame rates. No production game state was
modified during UAT. Local scripts and reports are in `/tmp/4am-3d-qa/` and
`/tmp/4am-deal-camera/`.

## Captures

- [Viewer centred with clear sightlines](deal-camera/viewer-centred-desktop.png)
- [Player list above the mobile Deal controls](deal-camera/players-phone.png)
