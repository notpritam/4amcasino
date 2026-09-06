# Social Lounge Implementation Plan

**Goal:** Make the lounge a usable social space with supported sitting poses, grounded movement, safe breaks from poker, contextual gestures, and a working TV.

**Architecture:** Separate poker eligibility, world position, locomotion, and expressive animation. Use canonical room coordinates and a small server-validated destination message; clients animate deterministic paths around fixed furniture. Keep the existing shared table controller, action dock, cards, and camera controls.

**Tech Stack:** Existing React, Zustand, Three.js, Zod, Fastify/WebSocket, Vitest, and local Chromium browser fixtures. No physics or networking framework is needed.

## Design decisions

- Extend the teal, walnut, brass midnight lounge with a TV wall, drinks counter, seating, and a small dance area. Keep all tall geometry around the perimeter and the overhead board clear.
- Prefer destination navigation over direct physics controls: it works with mouse and touch, leaves orbit gestures intact, and permits collision-aware paths. A client-only avatar would disagree across players; a physics engine would add complexity without improving this room's interactions.
- Taking a break sets the existing sit-out flag and reserves the seat. During an unfinished, unfolded hand, queue departure rather than folding or abandoning the hand. Folded players and unseated members can explore. Returning clears the break; freeing a seat remains available between hands.
- Stand, step around the chair, walk, turn, approach, and sit are explicit locomotion stages. Gestures layer on the current posture. Chairs never inherit emote rotations. Movement can replace a destination without jumping through furniture.
- TV starts with an original bundled ambient film, plus a live table channel and local-video playback. Play/pause, mute, volume, seeking, fullscreen, and error recovery are accessible in a compact panel. Playback/file selection is local to the device and labeled accordingly. No file is uploaded.
- Preserve the stable scene viewport through every new HUD state. Reduced motion uses settled positions and explicit video playback.

## Implementation sequence

1. Add shared walkable geometry, destination validation, deterministic path finding, and seat approach routes in `packages/shared/src/lounge.ts`. Test boundaries, furniture/table clearance, paths between destinations, and every physical seat.
2. Add room-scoped presence messages in `packages/shared/src/wsProtocol.ts`, `apps/server/src/game.ts`, and the client store/message handler. Test membership, active-hand guard, invalid coordinates, rate limits, return, sit-out compatibility, disconnect, and late join.
3. Refine the pelvis/leg proportions in `character.ts` and add leg IK for floor contact. Add a locomotion controller and posture-aware motion composition. Test standing/sitting endpoints and intermediate stages, all seat approaches, interruption, arrival, and gestures in both postures.
4. Wire the controller, floor picking, destinations, break/return controls, spectator actors, and room presence into `Table3DPage.tsx`. Keep the action controller and viewport geometry intact.
5. Extend `scenery.ts` around the shared collision map. Add `LoungeTV.tsx` and TV screen textures, local media lifecycle, an original ambient clip, and accessible responsive controls.
6. Run type checks and focused server/shared/web tests. Build. Use a temporary browser fixture to verify the actual sit/stand/walk/return sequence, interruptions, keyboard/touch controls, media playback and cleanup, poker guards, viewport stability, and overhead card visibility. Inspect desktop and phone screenshots, fix observed defects, and confirm.
7. Save verification evidence and commit locally. Do not push or deploy.

## Acceptance criteria

- Character pelvis touches the cushion; planted feet meet the floor in rest and posture transitions.
- The chair stays fixed while gestures, travel, and return affect the character.
- Paths remain outside the table and furnishings. All nine seats have clear entry/exit routes.
- Active poker turns remain actionable; leaving never silently folds, loses chips, or disconnects the room.
- Other room members see departures, destinations, and returns; disconnected/unseated actors cannot inherit another player's motion.
- TV actually plays video on its 3D screen, exposes working media controls, and releases its resources when leaving 3D.
- Cards remain readable overhead and the viewport does not resize as controls change.
