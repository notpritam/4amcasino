import { describe, expect, it } from 'vitest';
import { tableUtilityGroups, unreadChatCount } from '../src/pages/table/tableUi.ts';

describe('table chat drawer', () => {
  it('counts only messages received while the drawer is closed', () => {
    expect(unreadChatCount(7, 4, false)).toBe(3);
    expect(unreadChatCount(7, 4, true)).toBe(0);
    expect(unreadChatCount(3, 4, false)).toBe(0);
  });
});

describe('table utility menu', () => {
  it('groups the actions available to a seated host and banker', () => {
    expect(
      tableUtilityGroups({
        amSpectator: false,
        isBankerHere: true,
        isHost: true,
        hasSeat: true,
        hasMeetLink: true,
      }),
    ).toEqual([
      { id: 'people', actions: ['invite', 'watch', 'video'] },
      { id: 'records', actions: ['standings', 'ledger', 'hands'] },
      { id: 'table', actions: ['sit-out', 'timer'] },
      { id: 'preferences', actions: ['theme'] },
    ]);
  });

  it('omits actions that a spectator cannot use', () => {
    expect(
      tableUtilityGroups({
        amSpectator: true,
        isBankerHere: false,
        isHost: false,
        hasSeat: false,
        hasMeetLink: false,
      }),
    ).toEqual([
      { id: 'records', actions: ['standings', 'ledger', 'hands'] },
      { id: 'preferences', actions: ['theme'] },
    ]);
  });
});
