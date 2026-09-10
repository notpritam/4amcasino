# Canonical domain migration

The main site is https://4amcasino.com. Render already redirects `www` to
the root domain. The existing service also handles the old hostname:

- HTTP requests to `poker.notpritam.in` return 308 to the same path and query
  on `https://4amcasino.com`, before route handlers execute.
- The redirect matches the real Host header, ignoring X-Forwarded-Host.
  Its fixed destination cannot be replaced by a protocol-relative path;
  server-wide OPTIONS requests go to the new root.
- New-domain API and WebSocket origins are allowed without environment
  overrides. Render health checks, local development and unrelated hosts
  do not redirect.
- The MCP default, current documentation and replay share text use the new
  domain. An existing MCP configuration with an explicit FOURAM_URL should
  be updated to the new domain; cross-origin redirects may drop auth headers.
- Accounts remain in the same database. Browser sessions are origin-scoped,
  so players may need to sign in again on the new domain.

## Local verification

- Initial domain regression run: 12 expected failures, 8 passes before the
  implementation. Domain suite then passed all 20 tests.
- Full workspace suite: 395 tests passed in 36 files, with worker concurrency
  limited to two to avoid CPU contention in real-crypto integration tests.
- A final raw HTTP OPTIONS regression exposed an invalid destination for
  non-path request targets. After the guard, all 21 domain tests and all
  4 auth tests passed.
- All workspace typechecks and the production web/server build passed.
  Server typecheck/build were repeated after the final redirect guard.
  Vite reports the existing large-chunk advisory.

## Production acceptance

After the exact commit reaches a successful Render deployment, verify:

1. Old-domain root, room invite, fair page and health URLs return 308 with
   the exact expected Location, including encoded query values.
2. Following redirects reaches the new domain without a loop; `www` still
   redirects to the root domain.
3. The new domain's health endpoint reports `ok: true` and `storage: disk`.
4. Deployed entry assets and the updated replay chunk match the tested build.
5. A fresh browser follows an old fair-page URL, preserving query and fragment,
   renders the page and can navigate to sign-in on the new domain.

Retain the old DNS/custom-domain mapping for HTTPS redirects. No database or
Cloudflare DNS changes are required for this server-side redirect.
