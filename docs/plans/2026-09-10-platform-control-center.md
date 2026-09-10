# Platform Control Center Implementation Plan

**Goal:** Set the house cut to 0.5%, let the platform account change it at runtime,
and provide a dedicated admin dashboard at admin.4amcasino.com.

**Architecture:** Keep the existing Render service and database. Persist the default
rate and an audit history in SQLite, explicitly snapshot the default when creating
a room, and preserve each hand's starting rate. The admin host serves a separate
authenticated application shell using the existing platform-only API guards.

**Tech Stack:** Fastify, SQLite, React Router, Zeus UI, Vitest and browser UAT.

## Rate controls and accounting

1. Add failing tests for the 50-basis-point default, platform authorization,
   bounded integer inputs, optimistic revision checks, persistence and scope.
2. Add settings/history storage and a one-time initial migration to 0.5% for
   all rooms. Record historical hand rates before updating any room rates.
3. Expose the current default to players and guarded settings GET/PUT to the
   platform account. A save chooses all rooms or new rooms only, records its
   actor and affected count, and broadcasts changed room settings.
4. Read the persisted default for every room creation. Each running hand keeps
   its starting rate, including its disclosure; future hands pick up changes.
5. Keep settlement and dues history accurate when a room has multiple rates.
   Floor each pot independently and preserve existing ledger hashes.

## Qualification requirements

Cap room creation and settings at 30 qualifying hands, with zero meaning no requirement.
Migrate existing requirements above 30 down to 30. Verify API validation, migration,
and the room controls used by both 2D and 3D modes.

## Dedicated admin interface

1. Add a standalone responsive Zeus admin shell with Overview, Revenue, Rooms,
   Users, Requests, and Settings destinations. Reuse existing management actions.
2. Add real aggregate overview data, recent revenue, user search and room rates.
3. Add an inline rate editor with scope, whole-chip example, save/error states,
   stale-version protection and an audit log.
4. Route the admin subdomain to the admin shell and its own sign-in experience;
   retain /admin/* on the main site as an accessible fallback. Verify the role
   with the server and show a clear access-denied state for regular players.
5. Replace hardcoded player rate copy with the live setting and disclose the
   rate of each room/hand. Extend the existing Zeus light/dark design system.

## Verification and release

1. Run relevant accounting, migration, auth, real-hand and UI tests; all workspace
   typechecks and the production build.
2. Use an isolated synthetic database for desktop/mobile, light/dark browser UAT:
   settings changes without restart, scope, history, invalid inputs, denied access,
   searches, navigation, refreshed player copy and failure recovery.
3. Review the captured admin surface and document the new surface boundary.
4. Merge and deploy; verify the exact release, live assets, health, rate endpoint,
   protected admin endpoints, canonical redirect and custom-domain routing.

## Domain dependency

Cloudflare: CNAME admin -> fouramcasino.onrender.com, DNS only for verification.
Render: add admin.4amcasino.com to the existing service's Custom Domains.
The subdomain was unresolved when work began. Browser control could not complete
Render sign-in, so the user has received the DNS and Render setup steps.
