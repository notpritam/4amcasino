import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { genIdentity } from '@4am/mental-poker';
import type { ServerMsg } from '@4am/shared';
import { openDb } from '../src/db.js';
import { GameRoom } from '../src/game.js';
import { createApp } from '../src/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setPlatformUserId } from '../src/platform.js';

it('migrates existing rooms without resetting a saved off setting after restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'auto-deal-db-'));
  const path = join(directory, 'test.db');
  let db = openDb(path);
  try {
    db.prepare(
      'INSERT INTO rooms (id,name,join_code,host_id,banker_id,sb,bb,created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run('old', 'Old', 'OLDAUT', 1, 1, 10, 20, Date.now());
    db.exec('ALTER TABLE rooms DROP COLUMN auto_deal');
    db.close();
    db = openDb(path);
    expect(db.prepare('SELECT auto_deal FROM rooms WHERE id = ?').get('old')).toEqual({
      auto_deal: 1,
    });
    db.prepare('UPDATE rooms SET auto_deal = 0 WHERE id = ?').run('old');
    db.close();
    db = openDb(path);
    expect(db.prepare('SELECT auto_deal FROM rooms WHERE id = ?').get('old')).toEqual({
      auto_deal: 0,
    });
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('room auto-deal setting', () => {
  let ctx: ReturnType<typeof createApp>;
  beforeEach(() => {
    ctx = createApp(':memory:');
  });
  afterEach(async () => {
    await ctx.app.close();
  });
  async function user(username: string) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/register',
      payload: { username, authKey: 'a'.repeat(64), publicKey: 'b'.repeat(64) },
    });
    return response.json() as { token: string; userId: number };
  }
  it('persists the host switch and rejects other accounts and invalid values', async () => {
    const host = await user('autohost'),
      member = await user('autobackup');
    const headers = { authorization: `Bearer ${host.token}` };
    const created = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers,
        payload: { name: 'Auto', sb: 10, bb: 20 },
      })
    ).json();
    const url = `/api/rooms/${created.id}`;
    const read = () => ctx.app.inject({ url, headers });
    expect((await read()).json().autoDeal).toBe(true);
    expect(
      (
        await ctx.app.inject({
          method: 'PUT',
          url: url + '/settings',
          headers,
          payload: { autoDeal: false },
        })
      ).statusCode,
    ).toBe(200);
    expect((await read()).json().autoDeal).toBe(false);
    // Even a banker does not acquire the host's auto-deal switch.
    ctx.db.prepare('UPDATE rooms SET banker_id = ? WHERE id = ?').run(member.userId, created.id);
    expect(
      (
        await ctx.app.inject({
          method: 'PUT',
          url: url + '/settings',
          headers: { authorization: `Bearer ${member.token}` },
          payload: { autoDeal: true },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await ctx.app.inject({
          method: 'PUT',
          url: url + '/settings',
          headers,
          payload: { autoDeal: 'yes' },
        })
      ).statusCode,
    ).toBe(400);
    expect((await read()).json().autoDeal).toBe(false);
    expect(
      (
        await ctx.app.inject({
          method: 'PUT',
          url: url + '/settings',
          headers,
          payload: { autoDeal: true },
        })
      ).statusCode,
    ).toBe(200);
    expect((await read()).json().autoDeal).toBe(true);
  });
});

