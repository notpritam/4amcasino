# 3D poker experience implementation plan

Goal: make the existing 3D table feel finished, expressive, responsive, and easy to operate.

Direction: preserve the violet neon lounge. Build collectible robot characters with articulated limbs, expressive faces, meaningful head silhouettes, and detailed accessories. Keep the existing avatar data and multiplayer emote protocol compatible. Use a focused wardrobe with live preview, curated presets, and explicit save/error feedback. Separate camera/social controls from the existing poker action bar. Expose connection, turn, pot, and private cards in a readable HUD.

Alternatives considered: imported humanoid models (asset/licensing/loading overhead), a cosmetic HUD-only pass (leaves character quality unchanged). Procedural character redesign fits the existing world and customization best. User has delegated design decisions and iterative improvement.

1. Extract and validate compatible avatar configuration; add malformed/legacy payload regression coverage.
2. Build reusable character rig and persistent, responsive preview with orbit and pose previews.
3. Implement wardrobe, HUD, player interactions, camera presets, loading/error handling, and mobile composition.
4. Improve scene cleanup, reduced-motion behavior, targeted subscriptions, and camera framing.
5. Run typecheck, production build, relevant tests, design detector, and browser checks with local fixture data on desktop and mobile. Inspect screenshots, fix observed defects, and confirm improvements.

Gameplay, balances, settlement, and hosting migration stay outside this UI work.
