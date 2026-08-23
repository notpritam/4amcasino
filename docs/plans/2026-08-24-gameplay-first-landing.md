# Gameplay-first Landing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the 4AM Casino landing page around a clear promise and an authentic, responsive gameplay preview.

**Architecture:** Keep the existing React/Vite/Tailwind stack and public route. Replace the current repeated centered demo sections with focused local landing components backed by representative display data and the existing `PlayingCard` component; add narrowly scoped CSS for atmosphere, responsive stage layout, and reduced motion.

**Tech Stack:** React 18, TypeScript, React Router, Tailwind CSS 4, Motion, Phosphor Icons.

---

### Task 1: Establish the landing page structure

**Files:**
- Modify: `apps/web/src/pages/landing/LandingPage.tsx`

1. Replace the current repeated section array with semantic header, main, and footer landmarks.
2. Add a skip link and anchor navigation for gameplay, features, and fairness.
3. Keep the existing token-aware login/lobby destination.
4. Run `npm run typecheck --workspace @4am/web` and resolve all TypeScript failures.

### Task 2: Build the real-product hero stage

**Files:**
- Modify: `apps/web/src/pages/landing/LandingPage.tsx`
- Reuse: `apps/web/src/entities/card/PlayingCard.tsx`

1. Add representative player, board, pot, and hand data next to the page component.
2. Render an accessible table preview using the real card component and Phosphor controls.
3. Add motivated Motion entrances and active-turn feedback guarded by `useReducedMotion`.
4. Ensure the preview is labeled as a product preview rather than a live table.

### Task 3: Add the product story

**Files:**
- Modify: `apps/web/src/pages/landing/LandingPage.tsx`

1. Add the trust strip without invented statistics.
2. Add asymmetric sections for inviting friends, playing a hand, and reviewing a session.
3. Add a concise technical section for encrypted cards, the ledger, open source, and AI seats.
4. Add final CTA and legal/product links with no dead `#` destinations.

### Task 4: Add landing-specific visual polish

**Files:**
- Modify: `apps/web/src/app/index.css`
- Modify: `apps/web/index.html`

1. Add landing texture, stage lighting, nested surfaces, and responsive utilities under a landing namespace.
2. Add focus-visible and reduced-motion fallbacks.
3. Add complete description, theme color, Open Graph, and Twitter metadata.
4. Avoid animation of layout properties and large scrolling backdrop filters.

### Task 5: Verify and repair

**Files:**
- Modify: files implicated by failures only.

1. Run `npx prettier --write apps/web/src/pages/landing/LandingPage.tsx apps/web/src/app/index.css apps/web/index.html`.
2. Run `npm run typecheck` and fix failures caused by this change.
3. Run `npm test` and fix regressions caused by this change.
4. Run `npm run build --workspace @4am/web` and fix bundling failures.
5. Run `npx impeccable detect apps/web/src` and resolve relevant findings.
6. Start the local app, inspect desktop and mobile layouts, and fix overflow, interaction, or contrast issues.
