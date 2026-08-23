# Gameplay-first landing redesign

## Goal

Make the public landing page feel like the front door to a real poker table. A visitor should understand within one screen that 4AM Casino is free, private poker for friends, see how a hand feels, and know exactly how to start.

## Direction

Keep the existing 4AM identity and the always-night canvas. Borrow Offsuit's product discipline: a short promise, a dominant real-product visual, generous spacing, and one primary action. Do not copy its brand, phone mockup, or app-store framing.

The page uses an editorial split hero. The left side carries the promise and two actions. The right side is a responsive session stage built from the app's real card, player, and betting vocabulary. On mobile it becomes a compact vertical table with large touch targets.

## Experience

1. A floating but restrained header exposes the brand, product anchors, GitHub, and the contextual play action.
2. The hero says "Poker night without the house" and immediately clarifies that the product is play-money Texas Hold'em for friends.
3. A staged live hand shows players, community cards, a pot, the user's cards, and betting controls. The scene animates once to explain hierarchy and then stays calm.
4. A short proof strip establishes free play, encrypted cards, auditable chips, and open-source code without fake metrics.
5. Three asymmetric story sections cover the full loop: invite friends, play a real hand, and keep a trustworthy session record.
6. A compact "under the table" section explains mental poker and AI seats for technically curious visitors without making cryptography the entry barrier.
7. A final call to action and minimal legal/product footer close the page.

## Visual system

- Canvas: tinted near-black, not pure black, with subtle fixed grain and soft indigo light.
- Type: Space Grotesk for display and numeric UI; the existing body stack remains for compatibility.
- Accent: indigo only for primary action and active state. Emerald, amber, and rose remain semantic gameplay colors.
- Shapes: large stage radius, tighter nested controls, and physical inset surfaces. Avoid a grid of equal marketing cards.
- Icons: the app's existing Phosphor set at a consistent weight. No emoji as interface icons.
- Motion: transform and opacity only; staged card/player entrances, active-turn pulse, and scroll reveals. All motion respects reduced-motion preferences.

## Components and data

The page remains static and public. It reads the existing auth token only to choose between login and lobby destinations. The gameplay stage uses representative local display data and real `PlayingCard` components; it does not pretend to be a live room or call the API. All visible sample state is framed as a product preview.

## Accessibility and resilience

Use semantic landmarks, a skip link, visible focus states, readable contrast, descriptive labels, and minimum 44px mobile targets. Navigation collapses without hiding the primary action. Decorative texture is ignored by assistive technology. Reduced-motion users receive the final composed state immediately.

## Verification

Run formatting, TypeScript checks, the repository test suite, the production web build, and `impeccable detect`. Verify the landing page at desktop and mobile widths in a browser, including navigation, CTA destinations, overflow, focus visibility, and reduced-motion behavior.
