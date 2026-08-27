/** Share links that survive the login round trip (requested by notpritam,
 *  docs/FEATURES.md).
 *
 *  You send a friend `poker.notpritam.in/j/ABC123`. If they are logged out we
 *  park the code here, walk them through login or registration, and drop them
 *  straight into the table on the other side. sessionStorage rather than a
 *  route param so a reload, a tab restore, or a bounce through /login?expired=1
 *  cannot lose it - and so it never outlives the tab. */

const KEY = '4am-pending-join';

export function setPendingJoin(code: string): void {
  try {
    sessionStorage.setItem(KEY, code.toUpperCase());
  } catch {
    /* private mode with storage disabled: the link just needs a second click */
  }
}

export function peekPendingJoin(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Reads and clears in one go - a pending join is consumed exactly once. */
export function takePendingJoin(): string | null {
  const code = peekPendingJoin();
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return code;
}

/** The link you actually paste to someone. */
export function shareLinkFor(joinCode: string): string {
  return `${window.location.origin}/j/${joinCode.toUpperCase()}`;
}

/** Ready-made message for WhatsApp / iMessage / wherever the group lives. */
export function shareMessageFor(roomName: string, joinCode: string): string {
  return `Join my poker table "${roomName}" on 4AM Casino.\nCode: ${joinCode}\n${shareLinkFor(joinCode)}`;
}
