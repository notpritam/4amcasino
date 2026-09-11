# Post-hand Deal control regression — 8 September 2026

## Reproduced causes

1. The 2D desktop result hid the in-table Deal control, while its ActionBar also hid the idle start action. No Deal button remained until the recap was dismissed.
2. The desktop fixed result overlay also rendered over the mobile layout. Phones showed two result copies, with the fixed copy intercepting Start hand.
3. In 3D, saved enlarged cards used a separate fixed position that ignored the measured poker dock. On a 390×844 phone, the panel intercepted Deal at y=522 even though the result overlay itself left the dock clear.

## Fix

2D results now appear once, in normal page flow below the actions, with a bounded, independently scrollable recap. The desktop ActionBar exposes the next-hand action during the recap and remains sticky while reading it. It is disabled while disconnected.

3D enlarged cards now have drag bounds above the same measured dock clearance used by result overlays. A ResizeObserver clamps saved positions when the available space or panel size changes. A visible header grip moves the panel; the card body can scroll on short screens. Resizing and dragging cannot push the panel across the poker controls. The 2D floating-card behavior remains unchanged.

## Verification

- The committed browser regression failed before the fixes: no desktop Deal with a showdown result; 3D phone Deal intercepted with enlarged cards enabled.
- `apps/web/test/browser/post-hand-deal.mjs` passed 24 result combinations: 2D/3D × 1440×900, 390×844, 844×390, 320×700 × showdown, folded win, long abort.
- The run used real Chromium WebGL rendering, synthetic room/hand fixtures, and intercepted API/WebSocket traffic. Every Deal click emitted `start_hand`; no live multiplayer hand was started.
- It checks exactly one visible recap, pointer reachability, dismissal, unchanged 3D canvas bounds, enlarged-card containment, resizing, dragging toward the dock, and restoring out-of-bounds saved positions.
- Web typecheck, web/server production build, and 150 existing web tests passed. The existing large-bundle advisory remains.
- Captures: `/tmp/4am-post-hand-deal/`. Logs: `/tmp/4am-3d-qa/result-*.log`.

## Re-run

Start the Vite dev server. With Playwright available in the workspace:

```sh
BASE_URL=http://localhost:5174 node apps/web/test/browser/post-hand-deal.mjs
```

An external installation can be supplied using `PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs`. Set `BROWSER_EXECUTABLE` to use an existing Chromium binary. `MODES=2d` or `MODES=3d` limits scope. `NO_WEBGL=1` exercises the fallback layout only; omit it for the rendering check. The script creates its own synthetic session and requires no credentials or existing room.

## Escape dismissal — 12 September 2026

The shared table controller now lets Escape dismiss the visible winning/result recap in 2D, phone and 3D views. It uses the same state as the existing close button. Open dialogs/menus retain priority; held or composing Escape events are ignored. A handled Escape does not also close docked chat or reset the 3D controls. Both close buttons advertise the key in their tooltip and accessibility metadata.

The browser regression failed before the fix because the result remained visible after Escape. It now passes all 24 result/view/viewport combinations, checks that the next result reappears and can still be closed by pointer, verifies top-dialog priority and docked-chat preservation, and confirms no game message is sent by Escape. Existing Deal reachability, floating-card containment and 3D viewport checks also pass. Evidence: `/tmp/4am-result-escape.log` and `/tmp/4am-result-escape/`.

All 163 web tests, the web typecheck and production web/server builds passed. Existing bundle-size warnings remain.

This follow-up remains local alongside the auto-deal change; no deployment was performed.
