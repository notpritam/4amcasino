---
version: 1
slug: 'apps-web-src-pages-landing-landingpage-tsx'
primary_target: 'apps/web/src/pages/landing/LandingPage.tsx'
related_targets: ['apps/web/src/pages/landing/landing.css']
---

# Landing page: your people, your poker night

Mode: Persuade. Audience: a friend organising a private, play-money poker night.
The primary action is to start a table; a returning invitee can enter a room code.
The page should make the social experience understandable before explaining verification.

## Authority and chosen structure

Keep the established Zeus world in DESIGN.md: official SDK controls, Inter,
white/neutral surfaces and blue actions. The user's standing delegation grants
design judgment; the latest request asks to rethink the landing page. This is an
implemented direction, not a claim of explicit user approval of a new comp.

Surface concept seed: 9e8aa000; dealt candidates 7, 1, 5, catalogue c3b204a1eed6.
Structures considered: social split hero; full-room annotations; playable hand
first; invite builder; two-view gallery; post-hand replay story; invitation/open
table composition. The invitation structure (7) was selected using delegated
judgment, with the view gallery and hand example as subordinate proof.
No concept selection telemetry is recorded as a user choice. This brief and the
production HTML contract record the implementation; they were persisted after
the initial code, not represented as a pre-approved comp.

## Page sequence

- Large two-line invitation with start/login destination and expandable join form.
- Actual lounge and overhead captures, labeled as an example room.
- Short host/invite/play explanation, without promotional feature-card repetition.
- Deliberate, user-operated example hand: preflop, flop, turn, river, reset.
- Concise fair-play and ledger explanation, links to actual documentation/source.
- Native keyboard-accessible FAQ and a final contextual start action.

## Surface rules

Keep the real lounge as the largest media region. Do not import or run Three.js
for this page. Static WebP images provide two camera views; both have fixed
geometry, including on first load and selection changes. Example names/stacks
are authored fixture data, never metrics or testimonials.

Use real PlayingCard components for the example, the existing /j/:code invite
handoff for joining, and Zeus ButtonLink/LinkButton/InputBase for controls.
Only deal on user input. Announce the street and explanation with a polite live
region. Respect reduced motion. Do not make the demonstration look like a live
multiplayer session. Keep typography and scene style consistent with the app.

The page stacks below 760px. The account sidebar remains in the authenticated
application; the landing uses a small public header. No global identity changes.

## Acceptance

Check 1440, 768, 390 and 320px widths, first viewport and complete page; runtime
errors; WCAG AA checks; keyboard gallery, FAQ and skip link; empty/invalid room
codes and lowercase normalisation; logged-out and logged-in start destinations;
hand progression/reset; image loads and viewport stability. Build and typecheck.
No deployment is part of this landing change.
