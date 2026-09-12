import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  actArena,
  arenaView,
  createArenaRound,
  legalActions,
  type ArenaRound,
  type PlayerAction,
} from '@4am/shared';
import type { DB } from './db.js';
import { requireUser } from './auth.js';
import { AgentError, scopeUser } from './agentAccess.js';
import { publishAgentEvent } from './agentEvents.js';
import { arenaDeck, seedCommitment } from './arenaRandom.js';
import { rateLimit } from './limits.js';
import { isPlatform } from './platform.js';

interface Tournament {
  id: string;
  owner_id: number;
  name: string;
  description: string;
  status: string;
  capacity: number;
  hand_limit: number;
  starting_stack: number;
  sb: number;
  bb: number;
  action_seconds: number;
  prize_description: string;
  rules: string;
  seed: string;
  completed_hands: number;
  round_json: string | null;
  deadline: number | null;
  last_result: string | null;
  created_at: number;
  updated_at: number;
}
interface Entry {
  userId: number;
  agentName: string;
  kind: string;
  joinedAt: number;
  lastSeen: number;
  net: number;
  hands: number;
  wins: number;
  timeouts: number;
  awardNote: string;
}
function get(db: DB, id: string): Tournament {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) as Tournament | undefined;
  if (!t) throw new AgentError(404, 'Tournament not found.');
  return t;
}
function entries(db: DB, id: string): Entry[] {
  return db
    .prepare(
      'SELECT user_id AS userId, agent_name AS agentName, kind, joined_at AS joinedAt, last_seen AS lastSeen, net, hands, wins, timeouts, award_note AS awardNote FROM tournament_entries WHERE tournament_id = ? ORDER BY joined_at, user_id',
    )
    .all(id) as Entry[];
}
function summary(t: Tournament) {
  return {
    id: t.id,
    ownerId: t.owner_id,
    name: t.name,
    description: t.description,
    status: t.status,
    capacity: t.capacity,
    handLimit: t.hand_limit,
    startingStack: t.starting_stack,
    sb: t.sb,
    bb: t.bb,
    actionSeconds: t.action_seconds,
    prizeDescription: t.prize_description,
    rules: t.rules,
    completedHands: t.completed_hands,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    format: 'fixed-hand-league' as const,
    dealing: 'server-dealt' as const,
    entryFee: 0,
    seedCommitment: seedCommitment(t.seed),
  };
}
export function tournamentView(db: DB, id: string, viewerId: number | null) {
  const t = get(db, id);
  const sorted = entries(db, id).sort(
    (a, b) => b.net - a.net || a.joinedAt - b.joinedAt || a.userId - b.userId,
  );
  const ranked = sorted.map((e, i) => ({
    ...e,
    rank: sorted.findIndex((p) => p.net === e.net) + 1,
    bbPer100: e.hands ? Math.round((e.net / t.bb / e.hands) * 10000) / 100 : 0,
    online: Date.now() - e.lastSeen < 90_000,
  }));
  return {
    ...summary(t),
    entries: ranked,
    round: t.round_json ? arenaView(JSON.parse(t.round_json) as ArenaRound, viewerId) : null,
    eventCursor: (
      db
        .prepare(
          "SELECT COALESCE(MAX(id),0) AS id FROM agent_events WHERE scope_kind = 'tournament' AND scope_id = ?",
        )
        .get(id) as { id: number }
    ).id,
    deadline: t.status === 'running' ? t.deadline : null,
    lastResult: t.last_result ? JSON.parse(t.last_result) : null,
    ...(t.status === 'completed' ? { seed: t.seed } : {}),
  };
}
function emit(db: DB, id: string, type: string, data: unknown) {
  publishAgentEvent(db, 'tournament', id, type, data);
}
function freshRound(db: DB, t: Tournament, handNumber: number): ArenaRound {
  return createArenaRound(
    {
      playerIds: entries(db, t.id).map((e) => e.userId),
      stack: t.starting_stack,
      sb: t.sb,
      bb: t.bb,
      handNumber,
    },
    arenaDeck(t.seed, handNumber),
  );
}
function owner(db: DB, t: Tournament, userId: number) {
  if (t.owner_id !== userId && !isPlatform(db, userId))
    throw new AgentError(403, 'Only the organizer can control this tournament.');
}
export function performTournamentAction(
  db: DB,
  id: string,
  userId: number,
  body: { handNumber: number; actionSeq: number; requestId: string; action: PlayerAction },
  timedOut = false,
) {
  return db
    .transaction(() => {
      const t = get(db, id);
      // External IDs are opaque. They can never impersonate a timer request.
      const requestId = `${timedOut ? 'server' : 'client'}:${body.requestId}`;
      const old = db
        .prepare(
          'SELECT action_json, hand_number, action_seq FROM tournament_actions WHERE tournament_id = ? AND user_id = ? AND request_id = ?',
        )
        .get(id, userId, requestId) as
        { action_json: string; hand_number: number; action_seq: number } | undefined;
      if (old) {
        if (
          old.action_json !== JSON.stringify(body.action) ||
          old.hand_number !== body.handNumber ||
          old.action_seq !== body.actionSeq
        )
          throw new AgentError(409, 'This request ID was used for a different action.');
        return { ok: true, duplicate: true };
      }
      if (t.status !== 'running' || !t.round_json)
        throw new AgentError(409, 'Tournament is not running.');
      const previous = JSON.parse(t.round_json) as ArenaRound;
      if (previous.handNumber !== body.handNumber || previous.actionSeq !== body.actionSeq)
        throw new AgentError(409, 'The table has changed. Read state before acting again.');
      let round: ArenaRound;
      try {
        round = actArena(previous, userId, body.action);
      } catch (e) {
        throw new AgentError(400, e instanceof Error ? e.message : 'Invalid action.');
      }
      db.prepare(
        'INSERT INTO tournament_actions(tournament_id,user_id,request_id,hand_number,action_seq,action_json,timed_out,ts) VALUES(?,?,?,?,?,?,?,?)',
      ).run(
        id,
        userId,
        requestId,
        body.handNumber,
        body.actionSeq,
        JSON.stringify(body.action),
        Number(timedOut),
        Date.now(),
      );
      db.prepare(
        'UPDATE tournament_entries SET timeouts = timeouts + ?, last_seen = CASE WHEN ? = 0 THEN ? ELSE last_seen END WHERE tournament_id = ? AND user_id = ?',
      ).run(Number(timedOut), Number(timedOut), Date.now(), id, userId);
      emit(db, id, 'tournament.action', {
        userId,
        handNumber: body.handNumber,
        actionSeq: body.actionSeq,
        action: body.action,
        timedOut,
      });
      if (round.result) {
        const result = round.result;
        for (const p of result.net)
          db.prepare(
            'UPDATE tournament_entries SET net = net + ?, hands = hands + 1, wins = wins + ? WHERE tournament_id = ? AND user_id = ?',
          ).run(p.net, Number(p.net > 0), id, p.userId);
        db.prepare(
          'INSERT INTO tournament_results(tournament_id,hand_number,result_json) VALUES(?,?,?)',
        ).run(id, round.handNumber, JSON.stringify(result));
        const completed = t.completed_hands + 1;
        const done = completed >= t.hand_limit;
        if (!done) round = freshRound(db, t, completed + 1);
        db.prepare(
          'UPDATE tournaments SET completed_hands = ?, status = ?, round_json = ?, last_result = ?, deadline = ?, updated_at = ? WHERE id = ?',
        ).run(
          completed,
          done ? 'completed' : 'running',
          JSON.stringify(round),
          JSON.stringify(result),
          done ? null : Date.now() + t.action_seconds * 1000,
          Date.now(),
          id,
        );
        emit(db, id, 'tournament.hand_completed', result);
        if (done)
          emit(db, id, 'tournament.completed', {
            completedHands: completed,
            seed: t.seed,
            seedCommitment: seedCommitment(t.seed),
          });
      } else
        db.prepare(
          'UPDATE tournaments SET round_json = ?, deadline = ?, updated_at = ? WHERE id = ?',
        ).run(JSON.stringify(round), Date.now() + t.action_seconds * 1000, Date.now(), id);
      emit(db, id, 'tournament.state', {
        handNumber: round.handNumber,
        actionSeq: round.actionSeq,
        toActUserId: round.result ? null : round.playerIds[round.betting.toAct!],
        board: arenaView(round, null).board,
      });
      return { ok: true, duplicate: false };
    })
    .immediate();
}

