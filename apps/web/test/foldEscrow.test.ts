import { beforeEach, describe, expect, it, vi } from 'vitest';
import { genIdentity } from '@4am/mental-poker';
import { startHand, type ServerMsg } from '@4am/shared';

const socket = vi.hoisted(() => ({ send: vi.fn(), on: vi.fn() }));
vi.mock('../src/shared/ws.ts', () => ({ wsClient: socket }));
vi.mock('../src/shared/voice.ts', () => ({ voice: {} }));
vi.mock('../src/shared/sounds.ts', () => ({ play: vi.fn() }));
const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
vi.stubGlobal('window', { localStorage: storage });
vi.stubGlobal('localStorage', { ...storage, getItem: () => '01' });
const { useStore } = await import('../src/shared/store.ts');
const { act, bindGameClient } = await import('../src/shared/gameClient.ts');
bindGameClient();
const receive = socket.on.mock.calls[0]![0] as (message: ServerMsg) => void;
let handNumber = 0;

beforeEach(() => socket.send.mockClear());

function setup(players: number) {
  const handId = 'fold-escrow-' + handNumber++;
  useStore.setState({
    auth: { token: 'test', userId: 1, username: 'alice', identity: genIdentity() },
  });
  useStore.getState().patchHand({
    handId,
    seats: Array.from({ length: players }, (_, seat) => ({
      seat,
      userId: seat + 1,
      username: 'player',
      publicKey: '',
      stack: 1000,
    })),
    betting: startHand(
      Array.from({ length: players }, (_, seat) => ({ seat, stack: 1000 })),
      0,
      10,
      20,
    ),
  });
  return handId;
}

describe('fold recovery key disclosure', () => {
  it('does not send a late recovery key when the last fold already settles the pot', () => {
    const handId = setup(2);
    act({ type: 'fold' });
    receive({ t: 'action_applied', handId, seat: 0, action: { type: 'fold' } });
    expect(socket.send.mock.calls.map(([message]) => message.t)).toEqual(['action']);
  });

  it('still escrows a voluntary fold while other players need the key to continue', () => {
    const handId = setup(3);
    act({ type: 'fold' });
    receive({ t: 'action_applied', handId, seat: 0, action: { type: 'fold' } });
    expect(socket.send.mock.calls.map(([message]) => message.t)).toEqual(['action', 'fold_key']);
  });

  it('never discloses a key solely because the server announces a fold', () => {
    const handId = setup(3);
    receive({ t: 'action_applied', handId, seat: 0, action: { type: 'fold' } });
    expect(socket.send).not.toHaveBeenCalled();
  });
});
