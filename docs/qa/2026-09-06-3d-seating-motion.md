# 3D seating, motion, and overhead clarity

Local follow-up on `feat/3d-seating-motion`, based on the local control-parity work. No push or deployment.

## Changes

- Rebuilt the astronaut with hip, knee, elbow, and ankle joints. The cushion supports the hips, thighs point forward, and boots meet the rug. Gestures lean from the pelvis instead of tipping the entire character around the floor.
- Occupied seats keep their physical positions when players join or leave. Appearance/fold changes preserve the displayed pose, and a different occupant cannot inherit the previous occupant's animation.
- Each seat has one active animation, with a short blend on interruption. All 27 reactions have eased entry/recovery and a local animation clock. Spins finish in the original orientation; the seated shuffle keeps soles level. Targeted gestures use a shared wind-up, flight/contact, recoil, and recovery timeline. Bust effects return to the chair.
- Replaced the neon casino and chandelier with a teal-and-walnut lounge, brass city windows, perimeter lamps, plants, and seating. There is no ceiling or hanging geometry above the playing surface. Close-view name tags have a size limit; overhead hides floating name/pot labels and the turn arrow.
- Both runouts have separate rows with equal-size cards. Opponents' cards and private cards sit at their own places on the felt, clear of chip stacks. Opponent faces still use only public reveals.
- Dealt cards have a real back face, maintain edge clearance above the felt, and retain their progress through unrelated room updates.
- Player/seat/name clicks open interactions; cards and the table block picking players behind them. Drags, secondary pointers, and canceled pointers do not open the interaction menu. Reduced motion gives static feedback and renders the resting scene on demand.

## Verification

The implementation was iterated against failing regressions and rendered pose sheets. Checks caught and corrected abrupt reaction endpoints, a rotation-blending aliasing error, spin orientation loss, a chair swivel flipping after Euler-angle conversion, a foot dipping below the floor, four gestures putting hands inside the torso, and the fold/rebuild standing-pose reset.

- `npm run typecheck`: all workspaces.
- `npx vitest run apps/web/test`: 106 tests, including 98 seating/motion/layout regressions. These cover seated stages across all nine seats, animation endpoints and midpoints, hand/torso clearance, planted soles, reaction interruption, attack timing, chip trajectory, stable layout, scenery clearance, and both edges of flipping cards.
- `npm run build --workspace @4am/web`: web build and server bundle. The existing lazy Three chunk size advisory remains.
- `npx impeccable detect apps/web/src`: clean.
- Actual Three/WebGL browser checks at Table, Overhead, Side, and Close camera positions; 252 camera rays across the centers and corners of both boards, private cards, and all opponent cards were unobstructed from overhead.
- Chair orientation was checked against the character through every emote stage and verified during wave/spin in the live scene. Projectiles canceled when an occupant changed; switching to reduced motion restored the seated pose; legacy poke sound ownership and unknown-emote guards passed.
- Actual displayed poses survived a reaction replacement and a player leaving. Character clicks, targeted UI sends, orbit drags, card clicks, and reduced-motion static feedback passed.
- Fold and appearance rebuilds preserved the displayed pose; the rocket reached its peak and returned to its chair; a room update at mid-flip preserved card height and angle. The character preview fit a 375×667 phone screen; scene and preview canvases were removed after switching to 2D, with no page errors.
- The shared control-parity fixture was rerun: betting/signatures, run-twice, public shows and private peeks, ready/start, sit-out, invites/admission, records, voice state, banking, seat/broke/spectator flows, disconnect guards, and switching back to 2D passed.

Browser work used temporary local fixtures with intercepted API/WebSocket calls and test identities. It did not alter real accounts or tables. Rendered motion checks use Chromium's software WebGL renderer; these results do not claim physical-device FPS or real multiplayer/voice transport coverage. Fixtures are removed from the app after verification.

## Scene and transition screenshots

- [Overhead: both boards and every seat's cards](./3d-motion/overhead.webp)
- [Nine-player lounge](./3d-motion/table.webp)
- [Side view](./3d-motion/side.webp)
- [Close view and seating](./3d-motion/close.webp)
- [Phone layout](./3d-motion/mobile.webp)
- [Wave in the live scene](./3d-motion/wave.webp)
- [Interrupted reaction into dance](./3d-motion/dance.webp)
- [Targeted contact](./3d-motion/chip-contact.webp)
- [Fold transition](./3d-motion/fold.webp)
- [Rocket peak](./3d-motion/rocket.webp)
- [Card deal](./3d-motion/deal.webp)
- [Phone character preview](./3d-motion/preview.webp)

## Pose sheets

Every row is sampled at 0%, 15%, 35%, 60%, 85%, and 100%. These are the actual character geometry and motion programs, rendered against the chair.

| Sheet | Reactions |
| --- | --- |
| [01](./3d-motion/stages-0.webp) | Wave, clap, facepalm |
| [02](./3d-motion/stages-1.webp) | Dance, disco, robot |
| [03](./3d-motion/stages-2.webp) | Twirl, jump, flex |
| [04](./3d-motion/stages-3.webp) | Bow, rage, laugh |
| [05](./3d-motion/stages-4.webp) | Cry, shrug, heart |
| [06](./3d-motion/stages-5.webp) | Thumbs up, headbang, moonwalk |
| [07](./3d-motion/stages-6.webp) | Spin, wiggle, salute |
| [08](./3d-motion/stages-7.webp) | Guitar, dab, chicken |
| [09](./3d-motion/stages-8.webp) | Pray, levitate, celebrate |
| [10](./3d-motion/stages-9.webp) | Shove, slap, chip recoil |
| [11](./3d-motion/stages-10.webp) | Fold, rocket, boom |
| [12](./3d-motion/stages-11.webp) | Throw, legacy poke, sparks |
