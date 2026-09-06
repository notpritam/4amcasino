# Full-screen 3D glass widgets

**Goal:** Give the lounge the entire viewport, with translucent controls floating above it and no reserved header or footer bands.

**Architecture:** Keep the existing Three.js world and shared poker controller. Replace the three-row page shell with a full-viewport stage. Group the identity, room tools, navigation, cards, and actions into bounded glass widgets; empty space passes pointer input through to the world. Add compact semantic styling hooks to the shared ActionBar without changing its behavior or 2D presentation.

**Design:** Preserve the midnight lounge, typefaces, cards, and accent. Use translucent dark glass for readable labels over moving scenery, with a stronger fallback for browsers without backdrop filtering. No full-width tinted scrim. Collapse camera presets and the card tray independently. Hide-controls mode leaves one restore button and exits automatically for a betting turn, ready check, run-it-twice request, or private-card offer. Idle hands do not show five empty placeholder cards.

**Implementation:**

1. Update Table3DPage and TableCards for the widgets, disclosure controls, and mandatory-action visibility. Keep the renderer mounted across HUD changes.
2. Update table3d.css for full-screen geometry, pointer routing, safe areas, compact actions, glass panels, and mobile/short-screen scrolling. Add semantic ActionBar classes with no 2D behavior change.
3. Verify desktop, phone, and landscape states in the local browser fixture: idle, dealt cards, turn transitions, hide/restore, ready checks, long titles, panels, camera presets, pointer routing, and keyboard focus. Confirm the canvas bounds always equal the viewport.
4. Run web tests, typecheck, production build, and the design detector. Record screenshots and scope of verification. Keep this change local unless publication is requested.
