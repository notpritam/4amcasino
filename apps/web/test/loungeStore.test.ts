import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMsg } from '@4am/shared';

vi.stubGlobal('window', {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
});
const { useStore } = await import('../src/shared/store.ts');
type Room = Extract<ServerMsg, { t: 'room_state' }>;
const room: Room = {
  t: 'room_state',
  room: {
    id: 'lounge',
    name: 'Lounge',
    joinCode: 'LOCAL',
    hostId: 1,
    bankerId: 1,
    sb: 10,
    bb: 20,
    auditMode: 'standard',
    actionTimeoutMs: 30000,
    actionSecs: 30,
    coBankerId: null,
    minSettleHands: 0,
    sevenDeuceBonus: 0,
    voided: false,
    meetLink: null,
    autoApproveBuys: false,
    tvReplays: false,
  },
  players: [],
  handActive: false,
};
beforeEach(() => useStore.getState().setRoom(structuredClone(room)));
describe('lounge presence reconciliation', () => {
  it('keeps the room snapshot current so local profile edits preserve a roaming position', () => {
    const position = { x: 0, z: 6.4, revision: 1 };
    useStore.getState().setLoungePosition('lounge', 1, position);
    const current = useStore.getState().room!;
    useStore.getState().setRoom({ ...current, players: [...current.players] });
    expect(useStore.getState().lounge[1]).toEqual(position);
    expect(useStore.getState().room?.lounge?.[1]).toEqual(position);
  });
  it('ignores another room and removes returned players from both representations', () => {
    const position = { x: 0, z: 6.4, revision: 1 };
    useStore.getState().setLoungePosition('elsewhere', 1, position);
    expect(useStore.getState().lounge).toEqual({});
    useStore.getState().setLoungePosition('lounge', 1, position);
    useStore.getState().setLoungePosition('lounge', 1, null);
    expect(useStore.getState().lounge).toEqual({});
    expect(useStore.getState().room?.lounge).toEqual({});
  });
  it('uses reconnect snapshots and clears presence on room exit', () => {
    useStore.getState().setRoom({ ...room, lounge: { 2: { x: 0, z: -6.7, revision: 20 } } });
    expect(useStore.getState().lounge[2]?.revision).toBe(20);
    useStore.getState().setRoom(null);
    expect(useStore.getState().lounge).toEqual({});
  });
});
