# Full-screen 3D glass widgets

The 3D renderer now fills the complete dynamic viewport. The header and bottom
controls are floating glass widgets with transparent space between them, so they
no longer reserve solid bands above or below the world. Cards and camera presets
collapse independently, and idle hands do not show empty community-card slots.

Hide controls leaves one restore button. Escape restores the HUD too. A poker
turn, unanswered ready check, run-it-twice prompt, or private-card offer restores
the required controls. A new decision also closes side widgets that could cover
the action area. These transitions retain the same renderer and camera.

## Verification

- Web tests: **125 passed across 6 files** (`npm test -- --run apps/web/test`).
- Web TypeScript check passed (`npm run typecheck --workspace @4am/web`).
- Production web and server bundles built (`npm run build --workspace @4am/web`).
  The existing lazy Three.js chunk-size advisory remains.
- Impeccable detector and `git diff --check` passed.
- Real Chromium with software WebGL verified **1440×1000, 1024×768, 768×1024,
  390×844, 375×667, 320×568, and 844×390**. In every viewport the canvas starts at
  (0, 0), matches the full viewport dimensions, and remains unchanged across idle,
  betting, and disclosure transitions. No horizontal document overflow or
  duplicate world renderer was found.
- Hide/restore, Escape, card collapse and turn restoration, guarded Call dispatch,
  raise-slider bounds, ready checks, camera disclosure/focus, Chips menu placement,
  full-viewport bank dialogs, character studio, players, reactions, and TV panel
  bounds passed at all seven sizes.
- Separate desktop/phone checks passed for long room titles, run-it-twice votes,
  private-card offer responses and their visibility. Empty header/footer gaps
  hit the canvas, widget clicks do not hit it, and dragging the world changes the
  camera. The phone TV panel closes for a new turn without moving the camera,
  and the uncovered Call button dispatches correctly.
- The primary Raise and Call buttons measured **10.82:1 and 10.20:1** text contrast
  respectively in the desktop and phone captures. The lounge disables the 2D
  cyber theme's page-wide scanlines and forced bright button colors.
- The 2D route retains its standard ActionBar presentation with no glass widgets.
  No browser page errors occurred in the successful checks.

The local browser fixture intercepted API/WebSocket traffic and used synthetic
players and hands. No live account, table, or chip balance was changed. These checks
do not establish physical-device frame rates, Safari behavior, or a live
multiplayer/voice session. No deployment was performed for this change.

## Screenshots

| State           | Desktop                                                             | Phone                                                   |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------------------- |
| Idle            | [Full world with compact controls](glass-widgets/desktop-idle.webp) | [Idle widgets](glass-widgets/phone-idle.webp)           |
| Your turn       | [Cards and betting widgets](glass-widgets/desktop-turn.webp)        | [Phone betting controls](glass-widgets/phone-turn.webp) |
| Controls hidden | [Unobstructed world](glass-widgets/desktop-clear.webp)              | [Phone clear view](glass-widgets/phone-clear.webp)      |
| TV              | [TV side widget](glass-widgets/desktop-tv.webp)                     | [Phone TV panel](glass-widgets/phone-tv.webp)           |

Local verification scripts/logs were kept in `/tmp/4am-3d-qa/`:
`glass-widgets.mjs`, `glass-verification.log`, `glass-attention.mjs`,
`glass-attention.log`, `glass-tests.log`, `glass-build.log`, and `glass-2d.log`.
The temporary browser fixture was removed from the application after verification.
