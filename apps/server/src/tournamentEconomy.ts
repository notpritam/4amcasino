import type {
  ArenaResult,
  TournamentEarning,
  TournamentFinance,
  TournamentPolicy,
} from '@4am/shared';
import type { DB } from './db.js';
import { AgentError } from './agentAccess.js';

/** Whole competition chips. These records never affect the ordinary room ledger. */
const MAX_INPUT_CHIPS = 1_000_000_000_000;
// Terms lock before play, so the published banker is also the historical payee.
// CASE guards malformed or empty legacy JSON; booleans and string IDs are never payees.
const publishedBankerSql = `CASE WHEN json_valid(event.policy_json) THEN
  CASE WHEN json_type(event.policy_json, '$.bankerUserId') = 'integer'
    AND json_extract(event.policy_json, '$.bankerUserId') BETWEEN 1 AND 9007199254740991
    THEN json_extract(event.policy_json, '$.bankerUserId') END END`;
type Account = 'pool' | 'house' | 'banker' | 'guarantee' | 'sponsor' | `player:${number}`;
type Line = { account: Account; delta: number };
type Transaction = { id: number; kind: string; metadata: string; payload: string };
export type PlayerTournamentEarnings = Pick<
  TournamentEarning,
  | 'entryFee'
  | 'joiningReward'
  | 'prize'
  | 'bankerCommission'
  | 'playNet'
  | 'settlementNet'
  | 'recordedPaid'
  | 'outstanding'
>;
export interface TournamentSettlementReceipt {
  id: number;
  tournamentId: string;
  userId: number;
  amount: number;
  requestId: string;
  note: string;
  recordedBy: number;
  createdAt: number;
}

export function initializeTournamentEconomy(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tournament_journal_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id TEXT NOT NULL REFERENCES tournaments(id),
      ref TEXT NOT NULL, kind TEXT NOT NULL, user_id INTEGER REFERENCES users(id),
      metadata TEXT NOT NULL, payload TEXT NOT NULL, ts INTEGER NOT NULL,
      UNIQUE(tournament_id, ref)
    );
    CREATE TABLE IF NOT EXISTS tournament_journal_lines (
      transaction_id INTEGER NOT NULL REFERENCES tournament_journal_transactions(id),
      account TEXT NOT NULL, delta INTEGER NOT NULL CHECK(typeof(delta) = 'integer'),
      PRIMARY KEY(transaction_id, account)
    );
    CREATE INDEX IF NOT EXISTS tournament_journal_player
      ON tournament_journal_lines(account, transaction_id);
    CREATE TABLE IF NOT EXISTS tournament_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id TEXT NOT NULL REFERENCES tournaments(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL CHECK(typeof(amount) = 'integer' AND amount != 0),
      request_id TEXT NOT NULL, note TEXT NOT NULL, recorded_by INTEGER NOT NULL REFERENCES users(id),
      ts INTEGER NOT NULL, UNIQUE(tournament_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS tournament_settlements_player
      ON tournament_settlements(user_id, tournament_id);
    -- The immutable header commits to every line. A historical transaction
    -- cannot be changed by appending a previously absent account afterward.
    CREATE TRIGGER IF NOT EXISTS tournament_journal_lines_committed_payload
      BEFORE INSERT ON tournament_journal_lines BEGIN
        SELECT RAISE(ABORT, 'Tournament accounting records are immutable.')
        WHERE NOT EXISTS (
          SELECT 1 FROM tournament_journal_transactions t, json_each(t.payload, '$.lines') line
          WHERE t.id = NEW.transaction_id
            AND json_extract(line.value, '$.account') = NEW.account
            AND json_extract(line.value, '$.delta') = NEW.delta
        );
      END;
  `);
  for (const table of [
    'tournament_journal_transactions',
    'tournament_journal_lines',
    'tournament_settlements',
  ]) {
    for (const operation of ['UPDATE', 'DELETE']) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_immutable_${operation.toLowerCase()}
        BEFORE ${operation} ON ${table} BEGIN
          SELECT RAISE(ABORT, 'Tournament accounting records are immutable.');
        END;`);
    }
  }
}

