# Social lounge: movement, seating, TV, and controls

Local work on `feat/3d-seating-motion`. No push or deployment.

## What changed

- Supported pelvis and leg IK, with grounded sitting/standing poses. Getting up, stepping around the fixed chair, walking through the aisle, turning, and returning are separate stages. Reactions layer over movement; chairs do not swivel with gestures.
- Click/tap navigation to clear floor, TV, drinks counter, sofa corners, dance area, and city view. The destination ring shows the requested location. Dragging remains camera orbiting. Invalid floor destinations give feedback.
- Taking a break reserves the seat and chips. An unfinished, unfolded hand queues departure; folding or ending the hand permits it. Returning cancels the break. Unseated members can react, move, and choose an empty chair; a seat can be freed between hands.
- Room-scoped, server-validated presence updates, endpoint spacing, and deterministic paths around the furniture. Room snapshots retain current presence, including through a local avatar edit. Presence-only updates do not rebuild the character rigs.
- A TV wall and real video texture, an original silent ambient film, a public table channel, and local-video playback. Play/pause, mute, volume, seeking, fullscreen, source replacement, error recovery, and visibility/unmount cleanup work. Playback is explicitly local to each device.
- Cards and chips have separate positions on the felt, independent of chair spacing. Personal chips use a compact stack; the pot stays clear of both runouts and private cards. All nine viewing seats were checked with four chip denominations.
- The scene viewport remains fixed across turns and panels. Phone betting actions precede the card rail, and the action dock scrolls to its top on a new turn. Full shared table controls, cards, dialogs, and the large-card viewer remain available.
- Late socket close callbacks no longer query SQLite after server shutdown. Normal disconnect and reconnect hand behavior remains covered by the integration suite.

## Verification

- Full repository suite: **330 tests passed in 28 files**, without uncaught shutdown exceptions. This includes real WebSocket/crypto hand integration, sit-out, reconnect, run-it-twice, ledger, and settlement regressions.
- After the last view-only layout refinements: **125 web tests passed in 6 files**, web type checking passed, and the web production build plus server bundle passed. All workspace type checks also passed during the implementation. The existing lazy Three.js chunk-size advisory remains.
- Navigation tests cover all destination pairs, furniture/bounds rejection, all nine chair exits, and spacing for nine arrivals. Pose tests sample every seat's departure and return at 60 ms intervals, checking floor contact, table clearance, continuity, rerouting, seat changes, reduced motion, and a wave layered over walking.
- Server lounge tests cover membership, sit-out requirements, active-hand rejection, snapshots/broadcasts, throttling, disconnect, return, and re-seating. Store regressions cover room scoping, snapshots, and preserving presence through profile updates.
- Actual Chromium/WebGL renders checked seated support, getting up, walking, standing waves, TV-facing arrival, return to the cushion, and unchanged viewport bounds. The video surface was verified as a playing `VideoTexture`; the table channel uses its public-data canvas texture.
- **2,268 camera rays** checked centers and near-corners of both boards, private cards, and opponent cards across all nine viewing seats with crowded, four-denomination chip stacks. No intervening geometry blocked a card. The ray check ignores geometry below the card surface to avoid floating-point misses at a plane's triangle boundary.
- Browser controls checked queued departure during a live hand, departure after folding, cancellation/return, no automatic poker action, and preserved chip/hand state. Unseated reactions and choosing a seat remain available.
- Actual floor hits move the character without resetting the camera; pointer drags orbit without sending a move. Freeing a seat preserves the lounge actor, and clicking an empty chair seats that actor.
- Media checks exercised playback, pause, mute, volume, seeking, fullscreen, a valid local file, an invalid file, and restoring the film. Source replacement disposes the old texture. Visibility and channel pauses coordinate correctly. Switching to 2D pauses/unloads the video and disposes the texture.
- Desktop (1440×1000), phone (390×844), and compact-phone control bounds (375×667) were checked. Phone actions are fully visible, a new turn restores the dock to the top, the TV panel fits, and there is no page-wide horizontal overflow or browser page error.
- `npx impeccable detect apps/web/src` ran once during the pass and returned clean. Final captures were visually reviewed after the card/chip and phone-action fixes.

Browser fixtures use synthetic players, test identities, and intercepted API/WebSocket calls. They were removed from the app after verification. Server tests separately exercise actual room logic and live poker transport. These results do not claim physical-device frame rates, a live multi-device social session, synchronized TV playback, or live voice transport.

## Screenshots

- [Lounge and scenery](./social-lounge/lounge-desktop.webp)
- [Supported sitting pose](./social-lounge/seated-side.webp)
- [Getting up](./social-lounge/getting-up.webp)
- [Standing wave](./social-lounge/standing-wave.webp)
- [Walking through the lounge](./social-lounge/walking.webp)
- [Watching the TV](./social-lounge/watching-tv.webp)
- [TV controls and table channel](./social-lounge/tv-controls.webp)
- [Crowded overhead table](./social-lounge/overhead.webp)
- [Phone actions and cards](./social-lounge/phone-table.webp)
- [Phone video controls](./social-lounge/phone-tv.webp)

The motion captures preceded the final card/chip placement refinements; the overhead and phone captures show the final arrangement. All imagery is a synthetic local QA scene, not a real table or financial record.

## Design finish review

The configured review-agent model was unavailable, so the Impeccable finish review ran inline. This was an extension of the existing design, with no new approved-comp or concept-selection requirement.

Initial disposition: **fix**.

- **Persistence:** PRODUCT.md and DESIGN.md existed. The lounge section of DESIGN.md now describes actual movement, TV, fixed viewport, and phone control behavior; unrelated design guidance is preserved.
- **Fidelity:** Type matches the existing Onest/Bricolage system. Materials match the teal felt, walnut, brass, and dimensional character world. The dark room and open overhead space remain intact. New social/TV controls follow the user's requested extension.
- **Ceiling:** Real articulated geometry, clear movement stages, interactive scenery, and a real video surface carry the design. Existing avatar customization remains intact.
- **Material fixes:** Separate card/chip placement from chair spacing; check all nine viewing seats; recapture the TV with a monotonic test clock; put phone betting actions above long card/reveal content; reconcile lounge snapshots through avatar edits.
- **Keep:** Fixed viewport, shared poker controls, grounded movement, open overhead card area, and explicit device-local media behavior.

Confirmation: card/chip occlusion resolved by the final 2,268-ray check and overhead capture; TV capture displays the actual film; phone capture shows the action buttons and raise control fully; store regression tests retain the current destination. No regression found in the scored fixes.

Final disposition: **ship** for the reviewed local changes. This is a review verdict, not deployment authorization.

## Media provenance and implementation references

`apps/web/public/media/lounge-after-hours.mp4` and its WebP poster are original procedural artwork produced by `scripts/render-lounge-film.py` (Pillow + ffmpeg): 16 seconds, 960×540, 24 fps, H.264, silent. No third-party footage, images, or audio are included. Local video files selected in the UI are not uploaded.

Video texture lifecycle and playback handling follow the official [Three.js VideoTexture documentation](https://threejs.org/docs/pages/VideoTexture.html) and [MDN autoplay guidance](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay). Picking uses the official [Three.js Raycaster API](https://threejs.org/docs/pages/Raycaster.html).
