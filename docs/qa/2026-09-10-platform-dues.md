# Platform dues visibility

The platform account can now find each user's outstanding house commission in
Admin, its own profile, and Settle up. All three use the same report, sorted by
amount outstanding, with search by display name/username/ID, a cleared-user
filter, and commission totals by room. Players see their own platform dues in
their profile stats and Settle up, alongside their separate peer balances.

`apps/server/src/house.ts` owns the calculation. It shares each hand's commission
among its net winners, subtracts each user's recorded house payments, and keeps
overpayment credits separate from other users' debts. Largest-remainder allocation
assigns every odd chip once; matching by both room and hand reference prevents
cross-room attribution. The existing rules excluding voided hands and retired
rooms remain. Commission with no recorded winner appears as unassigned, rather
than being billed to an invented debtor.

This is a read-only reporting change to historical data. There is no migration,
ledger rewrite, chip transfer, rate change, or new payment confirmation workflow.
Payment records retain their existing self-reported meaning, which the UI labels
explicitly. The report endpoint is platform-only; personal profile dues are
returned only to the account owner.

## Verification

- Server/shared/web suites: 349 cases checked. The full concurrent run passed
  348; one existing crypto hand test exceeded its 5-second timeout under load.
  Its isolated rerun passed in 1.86 seconds. Seven new report tests cover access
  restrictions, private users, new/legacy rooms, partial payments, consistent
  personal/admin views, odd-chip splits, reused refs, voids, room retirement,
  overpayments, and missing winners.
- All workspace typechecks and production web/server builds passed.
- Chromium with a disposable in-memory API database and synthetic accounts:
  Admin, platform profile, and Settle up at 1440px and 390px in light/dark themes
  (12 page/theme/viewport combinations). Verified totals, per-user amounts,
  search, cleared-user filtering, room expansion, and no horizontal overflow.
- Personal profile and Settle up at both widths: own amount and navigation work;
  players do not receive the platform report.
- Recorded a partial payment through the real local API and refreshed the admin
  report; tested a failed refresh with retained data, keyboard retry, and an empty
  report. No uncaught browser errors. Desktop/light and mobile/dark screenshots
  were visually inspected.

Local inspection artifacts: `/tmp/4am-house-uat/`. No production payments or
accounts were created or changed for browser QA.
