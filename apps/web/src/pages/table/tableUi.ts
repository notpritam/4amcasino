export function unreadChatCount(
  totalMessages: number,
  seenMessages: number,
  drawerOpen: boolean,
): number {
  if (drawerOpen) return 0;
  return Math.max(0, totalMessages - seenMessages);
}

export type TableUtilityGroupId = 'people' | 'records' | 'table' | 'preferences';
export type TableUtilityAction =
  'invite' | 'watch' | 'video' | 'standings' | 'ledger' | 'hands' | 'sit-out' | 'timer' | 'theme';

export interface TableUtilityGroup {
  id: TableUtilityGroupId;
  actions: TableUtilityAction[];
}

export function tableUtilityGroups({
  amSpectator,
  isBankerHere,
  isHost,
  hasSeat,
  hasMeetLink,
}: {
  amSpectator: boolean;
  isBankerHere: boolean;
  isHost: boolean;
  hasSeat: boolean;
  hasMeetLink: boolean;
}): TableUtilityGroup[] {
  const people: TableUtilityAction[] = [];
  if (!amSpectator) people.push('invite');
  if (isBankerHere) people.push('watch');
  if (hasMeetLink) people.push('video');

  const table: TableUtilityAction[] = [];
  if (hasSeat) table.push('sit-out');
  if (isHost) table.push('timer');

  return [
    ...(people.length > 0 ? [{ id: 'people' as const, actions: people }] : []),
    { id: 'records', actions: ['standings', 'ledger', 'hands'] },
    ...(table.length > 0 ? [{ id: 'table' as const, actions: table }] : []),
    { id: 'preferences', actions: ['theme'] },
  ];
}
