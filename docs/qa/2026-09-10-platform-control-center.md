# Platform controls and qualification cap

Implementation branch: `feat/platform-control-center`.

## Behavior

- Initial house cut is 0.5% for all rooms. Later edits persist in SQLite and existing MongoDB database snapshots; restarts do not reset the selected rate.
- Platform-only settings choose all rooms or new rooms only. Revisions prevent overwriting a newer save; history records rate, scope, affected count and actor.
- Running hands retain their original commission and result disclosure. Later hands use the updated room setting. Past dues retain the rate actually charged; the original hash-chained ledger is unchanged.
- Dedicated admin host routing and sign-in, plus `/admin/*` fallback. Regular player accounts cannot load protected data or controls.
- Room qualification is limited to 0–30 hands. Existing values above 30 migrate to 30; zero remains no requirement.

## Automated verification

- `npm test -- --maxWorkers=2 --minWorkers=1`: **420 tests passed across 37 files**.
- Real encrypted-hand integration includes a rate change during a hand followed by a second deal, chip conservation, platform credit, side-pot rounding, and recorded transcript rates.
- Settings tests cover authorization, input boundaries, zero rates, scope, stale revisions, new-room rate acknowledgement, restart persistence, historical dues, and qualification migration/validation.
- All workspace typechecks and production web/server builds passed. Existing large-bundle warning remains for the main app and 3D scene.

## Browser UAT

Isolated in-memory database with 53 synthetic accounts; no production account, payment or rate was used for testing. Playwright Chromium checked Overview, Settings, Revenue, Users, Rooms and Requests at **1440px and 390px, light and dark**. All 24 route/theme/viewport combinations render without page overflow. Final captures are in the local `.impeccable/review/` directory; selected evidence is committed below.

Verified real API-backed interaction:

- User pagination, name search, no-match state and account control selection.
- 0.75% for new rooms only; existing rooms retain 0.5%.
- 1% for all rooms; running-hand behavior separately verified by integration tests.
- Historical user dues remain unchanged after rate changes.
- Invalid precision and >100% input disabled; 0% accepted; restore to 0.5%.
- Conflicting save rejected, editing disabled until authoritative reload.
- Main lobby disclosure fetches current rate and qualification input is capped at 30.
- Ordinary player access denied; admin-only controls absent.
- Real password sign-in on the admin hostname preserves `/settings`, then overview routes to `/`.
- Initial settings-load error, failed-write lockout, authoritative reload, and admin sign-out recovery.
- No uncaught browser errors in the complete interaction run.

Admin hostname UAT used a local routing interception because public admin DNS is not yet configured. This proves application behavior, not public DNS or Render certificate issuance.

## Visual review

Independent review and documentation agents could not start because their configured model was unavailable. The documented local fallback review found low-contrast custom dark-mode secondary text, now fixed with Zeus semantic text colors. The listed fix received a local **ship** verdict, not an independent approval. [Review record](2026-09-10-admin-review.md).

Measured secondary text contrast: **4.73:1 light, 9.04:1 dark**. Selected scope explanations: **6.26:1 light, 10.35:1 dark**. Final captures confirm the rate field no longer overlaps and the user table stays within its scroll container.

- [Overview, desktop light](admin-control-center/overview-1440-light.png)
- [Overview, desktop dark](admin-control-center/overview-1440-dark.png)
- [Settings, desktop dark](admin-control-center/settings-1440-dark.png)
- [Settings, mobile light](admin-control-center/settings-390-light.png)
- [Settings, mobile dark](admin-control-center/settings-390-dark.png)

## Release checks

Release verification is recorded in the thread after Render reaches terminal success. Required public checks: deployment SHA, health, live rate 0.5%, unauthenticated admin denial, matching JS/CSS assets, main `/admin` sign-in, and old-domain redirect. The admin subdomain additionally requires Cloudflare CNAME and Render Custom Domain registration as documented in README.
