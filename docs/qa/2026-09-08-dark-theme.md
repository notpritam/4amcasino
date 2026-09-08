# Zeus dark appearance — 8 September 2026

Added the official Zeus light/dark control to public entry pages, the account sidebar and mobile drawer, Settings → Appearance, and the 3D Table controls dialog. Light remains the default; the choice is saved on the device and shared across tabs. Server profile refreshes no longer reset appearance.

The external head bootstrap restores the choice before React renders, updates browser chrome, and works with the existing `script-src 'self'` policy. No server preference migration or security-policy change is required. Neutral surfaces, secondary copy, landing-page borders and example-table surfaces adapt to dark mode. Playing cards retain white faces, and the 3D night environment retains its camera and viewport.

## Verification

- Web TypeScript check and web/server production builds passed. Existing large-bundle advisory remains.
- 150 web tests across 10 files passed, including eight bootstrap checks covering defaults, persisted dark, blocked storage, theme events, cross-tab changes, and cleared preferences.
- Chromium interactive checks covered keyboard switching, reload persistence, cross-tab synchronization, pre-React restoration, Settings/profile loading, and the mobile navigation control.
- Visual/accessibility inspection covered light and dark landing pages; dark login, Settings, lobby, leaderboard, player stats/charts, settlement, fair-play guide, and 2D table. Landing widths: 1440, 390 and 320 pixels. Login, Settings/navigation and table also checked at phone width.
- The first desktop table audit found an existing invalid ARIA label on empty community slots. Adding the image role corrected it; the confirmation audit passed. All audited final screens had no WCAG A/AA violations reported by axe. This does not claim a complete manual accessibility audit.
- 3D fixture UAT at 1440×900 and 390×844 verified pointer/keyboard theme switching, unchanged camera position and canvas bounds, and an unobstructed Deal button emitting `start_hand`. No live multiplayer hand was started for this check.
- Production-server browser checks verified animated theme switching, reload/browser-chrome persistence, and dark form-validation contrast with no CSP violations or uncaught runtime errors.

Artifacts from this run: `/tmp/4am-dark-uat/`; browser scripts and logs: `/tmp/4am-3d-qa/dark-*.mjs` and corresponding logs. Local UAT used existing test accounts; private auth fixtures are outside the repository.

## Finish review

The Zeus composition, Inter typography and blue actions remain consistent in both appearances. Theme controls work with touch and keyboard; compact controls have a 44px target. Dark surfaces, text, borders, charts, card faces and narrow layouts were inspected. No unresolved theme defects found in the checked scope.