function atomic<T>(db: DB, work: () => T): T {
  // better-sqlite3 uses a savepoint when an enclosing lifecycle transaction exists.
  return db.transaction(work).immediate();
}
function chips(value: number, label: string, signed = false, limit = MAX_INPUT_CHIPS): number {
  if (!Number.isSafeInteger(value) || Math.abs(value) > limit || (!signed && value < 0))
    throw new AgentError(400, `${label} must be whole chips within the supported limit.`);
  return value;
}
function userId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new AgentError(400, 'Invalid player ID.');
}
function reference(value: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 200)
    throw new AgentError(400, 'A request reference of at most 200 characters is required.');
}
function tournament(db: DB, id: string): { status: string } {
  const row = db.prepare('SELECT status FROM tournaments WHERE id = ?').get(id) as
    { status: string } | undefined;
  if (!row) throw new AgentError(404, 'Tournament not found.');
  return row;
}
function transaction(db: DB, id: string, ref: string): Transaction | undefined {
  return db
    .prepare(
      `SELECT id, kind, metadata, payload FROM tournament_journal_transactions
    WHERE tournament_id = ? AND ref = ?`,
    )
    .get(id, ref) as Transaction | undefined;
}
function openEconomy(db: DB, id: string): void {
  tournament(db, id);
  if (transaction(db, id, 'prizes') || transaction(db, id, 'cancel-before-start'))
    throw new AgentError(409, 'Tournament accounting is closed after completion or cancellation.');
}
function sum(db: DB, id: string, account: Account, kinds?: string[]): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(l.delta), 0) AS amount
    FROM tournament_journal_lines l JOIN tournament_journal_transactions t ON t.id = l.transaction_id
    WHERE t.tournament_id = ? AND l.account = ?
    ${kinds ? `AND t.kind IN (${kinds.map(() => '?').join(',')})` : ''}`,
    )
    .get(id, account, ...(kinds ?? [])) as { amount: number };
  return chips(row.amount, 'Journal balance', true, Number.MAX_SAFE_INTEGER);
}
function append(
  db: DB,
  id: string,
  ref: string,
  kind: string,
  lines: Line[],
  metadata: object = {},
  player: number | null = null,
): void {
  const normalized = lines
    .map((line) => ({
      account: line.account,
      delta: chips(line.delta, 'Journal transfer', true, Number.MAX_SAFE_INTEGER),
    }))
    .sort((a, b) => a.account.localeCompare(b.account));
  if (new Set(normalized.map((line) => line.account)).size !== normalized.length)
    throw new AgentError(400, 'A journal transfer repeats an account.');
  if (normalized.reduce((total, line) => total + BigInt(line.delta), 0n) !== 0n)
    throw new AgentError(400, 'Tournament transfers must balance to zero.');
  const payload = JSON.stringify({ kind, lines: normalized, metadata, userId: player });
  const prior = transaction(db, id, ref);
  if (prior) {
    if (prior.payload !== payload)
      throw new AgentError(409, 'This reference was used for a different accounting transfer.');
    return;
  }
  for (const line of normalized) {
    const balance = BigInt(sum(db, id, line.account)) + BigInt(line.delta);
    if (balance > BigInt(Number.MAX_SAFE_INTEGER) || balance < -BigInt(Number.MAX_SAFE_INTEGER))
      throw new AgentError(400, 'Journal balance exceeds the supported chip limit.');
    if (line.account === 'pool' && balance < 0n)
      throw new AgentError(409, 'The prize pool cannot fund this transfer.');
  }
  const inserted = db
    .prepare(
      `INSERT INTO tournament_journal_transactions
    (tournament_id, ref, kind, user_id, metadata, payload, ts) VALUES (?,?,?,?,?,?,?)`,
    )
    .run(id, ref, kind, player, JSON.stringify(metadata), payload, Date.now());
  const insertLine = db.prepare(
    'INSERT INTO tournament_journal_lines (transaction_id, account, delta) VALUES (?,?,?)',
  );
  for (const line of normalized) insertLine.run(inserted.lastInsertRowid, line.account, line.delta);
}

/** One debit per enrollment cycle; withdrawal closes that cycle, including zero-fee entry. */
export function recordEntry(db: DB, id: string, player: number, fee: number): void {
  chips(fee, 'Entry fee');
  userId(player);
  atomic(db, () => {
    openEconomy(db, id);
    if (transaction(db, id, 'start'))
      throw new AgentError(409, 'Enrollment is locked after start.');
    const last = db
      .prepare(
        `SELECT kind, metadata FROM tournament_journal_transactions
      WHERE tournament_id = ? AND user_id = ? AND kind IN ('entry', 'withdraw') ORDER BY id DESC LIMIT 1`,
      )
      .get(id, player) as { kind: string; metadata: string } | undefined;
    const previous = last
      ? (JSON.parse(last.metadata) as { fee: number; cycle: number })
      : undefined;
    if (last?.kind === 'entry') {
      if (previous!.fee !== fee)
        throw new AgentError(409, 'An active enrollment already has a different entry fee.');
      return;
    }
    const cycle = (previous?.cycle ?? 0) + 1;
    append(
      db,
      id,
      `entry:${player}:${cycle}`,
      'entry',
      [
        { account: `player:${player}`, delta: -fee },
        { account: 'pool', delta: fee },
      ],
      { fee, cycle },
      player,
    );
  });
}

export function withdrawEntry(db: DB, id: string, player: number): void {
  userId(player);
  atomic(db, () => {
    tournament(db, id);
    if (transaction(db, id, 'start'))
      throw new AgentError(409, 'Entry fees are locked after start.');
    const last = db
      .prepare(
        `SELECT kind, metadata FROM tournament_journal_transactions
      WHERE tournament_id = ? AND user_id = ? AND kind IN ('entry', 'withdraw') ORDER BY id DESC LIMIT 1`,
      )
      .get(id, player) as { kind: string; metadata: string } | undefined;
    if (!last || last.kind === 'withdraw') return;
    const { fee, cycle } = JSON.parse(last.metadata) as { fee: number; cycle: number };
    append(
      db,
      id,
      `withdraw:${player}:${cycle}`,
      'withdraw',
      [
        { account: `player:${player}`, delta: fee },
        { account: 'pool', delta: -fee },
      ],
      { fee, cycle },
      player,
    );
  });
}

/** Guarantees and sponsorships are chip commitments, not evidence of cash collection. */
export function fundTournament(
  db: DB,
  id: string,
  amount: number,
  ref: string,
  source: 'guarantee' | 'sponsor',
): void {
  chips(amount, 'Funding amount');
  reference(ref);
  if (source !== 'guarantee' && source !== 'sponsor')
    throw new AgentError(400, 'Invalid funding source.');
  atomic(db, () => {
    const fullRef = `fund:${ref}`;
    if (!transaction(db, id, fullRef)) openEconomy(db, id);
    append(
      db,
      id,
      fullRef,
      `fund-${source}`,
      [
        { account: source, delta: -amount },
        { account: 'pool', delta: amount },
      ],
      { source, amount },
    );
  });
}

export function startRewards(db: DB, id: string, policy: TournamentPolicy): void {
  chips(policy.joiningReward, 'Joining reward');
  atomic(db, () => {
    const prior = transaction(db, id, 'start');
    if (prior) {
      if ((JSON.parse(prior.metadata) as { reward: number }).reward !== policy.joiningReward)
        throw new AgentError(409, 'Joining rewards were started with different terms.');
      return;
    }
    openEconomy(db, id);
    const entrants = db
      .prepare('SELECT user_id FROM tournament_entries WHERE tournament_id = ? ORDER BY user_id')
      .all(id) as { user_id: number }[];
    const total = chips(
      policy.joiningReward * entrants.length,
      'Total joining rewards',
      false,
      Number.MAX_SAFE_INTEGER,
    );
    append(
      db,
      id,
      'start',
      'joining-reward',
      [
        { account: 'pool', delta: -total },
        ...entrants.map((entry): Line => ({
          account: `player:${entry.user_id}`,
          delta: policy.joiningReward,
        })),
      ],
      { reward: policy.joiningReward },
    );
  });
}

export function recordHandEconomy(db: DB, id: string, result: ArenaResult): void {
  chips(result.handNumber, 'Hand number');
  if (result.handNumber === 0) throw new AgentError(400, 'Hand number must be positive.');
  atomic(db, () => {
    const ref = `hand:${result.handNumber}`;
    if (!transaction(db, id, ref)) openEconomy(db, id);
    const fees = result.fees ?? { banker: 0, house: 0, prize: 0 };
    const lines: Line[] = result.net.map((entry) => {
      userId(entry.userId);
      if (
        !db
          .prepare('SELECT 1 FROM tournament_entries WHERE tournament_id = ? AND user_id = ?')
          .get(id, entry.userId)
      )
        throw new AgentError(400, 'Hand result contains an unknown entrant.');
      return { account: `player:${entry.userId}`, delta: chips(entry.net, 'Hand result', true) };
    });
    lines.push(
      { account: 'banker', delta: chips(fees.banker, 'Banker fee') },
      { account: 'house', delta: chips(fees.house, 'House fee') },
      { account: 'pool', delta: chips(fees.prize, 'Prize contribution') },
    );
    append(db, id, ref, 'hand', lines, { handNumber: result.handNumber });
  });
}

/** Allocate integer pots by largest remainder; a tie uses the smaller sort key. */
function apportion(total: number, weights: number[], keys: number[]): number[] {
  const denominator = weights.reduce((n, value) => n + BigInt(value), 0n);
  if (denominator === 0n)
    throw new AgentError(400, 'Payout percentages must fund an occupied place.');
  const parts = weights.map((weight, i) => {
    const numerator = BigInt(total) * BigInt(weight);
    return {
      i,
      amount: Number(numerator / denominator),
      remainder: numerator % denominator,
      key: keys[i]!,
    };
  });
  let remaining = total - parts.reduce((n, part) => n + part.amount, 0);
  const order = [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.key - b.key : a.remainder > b.remainder ? -1 : 1,
  );
  for (const part of order) {
    if (remaining-- <= 0) break;
    part.amount++;
  }
  return parts.map((part) => part.amount);
}

export function completePrizes(
  db: DB,
  id: string,
  rankings: { userId: number; rank: number }[],
  payoutBps: number[],
): void {
  if (
    !payoutBps.length ||
    payoutBps.length > 100 ||
    payoutBps.some((bps) => !Number.isSafeInteger(bps) || bps < 0 || bps > 10000) ||
    payoutBps.reduce((total, bps) => total + bps, 0) !== 10000
  )
    throw new AgentError(400, 'Payout basis points must total 10000.');
  const sorted = [...rankings].sort((a, b) => a.rank - b.rank || a.userId - b.userId);
  for (const entry of sorted) {
    userId(entry.userId);
    if (!Number.isSafeInteger(entry.rank) || entry.rank < 1)
      throw new AgentError(400, 'Invalid prize rank.');
  }
  if (new Set(sorted.map((entry) => entry.userId)).size !== sorted.length)
    throw new AgentError(400, 'Prize rankings repeat a player.');
  const metadata = { rankings: sorted, payoutBps };
  atomic(db, () => {
    const prior = transaction(db, id, 'prizes');
    if (prior) {
      if (prior.metadata !== JSON.stringify(metadata))
        throw new AgentError(409, 'Prizes were finalized with different rankings or payouts.');
      return;
    }
    openEconomy(db, id);
    const entrants = db
      .prepare('SELECT user_id FROM tournament_entries WHERE tournament_id = ? ORDER BY user_id')
      .all(id) as { user_id: number }[];
    if (
      entrants.length !== sorted.length ||
      entrants.some((entry) => !sorted.some((r) => r.userId === entry.user_id))
    )
      throw new AgentError(400, 'Prize rankings must include every entrant exactly once.');
    const pool = sum(db, id, 'pool');
    if (pool > 0 && !sorted.length)
      throw new AgentError(409, 'A funded pool requires entrants before prizes can complete.');
    const groups: { rank: number; users: number[]; weight: number }[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i]!;
      let group = groups.at(-1);
      if (!group || group.rank !== entry.rank) {
        if (entry.rank !== i + 1)
          throw new AgentError(400, 'Tied ranks must reflect their occupied payout places.');
        group = { rank: entry.rank, users: [], weight: 0 };
        groups.push(group);
      }
      group.users.push(entry.userId);
      group.weight += payoutBps[i] ?? 0;
    }
    const amounts =
      pool > 0
        ? apportion(
            pool,
            groups.map((g) => g.weight),
            groups.map((g) => g.rank),
          )
        : groups.map(() => 0);
    const lines: Line[] = [{ account: 'pool', delta: -pool }];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;
      const prizes = apportion(
        amounts[i]!,
        group.users.map(() => 1),
        group.users,
      );
      group.users.forEach((player, j) =>
        lines.push({ account: `player:${player}`, delta: prizes[j]! }),
      );
    }
    append(db, id, 'prizes', 'prize', lines, metadata);
  });
}

export function cancelBeforeStart(db: DB, id: string): void {
  atomic(db, () => {
    tournament(db, id);
    if (transaction(db, id, 'cancel-before-start')) return;
    if (transaction(db, id, 'start') || transaction(db, id, 'prizes'))
      throw new AgentError(
        409,
        'A started tournament must pay prizes instead of reversing its entries.',
      );
    const entrants = db
      .prepare(
        `SELECT DISTINCT user_id FROM tournament_journal_transactions
      WHERE tournament_id = ? AND kind = 'entry'`,
      )
      .all(id) as { user_id: number }[];
    for (const entry of entrants) withdrawEntry(db, id, entry.user_id);
    const funding = db
      .prepare(
        `SELECT id, ref, metadata FROM tournament_journal_transactions
      WHERE tournament_id = ? AND kind IN ('fund-guarantee', 'fund-sponsor') ORDER BY id`,
      )
      .all(id) as { id: number; ref: string; metadata: string }[];
    for (const original of funding) {
      const { source, amount } = JSON.parse(original.metadata) as {
        source: 'guarantee' | 'sponsor';
        amount: number;
      };
      append(
        db,
        id,
        `refund-funding:${original.id}`,
        `refund-${source}`,
        [
          { account: source, delta: amount },
          { account: 'pool', delta: -amount },
        ],
        { source, amount, originalRef: original.ref },
      );
    }
    if (sum(db, id, 'pool') !== 0)
      throw new AgentError(409, 'The unstarted pool contains unreconciled play.');
    append(db, id, 'cancel-before-start', 'cancel-before-start', []);
  });
}

export function economyView(db: DB, id: string): TournamentFinance {
  tournament(db, id);
  return {
    unit: 'chips',
    pool: sum(db, id, 'pool'),
    banker: sum(db, id, 'banker'),
    house: sum(db, id, 'house'),
    guaranteed: 0 - sum(db, id, 'guarantee'),
    sponsorContributions: 0 - sum(db, id, 'sponsor'),
    entryFees: sum(db, id, 'pool', ['entry', 'withdraw']),
    joiningRewards: 0 - sum(db, id, 'pool', ['joining-reward']),
    prizes: 0 - sum(db, id, 'pool', ['prize']),
  };
}

export function playerEarnings(db: DB, id: string, player: number): PlayerTournamentEarnings {
  userId(player);
  const account: Account = `player:${player}`;
  const entryFee = 0 - sum(db, id, account, ['entry', 'withdraw']);
  const joiningReward = sum(db, id, account, ['joining-reward']);
  const prize = sum(db, id, account, ['prize']);
  const playNet = sum(db, id, account, ['hand']);
  const banker = db
    .prepare(`SELECT ${publishedBankerSql} AS userId FROM tournaments event WHERE event.id = ?`)
    .get(id) as { userId: number | null } | undefined;
  const bankerCommission = banker?.userId === player ? sum(db, id, 'banker') : 0;
  // Fixed-hand leagues reset stacks. Hand net is competition scoring, never a settlement debt.
  const settlementNet = chips(
    joiningReward + prize + bankerCommission - entryFee,
    'Settlement balance',
    true,
    Number.MAX_SAFE_INTEGER,
  );
  const paid = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS amount FROM tournament_settlements
    WHERE tournament_id = ? AND user_id = ?`,
    )
    .get(id, player) as { amount: number };
  const recordedPaid = chips(paid.amount, 'Recorded payments', true, Number.MAX_SAFE_INTEGER);
  const outstanding = chips(
    settlementNet - recordedPaid,
    'Outstanding balance',
    true,
    Number.MAX_SAFE_INTEGER,
  );
  return {
    entryFee,
    joiningReward,
    prize,
    bankerCommission,
    playNet,
    settlementNet,
    recordedPaid,
    outstanding,
  };
}

