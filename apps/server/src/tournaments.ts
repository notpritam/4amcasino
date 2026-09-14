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
import { requireUser, userForToken } from './auth.js';
import { AgentError, scopeUser, bearerToken } from './agentAccess.js';
import { publishAgentEvent } from './agentEvents.js';
import { arenaDeck, seedCommitment } from './arenaRandom.js';
import { rateLimit } from './limits.js';
import { isPlatform, requirePlatform } from './platform.js';
import {
  getTournament as get,
  policyOf,
  parsePolicy,
  tournamentInput,
  safeBroadcastUrl,
  type Tournament,
} from './tournamentConfig.js';
import {
  economyView,
  playerEarnings,
  earningsRows,
  recordEntry,
  withdrawEntry,
  fundTournament,
  startRewards,
  recordHandEconomy,
  completePrizes,
  cancelBeforeStart,
  recordTournamentSettlement,
  settlementRows,
} from './tournamentEconomy.js';

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
  stack: number;
  eliminatedHand: number | null;
}
function entries(db: DB, id: string): Entry[] {
  return db
    .prepare(
      'SELECT user_id AS userId, agent_name AS agentName, kind, joined_at AS joinedAt, last_seen AS lastSeen, net, hands, wins, timeouts, award_note AS awardNote, stack, eliminated_hand AS eliminatedHand FROM tournament_entries WHERE tournament_id = ? ORDER BY joined_at, user_id',
    )
    .all(id) as Entry[];
}
function summary(t: Tournament) {
  const policy = policyOf(t);
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
    format: policy.format,
    policy,
    approvalStatus: t.approval_status,
    reviewNote: t.review_note,
    revision: t.revision,
    termsLocked: !!t.terms_locked,
    scheduleNote: t.schedule_note,
    dealing: 'server-dealt' as const,
    entryFee: policy.entryFee,
    seedCommitment: seedCommitment(t.seed),
  };
}
export function tournamentView(db: DB, id: string, viewerId: number | null) {
  const t = get(db, id);
  const policy = policyOf(t);
  const score = (e: Entry) =>
    policy.format === 'knockout'
      ? e.eliminatedHand === null
        ? t.hand_limit + 1 + e.stack
        : e.eliminatedHand
      : e.net;
  const sorted = entries(db, id).sort(
    (a, b) => score(b) - score(a) || a.joinedAt - b.joinedAt || a.userId - b.userId,
  );
  const ranked = sorted.map((e, i) => ({
    ...e,
    ...playerEarnings(db, id, e.userId),
    rank: sorted.findIndex((p) => score(p) === score(e)) + 1,
    bbPer100: e.hands ? Math.round((e.net / t.bb / e.hands) * 10000) / 100 : 0,
    online: Date.now() - e.lastSeen < 90_000,
  }));
  return {
    ...summary(t),
    finance: economyView(db, id),
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
  const p = policyOf(t),
    all = entries(db, t.id);
  const es = p.format === 'knockout' ? all.filter((e) => e.stack > 0) : all;
  const previous = t.round_json ? (JSON.parse(t.round_json) as ArenaRound) : null;
  const previousButton = previous?.playerIds[previous.betting.buttonSeat];
  const oldIndex = all.findIndex((e) => e.userId === previousButton);
  const buttonUserId =
    oldIndex < 0
      ? es[0]?.userId
      : Array.from({ length: all.length }, (_, i) => all[(oldIndex + i + 1) % all.length]!).find(
          (e) => es.some((a) => a.userId === e.userId),
        )?.userId;
  const multiplier =
    p.format === 'knockout'
      ? 2 ** Math.min(16, Math.floor((handNumber - 1) / p.blindEveryHands))
      : 1;
  return createArenaRound(
    {
      playerIds: es.map((e) => e.userId),
      stack: t.starting_stack,
      sb: Math.min(9_000_000, t.sb * multiplier),
      bb: Math.min(9_000_000, t.bb * multiplier),
      handNumber,
      ...(p.format === 'knockout' ? { stacks: es.map((e) => e.stack), buttonUserId } : {}),
      ...(t.revision > 0
        ? {
            commission: { houseBps: p.houseBps, prizeBps: p.prizeBps },
            revealAllAfterHand: p.revealAllAfterHand,
          }
        : {}),
    },
    arenaDeck(t.seed, handNumber),
  );
}
function canView(db: DB, t: Tournament, userId: number | null) {
  if (
    t.approval_status !== 'approved' &&
    (userId === null || (t.owner_id !== userId && !isPlatform(db, userId)))
  )
    throw new AgentError(404, 'Tournament not found.');
}
function canWatch(db: DB, t: Tournament, userId: number | null) {
  canView(db, t, userId);
  if (
    !policyOf(t).publicWatch &&
    (userId === null ||
      (t.owner_id !== userId &&
        !isPlatform(db, userId) &&
        !entries(db, t.id).some((e) => e.userId === userId)))
  )
    throw new AgentError(403, 'Watching is limited to tournament participants.');
}
function finishRound(db: DB, t: Tournament, initial: ArenaRound, now = Date.now()): ArenaRound {
  let round = initial;
  while (round.result) {
    const result = round.result,
      p = policyOf(t);
    recordHandEconomy(db, t.id, result);
    for (const r of result.net) {
      const stack = r.endStack ?? t.starting_stack + r.net;
      db.prepare(
        'UPDATE tournament_entries SET net=net+?,hands=hands+1,wins=wins+?,stack=?,eliminated_hand=CASE WHEN ?=1 AND ?<=0 THEN ? ELSE eliminated_hand END WHERE tournament_id=? AND user_id=?',
      ).run(
        r.net,
        Number(r.net > 0),
        p.format === 'knockout' ? stack : t.starting_stack,
        Number(p.format === 'knockout'),
        stack,
        round.handNumber,
        t.id,
        r.userId,
      );
    }
    db.prepare(
      'INSERT INTO tournament_results(tournament_id,hand_number,result_json) VALUES(?,?,?)',
    ).run(t.id, round.handNumber, JSON.stringify(result));
    const completed = round.handNumber;
    const done =
      completed >= t.hand_limit ||
      (p.format === 'knockout' && entries(db, t.id).filter((e) => e.stack > 0).length <= 1);
    db.prepare(
      'UPDATE tournaments SET completed_hands=?,status=?,round_json=?,last_result=?,deadline=NULL,updated_at=? WHERE id=?',
    ).run(
      completed,
      done ? 'completed' : 'running',
      JSON.stringify(round),
      JSON.stringify(result),
      now,
      t.id,
    );
    emit(db, t.id, 'tournament.hand_completed', result);
    if (done) {
      completePrizes(db, t.id, tournamentView(db, t.id, null).entries, p.payoutBps);
      emit(db, t.id, 'tournament.completed', {
        completedHands: completed,
        seed: t.seed,
        seedCommitment: seedCommitment(t.seed),
      });
      return round;
    }
    t = get(db, t.id);
    round = freshRound(db, t, completed + 1);
  }
  db.prepare('UPDATE tournaments SET round_json=?,deadline=?,updated_at=? WHERE id=?').run(
    JSON.stringify(round),
    now + t.action_seconds * 1000,
    now,
    t.id,
  );
  return round;
}
function startTournament(db: DB, t: Tournament, now = Date.now()) {
  if (t.approval_status !== 'approved' || t.status !== 'registration')
    throw new AgentError(409, 'Only an approved, open tournament can start.');
  if (entries(db, t.id).length < 2)
    throw new AgentError(409, 'At least two entrants are required.');
  const p = policyOf(t);
  fundTournament(db, t.id, p.guaranteedPool, 'guarantee', 'guarantee');
  startRewards(db, t.id, p);
  db.prepare(
    "UPDATE tournaments SET status='running',terms_locked=1,schedule_note='',updated_at=? WHERE id=?",
  ).run(now, t.id);
  finishRound(db, t, freshRound(db, t, 1), now);
  emit(db, t.id, 'tournament.start', { status: get(db, t.id).status });
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
      round = finishRound(db, t, round);
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
  db.prepare(
    "UPDATE tournaments SET schedule_note='At least two entrants are required.' WHERE status='registration' AND approval_status='approved' AND policy_json!='' AND json_extract(policy_json,'$.startsAt')<=? AND (SELECT COUNT(*) FROM tournament_entries WHERE tournament_id=tournaments.id)<2",
  ).run(now);
  const scheduled = db
    .prepare(
      "SELECT * FROM tournaments WHERE status='registration' AND approval_status='approved' AND policy_json!='' AND json_extract(policy_json,'$.startsAt')<=? AND (SELECT COUNT(*) FROM tournament_entries WHERE tournament_id=tournaments.id)>=2 ORDER BY updated_at,created_at LIMIT 50",
    )
    .all(now) as Tournament[];
  for (const t of scheduled) {
    try {
      db.transaction(() => startTournament(db, get(db, t.id), now)).immediate();
    } catch (e) {
      db.prepare('UPDATE tournaments SET schedule_note=?,updated_at=? WHERE id=?').run(
        e instanceof AgentError ? e.message : 'Scheduled start needs organizer review.',
        now,
        t.id,
      );
    }
  }
  const due = db
    .prepare("SELECT * FROM tournaments WHERE status = 'running' AND deadline <= ? LIMIT 50")
    .all(now) as Tournament[];
  for (const t of due) {
    try {
      const es = entries(db, t.id).filter(
        (e) => policyOf(t).format !== 'knockout' || e.eliminatedHand === null,
      );
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
  app.get('/api/tournaments', async (req) => ({
    tournaments: (
      db
        .prepare(
          "SELECT t.*, (SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id = t.id) AS entrant_count FROM tournaments t WHERE approval_status='approved' OR owner_id=? ORDER BY t.created_at DESC LIMIT 100",
        )
        .all(userForToken(db, bearerToken(req)) ?? -1) as (Tournament & { entrant_count: number })[]
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
      const parsed = tournamentInput.safeParse(req.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: 'Check the tournament settings (2–9 entrants, 10–10,000 hands).' });
      const b = parsed.data;
      const policy = parsePolicy((req.body as { policy?: unknown }).policy, b.capacity);
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
      const platform = isPlatform(db, req.userId);
      db.prepare(
        'UPDATE tournaments SET approval_status=?,status=?,policy_json=?,revision=1 WHERE id=?',
      ).run(
        platform ? 'approved' : 'pending',
        platform ? 'registration' : 'pending',
        JSON.stringify(policy),
        id,
      );
      db.prepare(
        'INSERT INTO tournament_reviews(tournament_id,revision,action,note,actor_id,ts) VALUES(?,1,?,?,?,?)',
      ).run(id, platform ? 'published' : 'submitted', '', req.userId, now);
      return { id };
    },
  );
  app.get('/api/tournaments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.headers.authorization ? scopeUser(db, req, 'tournament', id) : null;
    const t = get(db, id);
    canView(db, t, userId);
    if (userId !== null)
      db.prepare(
        'UPDATE tournament_entries SET last_seen = ? WHERE tournament_id = ? AND user_id = ?',
      ).run(Date.now(), id, userId);
    const state = tournamentView(db, id, userId);
    if (
      !policyOf(t).publicWatch &&
      (userId === null ||
        (userId !== t.owner_id &&
          !isPlatform(db, userId) &&
          !state.entries.some((e) => e.userId === userId)))
    ) {
      state.round = null;
      state.lastResult = null;
      delete state.seed;
    }
    return reply.header('cache-control', 'no-store').send(state);
  });
  app.post('/api/tournaments/:id/enroll', { preHandler: requireUser(db) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        agentName: z.string().trim().min(2).max(48),
        kind: z.enum(['human', 'agent']),
        acceptedRevision: z.number().int().nonnegative().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'Enter a participant name and choose human or agent.' });
    return db
      .transaction(() => {
        const t = get(db, id);
        const es = entries(db, id);
        if (t.status !== 'registration' || t.approval_status !== 'approved')
          throw new AgentError(409, 'Enrollment opens after platform approval.');
        if (es.some((e) => e.userId === req.userId)) return { ok: true };
        if (t.revision > 0 && parsed.data.acceptedRevision !== t.revision)
          throw new AgentError(
            409,
            'Read and accept the current tournament rules before enrolling.',
          );
        if (es.length >= t.capacity) throw new AgentError(409, 'This tournament is full.');
        if (es.some((e) => e.agentName === parsed.data.agentName))
          throw new AgentError(409, 'That participant name is already taken.');
        if (isPlatform(db, req.userId))
          throw new AgentError(403, 'Use a player account to enter tournaments.');
        db.prepare(
          'INSERT INTO tournament_entries(tournament_id,user_id,agent_name,kind,joined_at,last_seen,stack,accepted_revision) VALUES(?,?,?,?,?,?,?,?)',
        ).run(
          id,
          req.userId,
          parsed.data.agentName,
          parsed.data.kind,
          Date.now(),
          Date.now(),
          t.starting_stack,
          t.revision,
        );
        const p = policyOf(t);
        db.prepare('UPDATE tournaments SET terms_locked=1 WHERE id=?').run(id);
        fundTournament(db, id, p.guaranteedPool, 'guarantee', 'guarantee');
        recordEntry(db, id, req.userId, p.entryFee);
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
    db.transaction(() => {
      withdrawEntry(db, id, req.userId);
      db.prepare('DELETE FROM tournament_entries WHERE tournament_id = ? AND user_id = ?').run(
        id,
        req.userId,
      );
    }).immediate();
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
        if (action === 'start') {
          startTournament(db, t);
          return { ok: true };
        }
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
          cancel: ['registration', 'paused', 'pending', 'rejected'],
        }[action];
        if (!allowed.includes(t.status))
          throw new AgentError(
            409,
            'That control is not available now. Pause before cancelling a running league.',
          );
        if (action === 'cancel') {
          if (t.round_json)
            completePrizes(
              db,
              id,
              tournamentView(db, id, req.userId).entries,
              policyOf(t).payoutBps,
            );
          else cancelBeforeStart(db, id);
        }
        const round = t.round_json;
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
          amount: z.number().int().positive().max(9000000).optional(),
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
    const t = get(db, id);
    canWatch(db, t, req.headers.authorization ? scopeUser(db, req, 'tournament', id) : null);
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
    canWatch(db, t, req.headers.authorization ? scopeUser(db, req, 'tournament', id) : null);
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
      version: t.revision > 0 ? 2 : 1,
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
  app.put('/api/tournaments/:id/terms', { preHandler: requireUser(db) }, async (req) => {
    const { id } = req.params as { id: string };
    return db
      .transaction(() => {
        const t = get(db, id);
        owner(db, t, req.userId);
        const body = req.body as Record<string, unknown>;
        if (!body || body.revision !== t.revision)
          throw new AgentError(409, 'The tournament changed. Reload before saving.');
        if (t.terms_locked || !['registration', 'pending', 'rejected'].includes(t.status))
          throw new AgentError(
            409,
            'Terms are locked after the first enrollment. Create a new tournament for different rules.',
          );
        const parsed = tournamentInput.safeParse({ ...summary(t), ...body });
        if (!parsed.success) throw new AgentError(400, 'Check the tournament settings.');
        const b = parsed.data;
        if (b.bb < b.sb || b.startingStack < 2 * b.bb)
          throw new AgentError(400, 'Starting stack must cover two big blinds.');
        const policy = parsePolicy(
          { ...policyOf(t), ...((body.policy as object) ?? {}), revealAllAfterHand: true },
          b.capacity,
        );
        const approved = isPlatform(db, req.userId),
          revision = t.revision + 1;
        db.prepare(
          'UPDATE tournaments SET name=?,description=?,capacity=?,hand_limit=?,starting_stack=?,sb=?,bb=?,action_seconds=?,prize_description=?,rules=?,policy_json=?,revision=?,status=?,approval_status=?,review_note=?,schedule_note=?,updated_at=? WHERE id=?',
        ).run(
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
          JSON.stringify(policy),
          revision,
          approved ? 'registration' : 'pending',
          approved ? 'approved' : 'pending',
          '',
          '',
          Date.now(),
          id,
        );
        db.prepare(
          'INSERT INTO tournament_reviews(tournament_id,revision,action,note,actor_id,ts) VALUES(?,?,?,?,?,?)',
        ).run(
          id,
          revision,
          approved ? 'published' : 'submitted',
          'Terms updated',
          req.userId,
          Date.now(),
        );
        emit(db, id, 'tournament.terms_updated', {
          revision,
          approvalStatus: approved ? 'approved' : 'pending',
        });
        return { ok: true, revision };
      })
      .immediate();
  });
  app.put('/api/tournaments/:id/media', { preHandler: requirePlatform(db) }, async (req) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({
        streamUrl: z
          .string()
          .max(1000)
          .refine((v) => safeBroadcastUrl(v)),
        meetUrl: z
          .string()
          .max(1000)
          .refine((v) => safeBroadcastUrl(v, true)),
      })
      .safeParse(req.body);
    if (!b.success)
      throw new AgentError(400, 'Use a YouTube/Twitch stream and a Google Meet HTTPS link.');
    const t = get(db, id),
      p = { ...policyOf(t), ...b.data };
    db.transaction(() => {
      db.prepare('UPDATE tournaments SET policy_json=?,updated_at=? WHERE id=?').run(
        JSON.stringify(p),
        Date.now(),
        id,
      );
      db.prepare(
        'INSERT INTO tournament_reviews(tournament_id,revision,action,note,actor_id,ts) VALUES(?,?,?,?,?,?)',
      ).run(id, t.revision, 'broadcast_links', JSON.stringify(b.data), req.userId, Date.now());
    }).immediate();
    return { ok: true };
  });
  app.post(
    '/api/admin/tournaments/:id/review',
    { preHandler: requirePlatform(db) },
    async (req) => {
      const { id } = req.params as { id: string };
      const b = z
        .object({
          revision: z.number().int().nonnegative(),
          approve: z.boolean(),
          note: z.string().trim().max(1000),
        })
        .safeParse(req.body);
      if (!b.success) throw new AgentError(400, 'Provide the current revision and a review note.');
      return db
        .transaction(() => {
          const t = get(db, id);
          if (
            t.revision !== b.data.revision ||
            t.approval_status !== 'pending' ||
            t.status !== 'pending'
          )
            throw new AgentError(
              409,
              'This proposal has changed, was cancelled, or was already reviewed. Reload it.',
            );
          db.prepare(
            'UPDATE tournaments SET status=?,approval_status=?,review_note=?,updated_at=? WHERE id=?',
          ).run(
            b.data.approve ? 'registration' : 'rejected',
            b.data.approve ? 'approved' : 'rejected',
            b.data.note,
            Date.now(),
            id,
          );
          db.prepare(
            'INSERT INTO tournament_reviews(tournament_id,revision,action,note,actor_id,ts) VALUES(?,?,?,?,?,?)',
          ).run(
            id,
            t.revision,
            b.data.approve ? 'approved' : 'rejected',
            b.data.note,
            req.userId,
            Date.now(),
          );
          emit(db, id, 'tournament.reviewed', { approved: b.data.approve, revision: t.revision });
          return { ok: true };
        })
        .immediate();
    },
  );
  app.get('/api/admin/tournaments', { preHandler: requirePlatform(db) }, async () => {
    const ts = db
      .prepare('SELECT * FROM tournaments ORDER BY created_at DESC LIMIT 200')
      .all() as Tournament[];
    const finances = (db.prepare('SELECT id FROM tournaments').all() as { id: string }[]).map((t) =>
      economyView(db, t.id),
    );
    const earnings = earningsRows(db);
    return {
      tournaments: ts.map((t) => ({ ...summary(t), entrantCount: entries(db, t.id).length })),
      earnings,
      totals: {
        house: finances.reduce((a, f) => a + f.house, 0),
        pool: finances.reduce((a, f) => a + f.pool, 0),
        prizes: finances.reduce((a, f) => a + f.prizes, 0),
        recordedPaid: earnings.reduce((a, e) => a + e.recordedPaid, 0),
      },
    };
  });
  app.get('/api/admin/tournaments/:id/audit', { preHandler: requirePlatform(db) }, async (req) => {
    const { id } = req.params as { id: string };
    get(db, id);
    return {
      reviews: db
        .prepare('SELECT * FROM tournament_reviews WHERE tournament_id=? ORDER BY id')
        .all(id),
      settlements: settlementRows(db, id),
    };
  });
  app.get('/api/me/tournament-earnings', { preHandler: requireUser(db) }, async (req) => ({
    earnings: earningsRows(db, req.userId),
  }));
  app.post(
    '/api/admin/tournaments/:id/settlements',
    { preHandler: requirePlatform(db) },
    async (req) => {
      const { id } = req.params as { id: string };
      get(db, id);
      const b = z
        .object({
          userId: z.number().int().positive(),
          amount: z
            .number()
            .int()
            .safe()
            .refine((n) => n !== 0),
          requestId: z.string().min(1).max(80),
          note: z.string().trim().min(1).max(500),
        })
        .safeParse(req.body);
      if (!b.success)
        throw new AgentError(400, 'Choose a player, signed chip amount and receipt note.');
      recordTournamentSettlement(
        db,
        id,
        b.data.userId,
        b.data.amount,
        b.data.requestId,
        b.data.note,
        req.userId,
      );
      return { ok: true };
    },
  );
  app.get('/api/tournaments/:id/watch', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = get(db, id);
    canWatch(db, t, null);
    return reply.header('cache-control', 'no-store').send(tournamentView(db, id, null));
  });
  app.get('/api/tournaments/:id/hands/:hand', async (req, reply) => {
    const { id, hand } = req.params as { id: string; hand: string };
    const t = get(db, id);
    canWatch(db, t, req.headers.authorization ? scopeUser(db, req, 'tournament', id) : null);
    const h = Number(hand);
    if (!Number.isSafeInteger(h) || h < 1) throw new AgentError(400, 'Invalid hand number.');
    const row = db
      .prepare('SELECT result_json FROM tournament_results WHERE tournament_id=? AND hand_number=?')
      .get(id, h) as { result_json: string } | undefined;
    if (!row) throw new AgentError(409, 'Only completed hands can be replayed.');
    const actions = (
      db
        .prepare(
          'SELECT user_id AS userId,action_seq AS actionSeq,action_json,timed_out AS timedOut,ts FROM tournament_actions WHERE tournament_id=? AND hand_number=? ORDER BY action_seq',
        )
        .all(id, h) as {
        userId: number;
        actionSeq: number;
        action_json: string;
        timedOut: number;
        ts: number;
      }[]
    ).map(({ action_json, ...a }) => ({ ...a, action: JSON.parse(action_json) }));
    return reply
      .header('cache-control', 'no-store')
      .send({ result: JSON.parse(row.result_json), actions });
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
