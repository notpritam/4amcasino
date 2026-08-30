import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from './db.js';
import { requireUser } from './auth.js';
import { canBank, getRoom, isMember, roomEvents } from './rooms.js';
import { describeScore, evaluate7 } from '@4am/shared';

const MAX_AVATAR_BYTES = 300_000;
const AVATAR_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const CARD_BACKS = ['indigo', 'crimson', 'emerald', 'slate'] as const;

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(24).optional(),
  bio: z.string().trim().max(280).optional(),
  cardBack: z.enum(CARD_BACKS).optional(),
  fourColor: z.boolean().optional(),
  theme: z.enum(['light', 'dark', 'cyber']).optional(),
  avatar3d: z.string().max(300).optional(),
  quickPhrases: z.array(z.string().trim().min(1).max(60)).max(8).optional(),
  privateMode: z.boolean().optional(),
  autoJoinInvites: z.boolean().optional(),
  autoReady: z.boolean().optional(),
  showBestHand: z.boolean().optional(),
});

const avatarSchema = z.object({
  image: z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
});

const LEADERBOARD_SQL = `
  SELECT u.id as userId, u.username, u.display_name as displayName, u.avatar_version as avatarVersion,
         SUM(l.delta) as net, COUNT(*) as handsPlayed, MAX(l.delta) as biggestWin
  FROM ledger l JOIN users u ON u.id = l.user_id JOIN rooms r ON r.id = l.room_id
  WHERE l.kind = 'hand-settlement' AND u.private_mode = 0 AND r.voided = 0 AND r.archived = 0 AND r.deleted = 0
    AND u.id NOT IN (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'platform_user_id')
    AND NOT EXISTS (SELECT 1 FROM ledger v WHERE v.room_id = l.room_id AND v.kind = 'void-hand' AND v.ref = l.ref) %ROOM%
  GROUP BY u.id ORDER BY net DESC, handsPlayed DESC
`;