export function earningsRows(db: DB, player?: number): TournamentEarning[] {
  if (player !== undefined) userId(player);
  const rows = db
    .prepare(
      `WITH participants AS (
      SELECT tournament_id, user_id FROM tournament_entries
      UNION SELECT tournament_id, user_id FROM tournament_settlements
      UNION SELECT t.tournament_id, CAST(SUBSTR(l.account, 8) AS INTEGER) FROM tournament_journal_lines l
        JOIN tournament_journal_transactions t ON t.id = l.transaction_id WHERE l.account LIKE 'player:%'
      UNION SELECT t.tournament_id, ${publishedBankerSql} FROM tournament_journal_lines l
        JOIN tournament_journal_transactions t ON t.id = l.transaction_id
        JOIN tournaments event ON event.id = t.tournament_id WHERE l.account = 'banker'
        GROUP BY t.tournament_id HAVING SUM(l.delta) > 0
    ) SELECT t.id AS tournamentId, t.name AS tournamentName, t.status, p.user_id AS userId,
      COALESCE(e.agent_name, NULLIF(u.display_name, ''), u.username) AS playerName
    FROM participants p JOIN tournaments t ON t.id = p.tournament_id JOIN users u ON u.id = p.user_id
    LEFT JOIN tournament_entries e ON e.tournament_id = p.tournament_id AND e.user_id = p.user_id
    ${player === undefined ? '' : 'WHERE p.user_id = ?'} ORDER BY t.created_at DESC, t.id, p.user_id`,
    )
    .all(...(player === undefined ? [] : [player])) as Omit<
    TournamentEarning,
    keyof PlayerTournamentEarnings
  >[];
  return rows.map((row) => ({ ...row, ...playerEarnings(db, row.tournamentId, row.userId) }));
}

