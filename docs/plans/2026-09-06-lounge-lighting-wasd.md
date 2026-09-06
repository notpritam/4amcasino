# Lounge atmosphere and direct movement

- Keep the full viewport glass HUD and existing poker, camera, TV, and destination controls.
- Enrich the perimeter with a deeper city skyline, illuminated bar shelving, walnut wall details, upholstered seating, and warm practical lighting. Keep the roof and playing area open.
- Add camera-relative WASD/arrow-key steering after taking a break. Focus the world to steer; UI focus, dialogs, blur, visibility loss, and poker decisions stop input.
- Reuse chair exit/return stages, use collision-aware local movement, and publish coalesced positions at most four times a second. Reconcile server corrections and keep quick destinations available.
- Verify navigation math, chair transitions, release/blur/input behavior, network pacing, mobile controls, viewport stability, and visual views. Build and typecheck before a local commit.
