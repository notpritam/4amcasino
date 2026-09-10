# Custom poker shortcuts — local QA

Feature branch: `feat/custom-poker-shortcuts`. No push, merge, or deployment.

## Delivered behavior

Settings → Keyboard shortcuts and the table's Shortcuts button open the same editor.
Keys are saved on the signed-in account, with a global switch, individual clearing,
a key recorder, a select control for touch users, conflict validation, and restore defaults.
Defaults: Fold F, Check X, Call C, Bet/Raise R, half-pot 2, pot 3, all-in I.
Letters and digits may include Shift; WASD and browser/navigation keys are reserved.

Fold, Check and Call send only their specific legal action on the viewer's turn.
Sizing shortcuts select and focus an amount; Enter confirms the displayed whole-chip
amount and Escape exits the field. Existing mouse sizing buttons keep their behavior.
Desktop ActionBar, phone MobileActions and the 3D overlay share the keyboard hook.

Typing, composition, repeated keys, menus/dialogs, disconnected clients, hidden tabs,
out-of-turn state, changing actions and pending sends suppress shortcuts. A synchronous
latch spans responsive controls and permits retry after six seconds even if a control
unmounts. Per-account readiness and stale-response guards keep another login's cached
keys inactive. Focus/cross-tab refresh updates keys without resetting unsaved appearance.

## Automated and interactive checks

- Account API: defaults, signed-in-account isolation, SQLite restart persistence,
  disabled and cleared bindings, reserved/malformed keys, conflicts, private-only
  exposure, authentication, unrelated profile edits, and damaged stored preferences.
- Shared intent and state: legal check/call distinction, no queued pre-actions,
  min/max sizing, raise rights, Shift/digit normalization, duplicate/retry behavior,
  delayed profile responses, account switching, and unsaved appearance preservation.
- Browser regression `apps/web/test/browser/poker-hotkeys.mjs`: 2D and 3D actions;
  R/2/3/I prepare then Enter sends exact amounts; empty, fractional and out-of-range
  amounts rejected; stale amount confirmation, pending/repeated/composing/browser keys,
  typing, menu/dialog blocking, disabled/unloaded/disconnected/hidden states,
  recorder + Shift+3 rebinding, and responsive controls/editor at 1440, 390 and 320px.
- Real isolated Fastify/WebSocket fixture with two synthetic accounts: one in 2D,
  one in 3D. A signed raise, calls and checks completed every street through showdown;
  a second hand settled with a keyboard fold. Persisted transcript and ledger verified.
- Real profile editor: duplicate/reserved errors, recording, clear, save + reload,
  disable + reload, restore defaults, simulated 503 preserving the draft, and another
  account retaining defaults. Light/dark reviewed at 1440, 390 and 320px.
- Same-account tabs: saving Q in one tab updated the other tab; restoring F propagated
  too, without overwriting an unsaved Crimson deck selection.

Settings screenshots and local multiplayer evidence: `/tmp/4am-hotkeys-uat/`.
Synthetic browser regression screenshots: `/tmp/4am-hotkeys-regression/`.
No production accounts or production hands were used.

## Reproduce the browser regression

Start the Vite dev server on port 5181. The regression mocks its own HTTP and WebSocket
transport and requires no running API or real account. Restart Vite after source edits
before running: the browser fixture imports store modules directly, so stale HMR module
URLs can otherwise create a second store instance in the test.

```sh
BASE_URL=http://127.0.0.1:5181 \
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
BROWSER_EXECUTABLE=/path/to/chromium \
node apps/web/test/browser/poker-hotkeys.mjs
```

The test uses Metal on macOS. Software WebGL can spend tens of seconds compiling the
existing 3D scene before controls become interactive; the test allows for this startup.
For real multiplayer reruns, use fresh fixture state and retain each browser's hand keys
until its hand ends. A new empty browser cannot resume a previous synthetic hand's keys.

## Final verification

- Workspace typechecks passed.
- Production web and server builds passed. Existing bundle-size warnings remain.
- The first unbounded-parallel suite run timed out in two existing crypto integration
  tests at their five-second limits. The complete suite is checked with two workers;
  no test timeout or application behavior was relaxed.
- Final run: `npx vitest run --maxWorkers=2 --minWorkers=1` — **451 tests passed,
  40 files**, including both integration tests that previously timed out.
- The initial-profile/shortcut-refresh race has a separate regression: a newer key
  refresh keeps its bindings while the initial full profile still finishes loading.