describe('automatic dealer lifecycle', () => {
  let db: ReturnType<typeof openDb>, room: GameRoom, messages: ServerMsg[][], sockets: WebSocket[];
  beforeEach(() => {
    vi.useFakeTimers();
    db = openDb(':memory:');
    db.prepare(
      'INSERT INTO rooms (id,name,join_code,host_id,banker_id,sb,bb,created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run('auto', 'Auto', 'AUTODE', 1, 1, 10, 20, Date.now());
    for (let id = 1; id <= 4; id++) {
      db.prepare(
        'INSERT INTO users (id,username,auth_hash,auth_salt,pubkey,created_at) VALUES (?,?,?,?,?,?)',
      ).run(id, `player${id}`, 'test', 'test', genIdentity().publicKey, Date.now());
      db.prepare('INSERT INTO room_players (room_id,user_id,seat,stack) VALUES (?,?,?,?)').run(
        'auto',
        id,
        id === 4 ? null : id - 1,
        1000,
      );
    }
    room = new GameRoom(db, 'auto', genIdentity(), {
      cryptoTimeoutMs: 60000,
      actionTimeoutMs: 30000,
      autoDealMs: 1000,
      readyCheckMs: 2000,
    });
    messages = [[], [], [], []];
    sockets = messages.map(
      (list) => ({ send: (text: string) => list.push(JSON.parse(text)) }) as unknown as WebSocket,
    );
    for (let id = 1; id <= 4; id++) room.join(id, sockets[id - 1]!);
  });
  afterEach(() => {
    room.shutdown();
    db.close();
    vi.useRealTimers();
  });
  const state = () => messages[1]!.filter((m) => m.t === 'room_state').at(-1)!;
  const kinds = (kind: ServerMsg['t']) => messages[1]!.filter((m) => m.t === kind);
  const setEnabled = (enabled: boolean) => {
    db.prepare('UPDATE rooms SET auto_deal = ? WHERE id = ?').run(enabled ? 1 : 0, 'auto');
    room.broadcastRoomState();
  };

  it('prefers the eligible host and keeps one countdown across broadcasts', () => {
    expect(state().room).toMatchObject({ autoDeal: true, autoDealerId: 1 });
    const deadline = (state() as any).autoDealAt;
    expect(deadline).toBe(Date.now() + 1000);
    vi.advanceTimersByTime(400);
    room.broadcastRoomState();
    expect((state() as any).autoDealAt).toBe(deadline);
    vi.advanceTimersByTime(600);
    expect(kinds('ready_check')).toHaveLength(1);
    expect(kinds('hand_start')).toHaveLength(0);
    room.handleMessage(1, { t: 'im_ready' });
    room.handleMessage(2, { t: 'im_ready' });
    room.handleMessage(3, { t: 'im_ready' });
    expect(kinds('hand_start')).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(kinds('hand_start')).toHaveLength(1);
  });

  it('uses an online fallback without transferring host or banker authority', () => {
    room.leave(1, sockets[0]!);
    expect(state().room).toMatchObject({ autoDealerId: 2, hostId: 1, bankerId: 1 });
    vi.advanceTimersByTime(1000);
    room.handleMessage(2, { t: 'im_ready' });
    room.handleMessage(3, { t: 'im_ready' });
    expect(kinds('hand_start')).toHaveLength(1);
    expect((kinds('hand_start')[0] as any).seats.map((s: any) => s.userId).sort()).toEqual([2, 3]);
  });

  it('excludes the platform even if it has a funded seat and live connection', () => {
    setPlatformUserId(db, 1);
    room.broadcastRoomState();
    expect(state().room.autoDealerId).toBe(2);
    vi.advanceTimersByTime(1000);
    expect((kinds('ready_check')[0] as Extract<ServerMsg, { t: 'ready_check' }>).eligible).toEqual([
      2, 3,
    ]);
  });

  it('respects existing auto-ready preferences and disabling does not stop the active hand', () => {
    db.prepare('UPDATE users SET auto_ready = 1').run();
    vi.advanceTimersByTime(1000);
    expect(kinds('hand_start')).toHaveLength(1);
    setEnabled(false);
    expect(state().handActive).toBe(true);
    expect(kinds('hand_abort')).toHaveLength(0);
    expect(state().room.autoDeal).toBe(false);
  });

  it.each(['sit-out', 'busted', 'standing'])(
    'skips a %s host and never appoints spectators',
    (reason) => {
      if (reason === 'sit-out') room.handleMessage(1, { t: 'sit_out', sittingOut: true });
      if (reason === 'standing') room.handleMessage(1, { t: 'leave_seat' });
      if (reason === 'busted') {
        db.prepare('UPDATE room_players SET stack = 0 WHERE user_id = 1').run();
        room.broadcastRoomState();
      }
      expect(state().room).toMatchObject({ autoDealerId: 2 });
      room.leave(2, sockets[1]!);
      room.leave(3, sockets[2]!);
      expect(
        (messages[3]!.filter((m) => m.t === 'room_state').at(-1) as any).room.autoDealerId,
      ).toBeNull();
    },
  );

  it('cancels immediately when disabled, including an open ready check', () => {
    setEnabled(false);
    expect((state() as any).autoDealAt).toBeNull();
    vi.advanceTimersByTime(4000);
    expect(kinds('ready_check')).toHaveLength(0);
    setEnabled(true);
    vi.advanceTimersByTime(1000);
    expect(kinds('ready_check')).toHaveLength(1);
    setEnabled(false);
    room.handleMessage(1, { t: 'im_ready' });
    room.handleMessage(2, { t: 'im_ready' });
    room.handleMessage(3, { t: 'im_ready' });
    vi.advanceTimersByTime(4000);
    expect(kinds('hand_start')).toHaveLength(0);
    expect((state() as any).readyCheck).toBeNull();
  });

  it('pauses for too few players and resumes after reconnection', () => {
    room.leave(1, sockets[0]!);
    room.leave(3, sockets[2]!);
    expect((state() as any).autoDealAt).toBeNull();
    vi.advanceTimersByTime(4000);
    expect(kinds('ready_check')).toHaveLength(0);
    room.join(3, sockets[2]!);
    expect((state() as any).autoDealAt).toBe(Date.now() + 1000);
    vi.advanceTimersByTime(1000);
    expect(kinds('ready_check')).toHaveLength(1);
    room.join(2, sockets[1]!);
    expect((state() as any).readyCheck.eligible).toEqual([2, 3]);
  });

  it('removes someone who sits out during readiness and deals only to remaining ready players', () => {
    vi.advanceTimersByTime(1000);
    room.handleMessage(2, { t: 'im_ready' });
    room.handleMessage(3, { t: 'im_ready' });
    room.handleMessage(1, { t: 'sit_out', sittingOut: true });
    expect(kinds('hand_start')).toHaveLength(1);
    expect((kinds('hand_start')[0] as any).seats.map((s: any) => s.userId).sort()).toEqual([2, 3]);
  });

  it('does not loop ready prompts after a timeout and never deals an archived room', () => {
    vi.advanceTimersByTime(5000);
    room.broadcastRoomState();
    vi.advanceTimersByTime(5000);
    expect(kinds('ready_check')).toHaveLength(1);
    expect(kinds('hand_start')).toHaveLength(0);
    expect((state() as any).autoDealPaused).toBe(true);
    room.settingsChanged(true);
    vi.advanceTimersByTime(1000);
    expect(kinds('ready_check')).toHaveLength(2);
    setEnabled(false);
    db.prepare('UPDATE rooms SET archived = 1 WHERE id = ?').run('auto');
    setEnabled(true);
    vi.advanceTimersByTime(5000);
    expect(kinds('ready_check')).toHaveLength(2);
  });
});
