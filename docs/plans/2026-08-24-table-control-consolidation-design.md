# Table control consolidation design

## Goal

Reduce the desktop table header to four predictable control groups without removing functionality or competing with the betting controls.

## Core hierarchy

The table header keeps only the room identity, live hand timer, and four controls:

1. **Chips** — a labeled, stateful hub for buying points, sending chips, and reviewing bank requests.
2. **Voice** — a compact icon whose visual state communicates disconnected, live, or muted.
3. **Chat** — a compact icon with its existing unread badge and drawer behavior.
4. **More** — a single grouped menu for table utilities, records, and preferences.

Betting and deal actions remain in the gameplay area. They never move into the header or an overflow menu.

## Chips hub

Replace the three adjacent bank buttons with one labeled **Chips** trigger. The trigger carries the bank-request badge when approvals are waiting. Opening it reveals three clearly labeled actions:

- Buy points
- Send chips
- Bank inbox, shown only to bankers and carrying the request count

The existing dialogs and bank behavior remain unchanged. This is information-architecture consolidation, not a workflow rewrite.

## More menu

The overflow menu uses short section labels and groups related actions:

- **People:** Invite friends, create a watch-only link, open the room video call.
- **Records:** Standings, ledger, hand history.
- **Table:** Sit out or deal back in, turn timer for hosts.
- **Preferences:** Light or dark appearance.

Unavailable or unauthorized actions are omitted. Selecting an action closes the menu before opening a dialog or navigating.

## Interaction and accessibility

- Each icon control keeps an accessible name and visible tooltip.
- Menus close on outside click and Escape.
- Menu triggers expose `aria-expanded` and `aria-haspopup`.
- Focus moves into an opened menu and returns to its trigger on close.
- Bank-request and chat badges remain available without opening their menus.
- Voice state uses icon, label, color, and tooltip rather than color alone.
- Mobile behavior remains functionally complete; this pass focuses on the desktop command hierarchy.

## Success criteria

- No more than four control groups appear to the right of the desktop room header.
- Every existing desktop table action remains reachable.
- Money-moving actions remain explicitly labeled inside the Chips hub.
- Gameplay actions remain immediately visible and unaffected.
- Typechecks, tests, production build, and Impeccable detectors remain clean.
