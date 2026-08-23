# Centered table UX redesign

## Problem

The desktop table gives permanent width to an opponent column and an often-empty chat column. The community board is therefore visually off-center and too small for the primary task. The header also presents low-frequency utilities as a long row of equally weighted text buttons, so game controls, money actions, and navigation compete with one another.

## Chosen direction

Use a centered game-theater layout. The board owns the page center and the largest surface. Opponents form a responsive rail above the felt, the local player stays directly below it, and betting controls remain the final step in the vertical task path. Chat becomes a right-side drawer opened from the command bar, so it is available without permanently shrinking the game.

## Command hierarchy

The top bar has three groups:

1. Table identity: back, table name, join code, blinds, and timer.
2. Safe secondary actions: invite, watch link, standings, theme, chat, and overflow utilities. These use Phosphor icons with tooltips and accessible names.
3. Stateful or consequential actions: voice, buy points, send chips, and bank approvals. These retain short text labels because icon-only money movement and microphone state are too easy to misread.

Ledger and hand history use receipt and cards icons in the secondary group. Sit-out moves into a labeled overflow/menu action because it changes future dealing state and should not masquerade as a harmless icon.

## Table structure

- Desktop canvas grows from the current 1280px ceiling to a fluid 1536px ceiling while retaining safe gutters.
- Opponents render in an adaptive grid above the board instead of a fixed left rail.
- The board surface fills the available center width with a minimum desktop height around 520px and larger community cards at wide viewports.
- Empty state copy sits inside the felt with one clear instruction. It does not create a second visual center.
- The local player row and action bar match the board width and remain close enough to read as one interaction zone.
- Chat opens as a fixed right drawer with an overlay, close control, Escape support, and a badge when messages exist while closed.

## Responsive behavior

The existing mobile table remains intact. On medium desktop widths the command bar wraps into two logical rows and opponent cards use two or three columns. At wide widths opponents spread across the top rail while the board stays centered. The drawer uses the smaller of 400px or the available viewport width.

## Accessibility and validation

Every icon-only control has an `aria-label`, title, visible focus ring, and at least a 40px target. Drawer focus starts on close, the overlay closes it, and Escape works. Financial and state-changing controls stay labeled. Verify TypeScript, all tests, production build, Impeccable layout detection, desktop and mobile overflow, and the empty and active-hand states.
