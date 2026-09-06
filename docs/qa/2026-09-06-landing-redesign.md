# Landing redesign — 2026-09-06

The public homepage now leads with a private poker-night invitation and the real
3D lounge. Start actions respect authentication; an expandable room-code form
uses the existing invite/login handoff. The page also includes two camera views,
a user-operated example hand, a concise host/invite/play explanation, fair-play
links, and native accessible FAQs.

The account interface and 3D renderer were not changed. Old landing-only global
styles were removed; the new stylesheet is scoped to this page. Metadata now
matches the social, play-money positioning. Zeus SDK controls and tokens remain
the design foundation.

## Evidence

- [Desktop, complete page](landing-redesign/desktop.webp)
- [Phone, complete page](landing-redesign/mobile.webp)
- [Phone, final example hand](landing-redesign/hand.webp)
- [Browser assertions and accessibility results](landing-redesign/uat-report.json)
- [Surface brief](../../apps/web/.impeccable/surfaces/apps-web-src-pages-landing-landingpage-tsx.md)

Product media were captured from the actual local Three.js renderer. Six
illustrative players and a flop were supplied through a browser-only WebSocket
fixture. No room was created and no database was altered for these images. The
in-app control-hiding action and a capture-only rule hiding the restore button
produce clear views. Both image sources carry provenance sidecars in public/media
and the page labels the room as an example. The landing itself does not load
Three.js; the 3D route remains lazy-loaded.

## Verification

Playwright Chromium tested the dev application with the local server. Browser
assertions passed at 1440, 768, 390, and 320px widths. The images and self-hosted
font loaded. Document and child geometry showed no horizontal overflow.

- All four viewport checks returned zero axe violations for WCAG 2 A/AA and 2.1 AA.
- The join form's error state also returned zero violations.
- Keyboard skip link, selected gallery state, and unchanged image geometry passed.
- Example hand progressed through 0/3/4/5 community cards and reset to zero.
- Every FAQ opened and closed through the keyboard.
- Empty and malformed codes showed errors and focused the field; lowercase code
  MADWGN normalised and reached /login?join=MADWGN for a logged-out visitor.
- Logged-out Start a table reached login. Authenticated Open your lobby reached
  the actual lobby and rendered its room list.
- Header section anchors and the fair-play guide destination worked.
- Phone join errors, overhead view and complete hand were exercised separately.
- No JavaScript runtime errors were observed.
- Web TypeScript check and production build passed. The existing large-chunk
  advisory remains for application/3D dependencies.
- The emitted HTML retained the landing direction contract and seed 9e8aa000.

Initial checks caught a missing card-group role, an invalid ref on the shared
Input adapter, and a test locator that expected the wrong lobby heading. All
were corrected. Visual review additionally corrected the 320/768px heading wrap,
small-card symbol collisions, card corner inheritance, and reduced-motion card
fading. Checks and affected captures were repeated after the fixes.

The mechanical design detector reported only Inter as an overused font. Inter
is the user's chosen Zeus typeface and the existing DESIGN.md authority; that
line has an explicit, narrowly scoped exception. No new identity was introduced.

## Finishing review — inline fallback

The separate reviewer provider was unavailable in this environment. This review
and documentation pass were performed inline; no independent review is claimed.
The design was implemented under delegated judgment, without claiming that the
user chose or approved an image comp.

Initial disposition: fix.

### persistence

Pass. The established Zeus system remains authoritative. Page-specific strategy
is in its surface brief. Product images carry source metadata.

### fidelity

| Element                               | Finding                                                             |
| ------------------------------------- | ------------------------------------------------------------------- |
| Invitation, start/join actions        | Match to the implementation contract                                |
| Actual room imagery                   | Match; visible and labeled as an example                            |
| Two-line headline                     | Needed responsive sizing at 320/768px                               |
| Gallery and example hand              | Match; real local state and keyboard operation                      |
| Cards at small sizes                  | Needed smaller pips and inherited corner rounding                   |
| Reduced motion                        | Needed to suppress the example's opacity animation                  |
| Mobile composition                    | Adaptation: stacked invitation, cropped room, reordered explanation |
| Zeus palette, controls and typography | Match to DESIGN.md and installed SDK                                |

### ceiling

The page uses the established world's type contrast, blue actions, flat neutral
surfaces and actual scene imagery. The hand interaction adds game context without
running a decorative WebGL scene or introducing an unrelated visual identity.

### material_fixes

1. Give the card group a valid accessible role.
2. Preserve the two-line headline at tablet and narrow phone widths.
3. Reduce card corner/centre symbol sizes and inherit the card radius locally.
4. Stop the example's fade when reduced motion is requested.

### keep

Keep the real room dominant, start/join obvious, examples clearly labeled, and
all landing styles local to the surface.

### verdict

All four findings resolved in the final browser run and recaptures. Cards have
clear corner and centre symbols; the headline retains two lines at the affected
widths; accessibility scans are clear; reduced-motion reveals are immediate.

### remaining

Clear for this landing-page change. Final disposition: ship.

## Documenter record

Written: the landing surface brief and an additive reference in DESIGN.md.
The existing .impeccable/design.json system tokens were preserved.

- Palette: existing Zeus neutrals and blue, with the product's night scene as media.
- Type: existing Inter, with a larger responsive landing display hierarchy.
- Controls: installed Zeus buttons, links and input primitives.
- Layout: public page composition remains separate from account/sidebar rules.
- Interaction: explicit user input, visible state, keyboard support, reduced motion.

Not canonised: hero dimensions, example player data, card-demo sizing and page
sequence; these belong to this surface, not the global design system.

## Limits and delivery

This was desktop Chromium and emulated phone-width browser UAT. It is not a fresh
multiplayer protocol audit, Safari run, or physical-phone test. The prior poker
workflow report remains separate. No deployment or remote push was performed for
this redesign; the BB Connect development preview serves it.
