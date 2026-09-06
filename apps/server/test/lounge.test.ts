import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { genIdentity } from '@4am/mental-poker';
import { clientMsgSchema, LOUNGE_DESTINATIONS, type ServerMsg } from '@4am/shared';
import { openDb } from '../src/db.js';
import { GameRoom } from '../src/game.js';

let db: ReturnType<typeof openDb>, room: GameRoom;
let messages: ServerMsg[][], sockets: WebSocket[];
beforeEach(() => {
  db = openDb(':memory:');
  for (let id = 1; id <= 3; id++) {
    db.prepare(
      'INSERT INTO users (id, username, auth_hash, auth_salt, pubkey, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, `player${id}`, 'test', 'test', genIdentity().publicKey, Date.now());
    if (id < 3)
      db.prepare('INSERT INTO room_players (room_id,user_id,seat,stack) VALUES (?,?,?,?)').run(
        'lounge',
        id,
        id - 1,
        1000,
      );
  }
  db.prepare(
    'INSERT INTO rooms (id,name,join_code,host_id,banker_id,sb,bb,created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run('lounge', 'Lounge', 'LOUNGE', 1, 1, 10, 20, Date.now());
  room = new GameRoom(db, 'lounge', genIdentity(), {
    cryptoTimeoutMs: 60000,
    actionTimeoutMs: 30000,
  });
  messages = [[], [], []];
  sockets = messages.map(
    (list) =>
      ({
        send: (text: string) => {
          list.push(JSON.parse(text));
        },
      }) as unknown as WebSocket,
  );
  room.join(1, sockets[0]!);
  room.join(2, sockets[1]!);
  room.join(3, sockets[2]!);
  messages.forEach((list) => (list.length = 0));
});
afterEach(() => {
  room.shutdown();
  db.close();
  vi.restoreAllMocks();
});
const move = () => room.handleMessage(1, { t: 'lounge_move', x: 0, z: 6.4 });
const state = () => messages[0]!.filter((m) => m.t === 'room_state').at(-1);

describe('shared lounge presence', () => {
  it('requires a break, broadcasts the destination, and includes it for late joiners', () => {
    move();
    expect(messages[0]!.at(-1)?.t).toBe('error');
    room.handleMessage(1, { t: 'sit_out', sittingOut: true });
    move();
    expect(messages[1]!.at(-1)).toMatchObject({
      t: 'lounge_presence',
      roomId: 'lounge',
      userId: 1,
      position: { x: 0, z: 6.4 },
    });
    room.join(2, sockets[1]!);
    expect(state()?.lounge?.[1]).toMatchObject({ x: 0, z: 6.4 });
    expect(db.prepare('SELECT stack FROM room_players WHERE user_id = 1').get()).toEqual({
      stack: 1000,
    });
  });
  it('returns to the seat and clears presence through either return control', () => {
    room.handleMessage(1, { t: 'sit_out', sittingOut: true });
    move();
    room.handleMessage(1, { t: 'lounge_return' });
    expect(state()?.lounge?.[1]).toBeUndefined();
    expect(state()?.players.find((p) => p.userId === 1)?.sittingOut).toBe(false);
    room.handleMessage(1, { t: 'sit_out', sittingOut: true });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    move();
    room.handleMessage(1, { t: 'sit_out', sittingOut: false });
    expect(state()?.lounge?.[1]).toBeUndefined();
  });
  it('rejects spectators, furniture, and nonfinite/out-of-bounds coordinates', () => {
    room.handleMessage(3, { t: 'lounge_move', x: 0, z: 6.4 });
    expect(messages[2]!.at(-1)?.t).toBe('error');
    room.handleMessage(1, { t: 'sit_out', sittingOut: true });
    room.handleMessage(1, { t: 'lounge_move', x: 0, z: 0 });
    expect(messages[0]!.at(-1)?.t).toBe('error');
    for (const x of [NaN, Infinity, 999])
      expect(clientMsgSchema.safeParse({ t: 'lounge_move', x, z: 6 }).success).toBe(false);
  });
  it('does not abandon a participant during crypto/dealing or an active hand', () => {
    room.handleMessage(1, { t: 'start_hand' });
    expect(messages[0]!.some((m) => m.t === 'hand_start')).toBe(true);
    room.handleMessage(1, { t: 'sit_out', sittingOut: true });
    move();
    expect(messages[0]!.at(-1)).toMatchObject({
      t: 'error',
      message: expect.stringContaining('hand'),
    });
    expect(messages[1]!.some((m) => m.t === 'lounge_presence')).toBe(false);
  });
  it('limits movement updates and removes a disconnected avatar', () => {
    room.handleMessage(1, { t: 'sit_out', sittingOut: true });
    move();
    room.handleMessage(1, { t: 'lounge_move', ...LOUNGE_DESTINATIONS.tv });
    expect(messages[1]!.filter((m) => m.t === 'lounge_presence')).toHaveLength(1);
    room.leave(1, sockets[0]!);
    const latest = messages[1]!.filter((m) => m.t === 'room_state').at(-1);
    expect(latest?.lounge?.[1]).toBeUndefined();
  });
  it('lets an unseated member explore and clears presence when taking a seat', () => {
    room.handleMessage(1, { t: 'leave_seat' });
    move();
    expect(messages[1]!.at(-1)?.t).toBe('lounge_presence');
    room.handleMessage(1, { t: 'sit', seat: 4 });
    expect(state()?.lounge?.[1]).toBeUndefined();
    expect(state()?.players.find((p) => p.userId === 1)?.seat).toBe(4);
  });
});
