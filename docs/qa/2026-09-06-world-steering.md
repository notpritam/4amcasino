# Lounge atmosphere and keyboard steering

## Delivered

- Layered city buildings with instanced lit windows, walnut window portal, brass
  wall lights, upholstered alcoves, cushioned sofas, and illuminated bar shelves.
- Warm lights around seating and the bar, cool city fill, and a warm table key.
  The center remains open, and the existing full-viewport glass HUD stays in place.
- Camera-relative WASD and arrow-key walking after taking a break. Getting up
  closes the lounge widget and focuses the world. Quick destinations and
  click-to-walk remain available; a keyboard button restores world focus.
- Direct steering waits for the chair aisle, normalizes diagonals, slides along
  furniture, and avoids other characters. Release stops; UI focus, prompts,
  blur, visibility changes, and disconnects clear held keys.
- Local steering follows distance-based gait. Coalesced shared positions send at
  most four times a second, including the final stop. Self echoes do not rewind
  the rig, server corrections hand control back to the planner, and return-to-seat
  uses the existing chair approach and sitting animation.

## Verification

Unit coverage includes camera direction and diagonal speed, table/furniture/room
collisions, character spacing, large frame deltas, all nine chair exits, stopping,
returning, reduced-motion steering, authoritative reconciliation, update pacing,
final delivery, and queue cleanup.

Chromium WebGL checks used a local six-player store/WebSocket fixture:

- Seated keyboard input cannot abandon a hand or chair.
- Getting up enables steering immediately. Keyboard movement, key release, camera
  rotation, widget focus, and window blur behave correctly.
- Simulated 100ms server echoes do not rewind the local position. The final stop
  reaches shared state; outgoing position timestamps remain at least 250ms apart
  (245ms tolerance in the browser assertion).
- Ready checks, document visibility changes, and disconnects stop held input.
- Typing into the actual table chat input does not move the character.
- Server-selected positions, quick destinations, and returning to the chair work
  after steering. Leaving 3D removes movement listeners and queued sends.
- All 135 sampled card sightlines in the six-player flop fixture are clear in
  overhead view. Desktop and 390×844 phone captures retain the full-screen canvas,
  readable actions, and reachable quick destinations.
- Hidden TV controls no longer count as an open panel for input blocking.
- No browser page errors. Impeccable detector: no findings. `git diff --check`: clean.

The first full test run passed 336/338 tests; two existing poker integration tests
hit their 5-second time limit while other test files and software WebGL QA ran in
parallel. The rerun with one test file at a time passed all 338 tests across
29 files (105.99s), including both tests that initially timed out.

Final commands:

- `npm test -- --maxWorkers=2 --minWorkers=1 --no-file-parallelism`: 338 passed.
- `npm run typecheck`: passed across all workspaces; the final web changes were
  also checked with `npm run typecheck --workspace @4am/web`.
- `npm run build --workspace @4am/web`: passed (web and bundled server). The
  existing Three.js chunk-size advisory remains.
- Final Chromium input-safety run: passed with no page errors.

Physical phone GPU performance, Safari, and a real multi-user network session were
not exercised. Network timing and shared presence behavior above used the fixture;
server lounge authorization and rate-limit behavior have separate existing tests.

## Visual evidence

- [Lounge](world-steering/world.webp)
- [Table](world-steering/table.webp)
- [Overhead](world-steering/overhead.webp)
- [Phone poker actions](world-steering/phone.webp)
- [Phone quick destinations](world-steering/phone-quick.webp)