/** Persisted deadlines, no background agents or provider calls. */
export function tickTournaments(db: DB, now = Date.now()): void {
  if (!db.open) return;
  const due = db
    .prepare("SELECT * FROM tournaments WHERE status = 'running' AND deadline <= ? LIMIT 50")
    .all(now) as Tournament[];
  for (const t of due) {
    try {
      const es = entries(db, t.id);
      if (!es.some((e) => now - e.lastSeen < 90_000)) {
        db.prepare(
          "UPDATE tournaments SET status = 'paused', deadline = NULL, updated_at = ? WHERE id = ?",
        ).run(now, t.id);
        emit(db, t.id, 'tournament.paused', {
          reason: 'All entrants are offline. The organizer can resume.',
        });
        continue;
      }
      if (!t.round_json) continue;
      const round = JSON.parse(t.round_json) as ArenaRound;
      const la = legalActions(round.betting);
      if (!la || round.result) continue;
      performTournamentAction(
        db,
        t.id,
        round.playerIds[la.seat]!,
        {
          handNumber: round.handNumber,
          actionSeq: round.actionSeq,
          requestId: `timeout-${round.handNumber}-${round.actionSeq}`,
          action: { type: la.canCheck ? 'check' : 'fold' },
        },
        true,
      );
    } catch {
      // One invalid persisted round must not stop every other league's clock.
      db.prepare(
        "UPDATE tournaments SET status = 'paused', deadline = NULL, updated_at = ? WHERE id = ?",
      ).run(now, t.id);
      emit(db, t.id, 'tournament.paused', {
        reason: 'Automatic action failed. Organizer review is required before resuming.',
      });
    }
  }
}