export function settlementRows(db: DB, id: string): TournamentSettlementReceipt[] {
  return db
    .prepare(
      `SELECT id, tournament_id AS tournamentId, user_id AS userId, amount,
    request_id AS requestId, note, recorded_by AS recordedBy, ts AS createdAt
    FROM tournament_settlements WHERE tournament_id = ? ORDER BY id`,
    )
    .all(id) as TournamentSettlementReceipt[];
}

/** Platform authorization belongs to the route. Receipts attest to payments; they never transfer funds. */
export function recordTournamentSettlement(
  db: DB,
  id: string,
  player: number,
  amount: number,
  requestId: string,
  note: string,
  recordedBy: number,
): void {
  userId(player);
  userId(recordedBy);
  chips(amount, 'Settlement amount', true);
  if (!amount) throw new AgentError(400, 'Settlement amount must be nonzero.');
  reference(requestId);
  if (typeof note !== 'string' || note.length > 2000)
    throw new AgentError(400, 'Settlement note must be at most 2000 characters.');
  atomic(db, () => {
    const prior = db
      .prepare(
        `SELECT user_id, amount, note, recorded_by FROM tournament_settlements
      WHERE tournament_id = ? AND request_id = ?`,
      )
      .get(id, requestId) as
      | {
          user_id: number;
          amount: number;
          note: string;
          recorded_by: number;
        }
      | undefined;
    if (prior) {
      if (
        prior.user_id !== player ||
        prior.amount !== amount ||
        prior.note !== note ||
        prior.recorded_by !== recordedBy
      )
        throw new AgentError(409, 'This request ID was used for a different settlement record.');
      return;
    }
    if (!['completed', 'cancelled'].includes(tournament(db, id).status))
      throw new AgentError(409, 'Record settlements only after the tournament has ended.');
    const { outstanding } = playerEarnings(db, id, player);
    if (Math.sign(amount) !== Math.sign(outstanding) || Math.abs(amount) > Math.abs(outstanding))
      throw new AgentError(
        400,
        'Settlement must follow the outstanding direction and cannot overpay.',
      );
    db.prepare(
      `INSERT INTO tournament_settlements
      (tournament_id, user_id, amount, request_id, note, recorded_by, ts) VALUES (?,?,?,?,?,?,?)`,
    ).run(id, player, amount, requestId, note, recordedBy, Date.now());
  });
}