export function registerProfileRoutes(app: FastifyInstance, db: DB): void {
  const authed = { preHandler: requireUser(db) };

  app.get('/api/profile', authed, async (req) => {
    const row = db
      .prepare(
        'SELECT id, username, display_name, bio, avatar_version, card_back, four_color, theme, avatar3d, quick_phrases, private_mode, auto_join_invites, auto_ready, avatar IS NOT NULL as hasAvatar FROM users WHERE id = ?',
      )
      .get(req.userId) as {
      id: number;
      username: string;
      display_name: string | null;
      bio: string | null;
      avatar_version: number;
      card_back: string;
      four_color: number;
      theme: string;
      avatar3d: string | null;
      quick_phrases: string | null;
      private_mode: number;
      auto_join_invites: number;
      auto_ready: number;
      hasAvatar: number;
    };
    return {
      userId: row.id,
      username: row.username,
      displayName: row.display_name ?? row.username,
      bio: row.bio ?? '',
      hasAvatar: !!row.hasAvatar,
      avatarVersion: row.avatar_version,
      cardBack: row.card_back,
      fourColor: !!row.four_color,
      theme: row.theme,
      avatar3d: row.avatar3d,
      quickPhrases: row.quick_phrases ? (JSON.parse(row.quick_phrases) as string[]) : [],
      privateMode: !!row.private_mode,
      autoJoinInvites: !!row.auto_join_invites,
      autoReady: !!row.auto_ready,
    };
  });

  app.put('/api/profile', authed, async (req, reply) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid profile' });
    const { displayName, bio, cardBack, fourColor, theme, quickPhrases, privateMode } = parsed.data;
    if (privateMode !== undefined)
      db.prepare('UPDATE users SET private_mode = ? WHERE id = ?').run(privateMode ? 1 : 0, req.userId);
    if (parsed.data.autoJoinInvites !== undefined)
      db.prepare('UPDATE users SET auto_join_invites = ? WHERE id = ?').run(
        parsed.data.autoJoinInvites ? 1 : 0,
        req.userId,
      );
    if (parsed.data.autoReady !== undefined)
      db.prepare('UPDATE users SET auto_ready = ? WHERE id = ?').run(
        parsed.data.autoReady ? 1 : 0,
        req.userId,
      );
    if (parsed.data.showBestHand !== undefined)
      db.prepare('UPDATE users SET show_best_hand = ? WHERE id = ?').run(
        parsed.data.showBestHand ? 1 : 0,
        req.userId,
      );
    if (parsed.data.avatar3d !== undefined) {
      db.prepare('UPDATE users SET avatar3d = ? WHERE id = ?').run(parsed.data.avatar3d, req.userId);
      // the character changed: every table they sit at repaints live
      const memberRooms = db.prepare('SELECT room_id FROM room_players WHERE user_id = ?').all(req.userId) as { room_id: string }[];
      for (const r of memberRooms) roomEvents.emit('changed', r.room_id);
    }
    if (theme !== undefined)
      db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme, req.userId);
    if (quickPhrases !== undefined)
      db.prepare('UPDATE users SET quick_phrases = ? WHERE id = ?').run(
        JSON.stringify(quickPhrases),
        req.userId,
      );
    if (displayName !== undefined)
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, req.userId);
    if (bio !== undefined) db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, req.userId);
    if (cardBack !== undefined)
      db.prepare('UPDATE users SET card_back = ? WHERE id = ?').run(cardBack, req.userId);
    if (fourColor !== undefined)
      db.prepare('UPDATE users SET four_color = ? WHERE id = ?').run(fourColor ? 1 : 0, req.userId);
    return { ok: true };
  });

  app.put('/api/profile/avatar', authed, async (req, reply) => {
    const parsed = avatarSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'send a png, jpeg, or webp data URL' });
    const [meta, b64] = parsed.data.image.split(',', 2) as [string, string];
    const mime = meta.slice(5, meta.indexOf(';'));
    if (!AVATAR_MIMES.includes(mime as (typeof AVATAR_MIMES)[number]))
      return reply.code(400).send({ error: 'unsupported image type' });
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES)
      return reply.code(400).send({ error: `image must be under ${MAX_AVATAR_BYTES / 1000}KB` });
    const version = db
      .prepare(
        'UPDATE users SET avatar = ?, avatar_mime = ?, avatar_version = avatar_version + 1 WHERE id = ? RETURNING avatar_version',
      )
      .get(bytes, mime, req.userId) as { avatar_version: number };
    return { ok: true, avatarVersion: version.avatar_version };
  });

  app.delete('/api/profile/avatar', authed, async (req) => {
    db.prepare(
      'UPDATE users SET avatar = NULL, avatar_mime = NULL, avatar_version = avatar_version + 1 WHERE id = ?',
    ).run(req.userId);
    return { ok: true };
  });

  // Public on purpose: <img> tags cannot send Authorization headers, and avatars are not secrets.
  app.get('/api/users/:id/avatar', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db
      .prepare('SELECT avatar, avatar_mime FROM users WHERE id = ?')
      .get(Number(id)) as { avatar: Buffer | null; avatar_mime: string | null } | undefined;
    if (!row?.avatar || !row.avatar_mime) return reply.code(404).send({ error: 'no avatar' });
    return reply
      .header('content-type', row.avatar_mime)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .send(row.avatar);
  });

  app.get('/api/users/:id/profile', authed, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = db
      .prepare(
        `SELECT id, username, COALESCE(display_name, username) as displayName, bio, avatar_version as avatarVersion,
                avatar IS NOT NULL as hasAvatar, created_at as createdAt, private_mode as privateMode,
                join_number as joinNumber FROM users WHERE id = ?`,
      )
      .get(id) as
      | { id: number; username: string; displayName: string; bio: string | null; avatarVersion: number; hasAvatar: number; createdAt: number; privateMode: number; joinNumber: number | null }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'no such user' });

    // Where they sit in the signup queue, and how big the queue is - "#7 of 42"
    // reads as a story, "#7" on its own does not. Not private: it says nothing
    // about money, only about having been early.
    const { total } = db.prepare('SELECT COUNT(*) as total FROM users').get() as { total: number };

    // Private mode was honoured on the leaderboard and in the session report but
    // not here, so this route handed any logged-in user anyone else's lifetime
    // P&L, their whole opponent graph, and their last 100 ledger rows - notes
    // included, which is where people write how they actually settled up.
    const isSelf = req.userId === id;
    if (row.privateMode && !isSelf) {
      return {
        userId: row.id,
        username: row.username,
        displayName: row.displayName,
        bio: row.bio ?? '',
        avatarVersion: row.avatarVersion,
        hasAvatar: !!row.hasAvatar,
        createdAt: row.createdAt,
        joinNumber: row.joinNumber,
        memberCount: total,
        stats: null,
        rivals: [],
        transactions: [],
        hidden: true,
      };
    }

    const stats = db
      .prepare(
        `SELECT COALESCE(SUM(l.delta),0) as net, COUNT(*) as handsPlayed, COALESCE(MAX(l.delta),0) as biggestWin
         FROM ledger l JOIN rooms r ON r.id = l.room_id
         WHERE l.user_id = ? AND l.kind = 'hand-settlement' AND r.voided = 0 AND r.archived = 0 AND r.deleted = 0
           AND NOT EXISTS (SELECT 1 FROM ledger v WHERE v.room_id = l.room_id AND v.kind = 'void-hand' AND v.ref = l.ref)`,
      )
      .get(id) as { net: number; handsPlayed: number; biggestWin: number };

    // rivals: everyone who shared a settled hand (same ref) — hands together + this user's net in those hands
    const mine = db
      .prepare("SELECT ref, delta FROM ledger WHERE user_id = ? AND kind = 'hand-settlement' AND ref IS NOT NULL")
      .all(id) as { ref: string; delta: number }[];
    const myDelta = new Map(mine.map((m) => [m.ref, m.delta]));
    const rivalAgg = new Map<number, { handsTogether: number; netVs: number }>();
    if (mine.length > 0) {
      const others = db
        .prepare(
          `SELECT DISTINCT user_id as userId, ref FROM ledger
           WHERE kind = 'hand-settlement' AND user_id != ?
             AND ref IN (SELECT ref FROM ledger WHERE user_id = ? AND kind = 'hand-settlement')`,
        )
        .all(id, id) as { userId: number; ref: string }[];
      for (const o of others) {
        const agg = rivalAgg.get(o.userId) ?? { handsTogether: 0, netVs: 0 };
        agg.handsTogether++;
        agg.netVs += myDelta.get(o.ref) ?? 0;
        rivalAgg.set(o.userId, agg);
      }
    }
    const rivals = [...rivalAgg.entries()]
      .sort((a, b) => b[1].handsTogether - a[1].handsTogether)
      .slice(0, 10)
      .map(([userId, agg]) => {
        const u = db
          .prepare(
            'SELECT username, COALESCE(display_name, username) as displayName, avatar_version as avatarVersion FROM users WHERE id = ?',
          )
          .get(userId) as { username: string; displayName: string; avatarVersion: number };
        return { userId, ...u, ...agg };
      });

    // The money rail is only ever rendered on your own profile, and the notes
    // are settlement details people typed for themselves ("paid via UPI"), so
    // it never leaves the owner's account.
    const transactions = isSelf
      ? db
          .prepare(
            `SELECT l.room_id as roomId, r.name as roomName, l.delta, l.kind, l.note, l.ref, l.ts
             FROM ledger l JOIN rooms r ON r.id = l.room_id
             WHERE l.user_id = ? ORDER BY l.id DESC LIMIT 100`,
          )
          .all(id)
      : [];

    return {
      userId: row.id,
      username: row.username,
      displayName: row.displayName,
      bio: row.bio ?? '',
      avatarVersion: row.avatarVersion,
      hasAvatar: !!row.hasAvatar,
      createdAt: row.createdAt,
      joinNumber: row.joinNumber,
      memberCount: total,
      stats,
      rivals,
      transactions,
    };
  });

  app.get('/api/leaderboard', authed, async () => {
    const rows = db.prepare(LEADERBOARD_SQL.replace('%ROOM%', '')).all();
    return { rows };
  });

  app.get('/api/rooms/:id/leaderboard', authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getRoom(db, id)) return reply.code(404).send({ error: 'no such room' });
    if (!isMember(db, id, req.userId)) return reply.code(403).send({ error: 'not a member' });
    const rows = db.prepare(LEADERBOARD_SQL.replace('%ROOM%', 'AND l.room_id = @roomId')).all({ roomId: id });
    return { rows };
  });

  // my cumulative results over time, for the lobby chart
  app.get('/api/me/timeline', authed, async (req) => {
    const rows = db
      .prepare(
        `SELECT l.ts, l.delta FROM ledger l JOIN rooms r ON r.id = l.room_id
         WHERE l.user_id = ? AND l.kind = 'hand-settlement' AND r.voided = 0 AND r.archived = 0 AND r.deleted = 0
           AND NOT EXISTS (SELECT 1 FROM ledger v WHERE v.room_id = l.room_id AND v.kind = 'void-hand' AND v.ref = l.ref)
         ORDER BY l.ts LIMIT 2000`,
      )
      .all(req.userId) as { ts: number; delta: number }[];
    let net = 0;
    return { points: rows.map((r) => ({ ts: r.ts, net: (net += r.delta) })) };
  });

  // play-style profile mined from the public hand transcripts
  app.get('/api/users/:id/style', authed, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id))
      return reply.code(404).send({ error: 'no such user' });
    const rows = db
      .prepare(
        `SELECT t.entries FROM transcripts t JOIN rooms r ON r.id = t.room_id
         WHERE r.voided = 0 AND r.archived = 0 AND r.deleted = 0
           AND t.room_id IN (SELECT room_id FROM room_players WHERE user_id = ?)
         ORDER BY t.ts DESC LIMIT 500`,
      )
      .all(id) as { entries: string }[];
    let hands = 0;
    let vpip = 0;
    let pfr = 0;
    let raisesBets = 0;
    let calls = 0;
    let folds = 0;
    let showdowns = 0;
    let wins = 0;
    let quietWins = 0;
    for (const row of rows) {
      let entries: { type: string; payload: Record<string, unknown> }[];
      try {
        entries = JSON.parse(row.entries);
      } catch {
        continue;
      }
      const hs = entries.find((e) => e.type === 'hand_start');
      const seats = (hs?.payload.seats ?? []) as { seat: number; userId: number }[];
      const seat = seats.find((x) => x.userId === id)?.seat;
      if (seat === undefined) continue;
      hands++;
      let street = 0;
      let voluntary = false;
      let raisedPre = false;
      for (const e of entries) {
        if (e.type === 'street') street++;
        if (e.type === 'action' && (e.payload.seat as number) === seat) {
          const a = e.payload.action as { type: string };
          if (a.type === 'call') {
            calls++;
            if (street === 0) voluntary = true;
          } else if (a.type === 'bet' || a.type === 'raise') {
            raisesBets++;
            if (street === 0) {
              voluntary = true;
              raisedPre = true;
            }
          } else if (a.type === 'fold') {
            folds++;
          }
        }
        if (e.type === 'settlement') {
          const p = e.payload as {
            awards?: { seat: number; amount: number }[];
            reveals?: { seat: number }[];
          };
          if ((p.reveals ?? []).some((r) => r.seat === seat)) showdowns++;
          const award = (p.awards ?? []).find((a) => a.seat === seat)?.amount ?? 0;
          if (award > 0) {
            wins++;
            if ((p.reveals ?? []).length === 0) quietWins++;
          }
        }
      }
      if (voluntary) vpip++;
      if (raisedPre) pfr++;
    }
    if (hands === 0) return { hands: 0 };
    const pct = (n: number) => Math.round((n / hands) * 100);
    const af = calls > 0 ? raisesBets / calls : raisesBets > 0 ? 3 : 0;
    const vpipPct = pct(vpip);
    let archetype: string;
    if (hands < 10) archetype = 'Too early to tell';
    else if (vpipPct >= 45 && af < 1) archetype = 'The calling station';
    else if (vpipPct >= 45) archetype = 'The maniac';
    else if (vpipPct <= 28 && af >= 1.5) archetype = 'The shark';
    else if (vpipPct <= 28 && af < 1) archetype = 'The rock';
    else archetype = 'Balanced';
    return {
      hands,
      vpipPct,
      pfrPct: pct(pfr),
      aggressionFactor: Math.round(af * 100) / 100,
      showdownPct: pct(showdowns),
      winPct: pct(wins),
      quietWinPct: wins > 0 ? Math.round((quietWins / wins) * 100) : 0,
      foldRate: pct(folds),
      archetype,
    };
  });

  // the full session report: duration, hands, biggest pot, per-player detail
  app.get('/api/rooms/:id/session', authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getRoom(db, id)) return reply.code(404).send({ error: 'no such room' });
    if (!isMember(db, id, req.userId)) return reply.code(403).send({ error: 'not a member' });
    const span = db
      .prepare('SELECT COUNT(*) as hands, MIN(ts) as firstTs, MAX(ts) as lastTs FROM transcripts WHERE room_id = ?')
      .get(id) as { hands: number; firstTs: number | null; lastTs: number | null };
    const pot = db
      .prepare(
        `SELECT MAX(potSum) as biggestPot FROM (
           SELECT SUM(CASE WHEN l.delta > 0 THEN l.delta ELSE 0 END) as potSum
           FROM ledger l WHERE l.room_id = ? AND l.kind = 'hand-settlement'
             AND NOT EXISTS (SELECT 1 FROM ledger v WHERE v.room_id = l.room_id AND v.kind = 'void-hand' AND v.ref = l.ref)
           GROUP BY l.ref
         )`,
      )
      .get(id) as { biggestPot: number | null };
    const players = db
      .prepare(
        `SELECT u.id as userId, u.username, COALESCE(u.display_name, u.username) as displayName,
                u.avatar_version as avatarVersion, u.private_mode as privateMode, rp.stack, rp.seat,
                COALESCE(b.bought, 0) as bought,
                COALESCE(st.handsPlayed, 0) as handsPlayed,
                COALESCE(st.wins, 0) as wins,
                COALESCE(st.net, 0) as net,
                COALESCE(st.biggestWin, 0) as biggestWin,
                COALESCE(st.biggestLoss, 0) as biggestLoss
         FROM room_players rp
         JOIN users u ON u.id = rp.user_id
         LEFT JOIN (
           SELECT user_id, SUM(delta) as bought FROM ledger
           WHERE room_id = @roomId AND kind IN ('purchase', 'revert') GROUP BY user_id
         ) b ON b.user_id = rp.user_id
         LEFT JOIN (
           SELECT user_id,
                  COUNT(*) as handsPlayed,
                  SUM(CASE WHEN delta > 0 THEN 1 ELSE 0 END) as wins,
                  SUM(delta) as net,
                  MAX(delta) as biggestWin,
                  MIN(delta) as biggestLoss
           FROM ledger l WHERE l.room_id = @roomId AND l.kind = 'hand-settlement'
             AND NOT EXISTS (SELECT 1 FROM ledger v WHERE v.room_id = l.room_id AND v.kind = 'void-hand' AND v.ref = l.ref)
           GROUP BY l.user_id
         ) st ON st.user_id = rp.user_id
         WHERE rp.room_id = @roomId
         ORDER BY net DESC`,
      )
      .all({ roomId: id }) as (Record<string, unknown> & { userId: number; privateMode: number })[];
    // private mode: winnings stay visible to the player themself and the bankers
    const room = getRoom(db, id)!;
    const requesterCanSettle = canBank(room, req.userId);
    const masked = players.map((p) => {
      const { privateMode, ...rest } = p;
      if (!privateMode || p.userId === req.userId || requesterCanSettle) return { ...rest, hidden: false };
      return { ...rest, net: 0, wins: 0, biggestWin: 0, biggestLoss: 0, bought: 0, hidden: true };
    });
    return {
      hands: span.hands,
      firstTs: span.firstTs,
      lastTs: span.lastTs,
      biggestPot: pot.biggestPot ?? 0,
      players: masked,
    };
  });

  // Your recent hands across every room, compressed for the profile's history
  // rail: outcome, net, the board, and YOUR cards whenever the transcript
  // knows them (showdown, voluntary show, or a TV-replay key reveal).
  // Requested by notpritam, docs/FEATURES.md.
  app.get('/api/me/hand-history', authed, async (req) => {
    const rows = db
      .prepare(
        `SELECT t.hand_id as handId, t.room_id as roomId, r.name as roomName, t.head, t.entries, t.ts
         FROM transcripts t
         JOIN rooms r ON r.id = t.room_id
         JOIN room_players rp ON rp.room_id = t.room_id AND rp.user_id = ?
         ORDER BY t.ts DESC LIMIT 140`,
      )
      .all(req.userId) as { handId: string; roomId: string; roomName: string; head: string; entries: string; ts: number }[];
    const netStmt = db.prepare(
      "SELECT COALESCE(SUM(delta), 0) as net FROM ledger WHERE user_id = ? AND ref = ? AND kind = 'hand-settlement'",
    );
    const voidStmt = db.prepare("SELECT 1 FROM ledger WHERE kind = 'void-hand' AND ref = ? LIMIT 1");
    const hands: unknown[] = [];
    for (const row of rows) {
      if (hands.length >= 30) break;
      let entries: { type: string; payload: Record<string, unknown> }[];
      try {
        entries = JSON.parse(row.entries) as typeof entries;
      } catch {
        continue;
      }
      const start = entries.find((e) => e.type === 'hand_start');
      if (!start) continue;
      const seats = (start.payload.seats as { seat: number; userId: number }[]) ?? [];
      const mine = seats.find((x) => x.userId === req.userId);
      if (!mine) continue; // a hand in my room that I sat out
      const settlement = entries.find((e) => e.type === 'settlement');
      const board = (settlement?.payload.board as number[] | undefined) ?? [];
      const allReveals =
        (settlement?.payload.reveals as { seat: number; cards: number[] }[] | undefined) ?? [];
      const reveal = allReveals.find((x) => x.seat === mine.seat);
      const labelOf = (cards: number[]): string | null =>
        board.length === 5 ? describeScore(evaluate7([...cards, ...board] as never)) : null;
      // who I beat (or lost to): every OTHER revealed hand, with what it made
      const opponents = allReveals
        .filter((x) => x.seat !== mine.seat)
        .map((x) => {
          const uid = seats.find((sx) => sx.seat === x.seat)?.userId;
          const who = uid
            ? (db.prepare('SELECT COALESCE(display_name, username) as name FROM users WHERE id = ?').get(uid) as
                | { name: string }
                | undefined)
            : undefined;
          return { name: who?.name ?? `Seat ${x.seat + 1}`, cards: x.cards, label: labelOf(x.cards) };
        });
      const decrypted = entries.find(
        (e) => e.type === 'hole_cards' && (e.payload.seat as number) === mine.seat,
      );
      const folded = entries.some(
        (e) =>
          (e.type === 'action' &&
            (e.payload.seat as number) === mine.seat &&
            (e.payload.action as { type: string }).type === 'fold') ||
          (e.type === 'timeout_fold' && (e.payload.seat as number) === mine.seat),
      );
      const net = (netStmt.get(req.userId, row.head) as { net: number }).net;
      const outcome = !settlement
        ? 'aborted'
        : reveal
          ? net >= 0
            ? 'won at showdown'
            : 'lost at showdown'
          : folded
            ? 'folded'
            : net > 0
              ? 'won quietly'
              : 'played';
      const myCards = reveal?.cards ?? (decrypted?.payload.cards as number[] | undefined) ?? null;
      hands.push({
        handId: row.handId,
        roomId: row.roomId,
        roomName: row.roomName,
        ts: row.ts,
        net,
        outcome,
        board,
        myCards,
        label: myCards ? labelOf(myCards) : null,
        opponents,
        voided: !!voidStmt.get(row.head),
      });
    }
    return { hands };
  });

  // The crown jewel: the player's biggest win as a quick snapshot - their
  // cards, the board, the amount - shown on their profile and reachable from
  // the leaderboard. The owner can hide it (show_best_hand toggle).
  // Requested by notpritam, docs/FEATURES.md.
  app.get('/api/users/:id/best-hand', authed, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const user = db
      .prepare('SELECT id, show_best_hand as showBestHand FROM users WHERE id = ?')
      .get(id) as { id: number; showBestHand: number } | undefined;
    if (!user) return reply.code(404).send({ error: 'no such player' });
    if (!user.showBestHand && req.userId !== id) return { hidden: true, hand: null };
    const best = db
      .prepare(
        `SELECT l.delta, l.ref, l.room_id as roomId, r.name as roomName
         FROM ledger l JOIN rooms r ON r.id = l.room_id
         WHERE l.user_id = ? AND l.kind = 'hand-settlement' AND l.delta > 0 AND r.voided = 0 AND r.archived = 0 AND r.deleted = 0
           AND NOT EXISTS (SELECT 1 FROM ledger v WHERE v.room_id = l.room_id AND v.kind = 'void-hand' AND v.ref = l.ref)
         ORDER BY l.delta DESC LIMIT 1`,
      )
      .get(id) as { delta: number; ref: string; roomId: string; roomName: string } | undefined;
    if (!best) return { hidden: !user.showBestHand, hand: null };
    const t = db
      .prepare('SELECT hand_id as handId, entries, ts FROM transcripts WHERE head = ?')
      .get(best.ref) as { handId: string; entries: string; ts: number } | undefined;
    if (!t) return { hidden: !user.showBestHand, hand: null };
    let board: number[] = [];
    let myCards: number[] | null = null;
    let label: string | null = null;
    try {
      const entries = JSON.parse(t.entries) as { type: string; payload: Record<string, unknown> }[];
      const start = entries.find((e) => e.type === 'hand_start');
      const seat = (
        (start?.payload.seats as { seat: number; userId: number }[] | undefined) ?? []
      ).find((x) => x.userId === id)?.seat;
      const settlement = entries.find((e) => e.type === 'settlement');
      board = (settlement?.payload.board as number[] | undefined) ?? [];
      const reveal = (
        (settlement?.payload.reveals as { seat: number; cards: number[] }[] | undefined) ?? []
      ).find((x) => x.seat === seat);
      const decrypted = entries.find(
        (e) => e.type === 'hole_cards' && (e.payload.seat as number) === seat,
      );
      myCards = reveal?.cards ?? (decrypted?.payload.cards as number[] | undefined) ?? null;
      if (myCards && board.length === 5)
        label = describeScore(evaluate7([...(myCards as [number, number]), ...board] as never));
    } catch {
      /* an unreadable transcript just means a smaller snapshot */
    }
    return {
      hidden: !user.showBestHand,
      hand: {
        amount: best.delta,
        roomId: best.roomId,
        roomName: best.roomName,
        handId: t.handId,
        ts: t.ts,
        board,
        myCards,
        label,
        canReplay: isMember(db, best.roomId, req.userId),
      },
    };
  });
}