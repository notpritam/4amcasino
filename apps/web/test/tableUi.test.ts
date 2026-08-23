import { describe, expect, it } from 'vitest';
import { unreadChatCount } from '../src/pages/table/tableUi.ts';

describe('table chat drawer', () => {
  it('counts only messages received while the drawer is closed', () => {
    expect(unreadChatCount(7, 4, false)).toBe(3);
    expect(unreadChatCount(7, 4, true)).toBe(0);
    expect(unreadChatCount(3, 4, false)).toBe(0);
  });
});
