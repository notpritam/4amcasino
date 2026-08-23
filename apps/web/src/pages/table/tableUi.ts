export function unreadChatCount(
  totalMessages: number,
  seenMessages: number,
  drawerOpen: boolean,
): number {
  if (drawerOpen) return 0;
  return Math.max(0, totalMessages - seenMessages);
}
