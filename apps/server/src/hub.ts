import { WebSocketServer, type WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { clientMsgSchema } from '@4am/shared';
import { genIdentity } from '@4am/mental-poker';
import type { DB } from './db.js';
import {userForToken, touchPresence } from './auth.js';
import { isMember, isSpectator, roomEvents } from './rooms.js';
import { GameRoom, type GameOpts } from './game.js';
import { LIMITS } from './limits.js';

// 10s per attempt with 3 retries: a stalled player gets a fixed ~40s to rejoin
const DEFAULT_OPTS: GameOpts = { cryptoTimeoutMs: 10_000, actionTimeoutMs: 45_000 };

/** Same-origin only. The game socket carries a session credential, so a page on
 *  any other origin has no business opening one. */
function originAllowed(origin: string | undefined): boolean {
  // No Origin at all means a non-browser client (the MCP seat, a script, the
  // tests). Those still need a valid session token, and the header is only
  // meaningful as a defence against a *page* on another origin - which always
  // sends one. Denying here would lock out every non-browser client instead.
  if (!origin) return true;
  const extra = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return (
      host === 'poker.notpritam.in' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      // a house game served off the LAN box
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)
    );
  } catch {
    return false;
  }
}

export function attachHub(
  app: FastifyInstance,
  db: DB,
  opts: Partial<GameOpts> = {},
): { rooms: Map<string, GameRoom>; serverPublicKey: string } {
  const gameOpts: GameOpts = { ...DEFAULT_OPTS, ...opts };
  const serverIdentity = genIdentity();
  // ws defaults maxPayload to 100MB; the biggest legitimate message is a 52-card
  // deck at a few KB, and one oversized frame is enough to OOM the instance
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: LIMITS.wsFrameBytes,
    // echo the marker (never the token itself) so the browser sees its offered
    // subprotocol accepted
    handleProtocols: (protocols) => (protocols.has('bearer') ? 'bearer' : false),
  });
  const rooms = new Map<string, GameRoom>();
  const socketsPerUser = new Map<number, number>();

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
    if (!originAllowed(req.headers.origin)) {
      deny(403, 'Forbidden');
      return;
    }
    // Sec-WebSocket-Protocol keeps the credential out of the request line, which
    // proxies and platform access logs record verbatim. The query parameter is
    // still read so clients mid-deploy keep working.
    const protoHeader = String(req.headers['sec-websocket-protocol'] ?? '');
    const protos = protoHeader.split(',').map((s) => s.trim());
    const fromProto = protos[0] === 'bearer' ? (protos[1] ?? null) : null;
    const token = fromProto ?? url.searchParams.get('token') ?? '';
    const userId = userForToken(db, token);
    if (userId === null) {
      deny(401, 'Unauthorized');
      return;
    }
    if ((socketsPerUser.get(userId) ?? 0) >= 6) {
      deny(429, 'Too Many Requests');
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
    socketsPerUser.set(userId, (socketsPerUser.get(userId) ?? 0) + 1);
    ws.send(JSON.stringify({ t: 'hello', serverPublicKey: serverIdentity.publicKey }));

    // Two buckets, because the two kinds of message have nothing in common.
    //
    // The hand protocol is inherently bursty - dealing one hand fires a key
    // commit, a shuffle, and an unmask share per card per player, all at once -
    // and it is already self-limiting: the engine only accepts a share the hand
    // is actually waiting on. Throttling it by count just breaks the game.
    //
    // The free-form messages are the amplifier: one chat frame fans out to every
    // socket in the room, one rtc frame is relayed verbatim. Those get a tight
    // budget. The wide bucket underneath is only a backstop against a pure flood.
    const PROTOCOL_TYPES = new Set([
      'key_commit', 'shuffle_deck', 'unmask_share', 'action', 'reveal_key',
      'show_cards', 'fold_key', 'rit_vote', 'im_ready', 'peek_accept', 'peek_decline',
    ]);
    const bucket = (rate: number) => {
      let tokens = rate;
      let last = Date.now();
      return () => {
        const now = Date.now();
        tokens = Math.min(rate, tokens + ((now - last) / 1000) * rate);
        last = now;
        if (tokens < 1) return false;
        tokens--;
        return true;
      };
    };
    const takeWide = bucket(300);
    const takeChatty = bucket(LIMITS.wsMessagesPerSec);

    touchPresence(db, userId);
    ws.on('message', (raw) => {
      if (!db.open) return; // shutting down: sockets drain, nothing to do
      if (!takeWide()) {
        ws.close(1008, 'rate limit');
        return;
      }
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
      if (!PROTOCOL_TYPES.has(msg.t) && !takeChatty()) {
        ws.send(JSON.stringify({ t: 'error', message: 'slow down' }));
        return;
      }
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
      const left = (socketsPerUser.get(userId) ?? 1) - 1;
      if (left <= 0) socketsPerUser.delete(userId);
      else socketsPerUser.set(userId, left);
      // a room with nobody in it and no hand running holds timers and per-hand
      // maps alive for the life of the process; let it go
      if (current && current.isIdle()) {
        for (const [id, room] of rooms) {
          if (room === current) {
            room.shutdown();
            rooms.delete(id);
            break;
          }
        }
      }
    });
  }

  return { rooms, serverPublicKey: serverIdentity.publicKey };
}