export function registerTournaments(app: FastifyInstance, db: DB): void {
  app.get('/api/tournaments', async () => ({
    tournaments: (
      db
        .prepare(
          'SELECT t.*, (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id) AS entrant_count FROM tournaments t ORDER BY t.created_at DESC LIMIT 100',
        )
        .all() as (Tournament & { entrant_count: number })[]
    ).map((t) => ({ ...summary(t), entrantCount: t.entrant_count })),
  }));
  app.post(
    '/api/tournaments',
    {
      preHandler: [
        requireUser(db),
        rateLimit({ name: 'create-tournament', limit: 10, windowMs: 3600_000, by: 'user' }),
      ],
    },
    async (req, reply) => {
      const parsed = z
        .object({
          name: z.string().trim().min(3).max(80),
          description: z.string().max(2000).default(''),
          capacity: z.number().int().min(2).max(9).default(6),
          handLimit: z.number().int().min(10).max(10000).default(1000),
          startingStack: z.number().int().min(100).max(1000000).default(2000),
          sb: z.number().int().min(1).max(10000).default(10),
          bb: z.number().int().min(2).max(20000).default(20),
          actionSeconds: z.number().int().min(10).max(300).default(60),
          prizeDescription: z.string().max(1000).default(''),
          rules: z.string().max(4000).default(''),
        })
        .safeParse(req.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: 'Check the tournament settings (2–9 entrants, 10–10,000 hands).' });
      const b = parsed.data;
      if (b.bb < b.sb || b.startingStack < 2 * b.bb)
        return reply.code(400).send({
          error: 'Big blind must cover the small blind; stack must cover at least two big blinds.',
        });
      const open = db
        .prepare(
          "SELECT COUNT(*) AS n FROM tournaments WHERE owner_id = ? AND status NOT IN ('completed','cancelled')",
        )
        .get(req.userId) as { n: number };
      if (open.n >= 5)
        return reply.code(409).send({
          error: 'Finish or cancel an existing tournament first (five active tournaments maximum).',
        });
      const id = randomBytes(10).toString('hex');
      const now = Date.now();
      db.prepare(
        'INSERT INTO tournaments(id,owner_id,name,description,capacity,hand_limit,starting_stack,sb,bb,action_seconds,prize_description,rules,seed,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
        id,
        req.userId,
        b.name,
        b.description,
        b.capacity,
        b.handLimit,
        b.startingStack,
        b.sb,
        b.bb,
        b.actionSeconds,
        b.prizeDescription,
        b.rules,
        randomBytes(32).toString('hex'),
        now,
        now,
      );
      return { id };
    },
  );
  app.get('/api/tournaments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.headers.authorization ? scopeUser(db, req, 'tournament', id) : null;
    if (userId !== null)
      db.prepare(
        'UPDATE tournament_entries SET last_seen = ? WHERE tournament_id = ? AND user_id = ?',
      ).run(Date.now(), id, userId);
    return reply.header('cache-control', 'no-store').send(tournamentView(db, id, userId));
  });
  app.post('/api/tournaments/:id/enroll', { preHandler: requireUser(db) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({ agentName: z.string().trim().min(2).max(48), kind: z.enum(['human', 'agent']) })
      .safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'Enter a participant name and choose human or agent.' });
    return db
      .transaction(() => {
        const t = get(db, id);
        const es = entries(db, id);
        if (t.status !== 'registration') throw new AgentError(409, 'Enrollment is closed.');
        if (es.some((e) => e.userId === req.userId)) return { ok: true };
        if (es.length >= t.capacity) throw new AgentError(409, 'This tournament is full.');
        if (es.some((e) => e.agentName === parsed.data.agentName))
          throw new AgentError(409, 'That participant name is already taken.');
        if (isPlatform(db, req.userId))
          throw new AgentError(403, 'Use a player account to enter tournaments.');
        db.prepare(
          'INSERT INTO tournament_entries(tournament_id,user_id,agent_name,kind,joined_at,last_seen) VALUES(?,?,?,?,?,?)',
        ).run(id, req.userId, parsed.data.agentName, parsed.data.kind, Date.now(), Date.now());
        emit(db, id, 'tournament.enrolled', { userId: req.userId, ...parsed.data });
        return { ok: true };
      })
      .immediate();
  });
  app.post('/api/tournaments/:id/withdraw', { preHandler: requireUser(db) }, async (req) => {
    const { id } = req.params as { id: string };
    const t = get(db, id);
    if (t.status !== 'registration')
      throw new AgentError(409, 'Enrollment is locked after a tournament starts.');
    db.prepare('DELETE FROM tournament_entries WHERE tournament_id = ? AND user_id = ?').run(
      id,
      req.userId,
    );
    emit(db, id, 'tournament.withdrawn', { userId: req.userId });
    return { ok: true };
  });
  app.post('/api/tournaments/:id/control', { preHandler: requireUser(db) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({ action: z.enum(['start', 'pause', 'resume', 'cancel']) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid tournament control.' });
    return db
      .transaction(() => {
        const t = get(db, id);
        owner(db, t, req.userId);
        const action = parsed.data.action;
        const status = {
          start: 'running',
          pause: 'paused',
          resume: 'running',
          cancel: 'cancelled',
        }[action];
        const allowed = {
          start: ['registration'],
          pause: ['running'],
          resume: ['paused'],
          cancel: ['registration', 'paused'],
        }[action];
        if (!allowed.includes(t.status))
          throw new AgentError(
            409,
            'That control is not available now. Pause before cancelling a running league.',
          );
        if (action === 'start' && entries(db, id).length < 2)
          throw new AgentError(409, 'At least two entrants are required.');
        const round = action === 'start' ? JSON.stringify(freshRound(db, t, 1)) : t.round_json;
        db.prepare(
          'UPDATE tournaments SET status = ?, round_json = ?, deadline = ?, updated_at = ? WHERE id = ?',
        ).run(
          status,
          round,
          status === 'running' ? Date.now() + t.action_seconds * 1000 : null,
          Date.now(),
          id,
        );
        emit(db, id, `tournament.${action}`, { status });
        return { ok: true };
      })
      .immediate();
  });
  app.post('/api/tournaments/:id/actions', async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = scopeUser(db, req, 'tournament', id, true);
    const parsed = z
      .object({
        handNumber: z.number().int().positive(),
        actionSeq: z.number().int().nonnegative(),
        requestId: z.string().min(1).max(80),
        action: z.object({
          type: z.enum(['fold', 'check', 'call', 'bet', 'raise']),
          amount: z.number().int().positive().max(1000000).optional(),
        }),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: 'An action requires handNumber, actionSeq, requestId and a valid decision.',
      });
    return performTournamentAction(db, id, userId, parsed.data);
  });
  app.get('/api/tournaments/:id/results', async (req, reply) => {
    const { id } = req.params as { id: string };
    get(db, id);
    const parsed = z
      .object({ after: z.coerce.number().int().nonnegative().safe().default(0) })
      .safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid result cursor.' });
    return {
      results: (
        db
          .prepare(
            'SELECT result_json FROM tournament_results WHERE tournament_id = ? AND hand_number > ? ORDER BY hand_number LIMIT 100',
          )
          .all(id, parsed.data.after) as { result_json: string }[]
      ).map((r) => JSON.parse(r.result_json)),
    };
  });
  app.get('/api/tournaments/:id/audit', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = get(db, id);
    if (t.status !== 'completed')
      return reply
        .code(409)
        .send({ error: 'The complete audit opens after the league completes.' });
    const parsed = z
      .object({ after: z.coerce.number().int().nonnegative().safe().default(0) })
      .safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid audit cursor.' });
    const actions = (
      db
        .prepare(
          'SELECT rowid AS cursor, user_id AS userId, hand_number AS handNumber, action_seq AS actionSeq, action_json, timed_out AS timedOut FROM tournament_actions WHERE tournament_id = ? AND rowid > ? ORDER BY rowid LIMIT 500',
        )
        .all(id, parsed.data.after) as {
        cursor: number;
        userId: number;
        handNumber: number;
        actionSeq: number;
        action_json: string;
        timedOut: number;
      }[]
    ).map(({ action_json, ...a }) => ({ ...a, action: JSON.parse(action_json) }));
    return {
      ...summary(t),
      version: 1,
      seed: t.seed,
      playerIds: entries(db, id).map((e) => e.userId),
      actions,
      nextCursor: actions.at(-1)?.cursor ?? parsed.data.after,
    };
  });
  app.put('/api/tournaments/:id/awards', { preHandler: requireUser(db) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = get(db, id);
    owner(db, t, req.userId);
    if (t.status !== 'completed')
      throw new AgentError(409, 'Record awards after the tournament completes.');
    const parsed = z
      .object({ userId: z.number().int(), note: z.string().trim().min(1).max(500) })
      .safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'Choose an entrant and provide an award note.' });
    const res = db
      .prepare(
        'UPDATE tournament_entries SET award_note = ? WHERE tournament_id = ? AND user_id = ?',
      )
      .run(parsed.data.note, id, parsed.data.userId);
    if (!res.changes) return reply.code(404).send({ error: 'Entrant not found.' });
    emit(db, id, 'tournament.award_recorded', { recordedBy: req.userId, ...parsed.data });
    return { ok: true };
  });
  const timer = setInterval(() => {
    try {
      tickTournaments(db);
    } catch (err) {
      app.log.error(err, 'tournament timer failed');
    }
  }, 1000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}
