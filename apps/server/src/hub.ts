import { WebSocketServer, type WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { clientMsgSchema } from '@4am/shared';
import { genIdentity } from '@4am/mental-poker';
import type { DB } from './db.js';
import {userForToken, touchPresence } from './auth.js';
import { isMember, isSpectator, roomEvents } from './rooms.js';
import { GameRoom, type GameOpts } from './game.js';

// 10s per attempt with 3 retries: a stalled player gets a fixed ~40s to rejoin
const DEFAULT_OPTS: GameOpts = { cryptoTimeoutMs: 10_000, actionTimeoutMs: 45_000 };

export function attachHub(
  app: FastifyInstance,
  db: DB,
  opts: Partial<GameOpts> = {},
): { rooms: Map<string, GameRoom>; serverPublicKey: string } {
  const gameOpts: GameOpts = { ...DEFAULT_OPTS, ...opts };
  const serverIdentity = genIdentity();
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map<string, GameRoom>();

  app.server.on('upgrade', (req, socket, head) => {
    // answer with real HTTP before closing, so proxies report 401/404 instead of 502
    const deny = (status: number, label: string) => {
      socket.write(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      deny(404, 'Not Found');
      return;
    }
    const userId = userForToken(db, url.searchParams.get('token') ?? '');
    if (userId === null) {
      deny(401, 'Unauthorized');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, userId));
  });

  const onRoomChanged = (roomId: string) => rooms.get(roomId)?.broadcastRoomState();
  roomEvents.on('changed', onRoomChanged);

  app.addHook('onClose', async () => {
    roomEvents.off('changed', onRoomChanged);
    for (const room of rooms.values()) room.shutdown();
    // wss.close() alone waits for clients to hang up, which stalls shutdown
    // (and stretches the deploy gap) - drop them; the web app auto-reconnects
    for (const client of wss.clients) client.terminate();
    wss.close();
  });

  function handleConnection(ws: WebSocket, userId: number): void {
    let current: GameRoom | null = null;
    ws.send(JSON.stringify({ t: 'hello', serverPublicKey: serverIdentity.publicKey }));

    touchPresence(db, userId);
    ws.on('message', (raw) => {
      if (!db.open) return; // shutting down: sockets drain, nothing to do
      touchPresence(db, userId);
      let json: unknown;
      try {
        json = JSON.parse(String(raw));
      } catch {
        ws.send(JSON.stringify({ t: 'error', message: 'invalid json' }));
        return;
      }
      const parsed = clientMsgSchema.safeParse(json);
      if (!parsed.success) {
        ws.send(JSON.stringify({ t: 'error', message: 'invalid message' }));
        return;
      }
      const msg = parsed.data;
      if (msg.t === 'join_room') {
        if (!isMember(db, msg.roomId, userId) && !isSpectator(db, msg.roomId, userId)) {
          ws.send(JSON.stringify({ t: 'error', message: 'not a member of that room' }));
          return;
        }
        current?.leave(userId, ws);
        let room = rooms.get(msg.roomId);
        if (!room) {
          room = new GameRoom(db, msg.roomId, serverIdentity, gameOpts);
          rooms.set(msg.roomId, room);
        }
        current = room;
        room.join(userId, ws);
        return;
      }
      if (!current) {
        ws.send(JSON.stringify({ t: 'error', message: 'join a room first' }));
        return;
      }
      current.handleMessage(userId, msg);
    });

    ws.on('close', () => {
      current?.leave(userId, ws);
    });
  }

  return { rooms, serverPublicKey: serverIdentity.publicKey };
}
