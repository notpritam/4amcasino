import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../src/db.js';
import { DEFAULT_TOURNAMENT_POLICY, type ArenaResult } from '@4am/shared';
import * as economy from '../src/tournamentEconomy.js';

let db: DB;
const id = 'economy-cup';
beforeEach(() => {
  db = openDb(':memory:');
  economy.initializeTournamentEconomy(db);
  for (const userId of [1, 2, 3, 4]) {
    db.prepare(
      `INSERT INTO users (id,username,auth_hash,auth_salt,pubkey,created_at)
      VALUES (?,?,'hash','salt','key',0)`,
    ).run(userId, `player${userId}`);
  }
  db.prepare(
    `INSERT INTO tournaments
    (id,owner_id,name,capacity,hand_limit,starting_stack,sb,bb,action_seconds,seed,created_at,updated_at)
    VALUES (?,1,'Economy Cup',4,10,1000,5,10,30,'seed',0,0)`,
  ).run(id);
});
afterEach(() => db.close());

function enter(userId: number, fee = 0) {
  db.prepare(
    `INSERT OR IGNORE INTO tournament_entries
    (tournament_id,user_id,agent_name,kind,joined_at,last_seen) VALUES (?,?,?,'human',0,0)`,
  ).run(id, userId, `Player ${userId}`);
  economy.recordEntry(db, id, userId, fee);
}
function start(reward = 0) {
  economy.startRewards(db, id, { ...DEFAULT_TOURNAMENT_POLICY, joiningReward: reward });
  db.prepare("UPDATE tournaments SET status = 'running' WHERE id = ?").run(id);
}
function terminal(status = 'completed') {
  db.prepare('UPDATE tournaments SET status = ? WHERE id = ?').run(status, id);
}
function result(handNumber = 1): ArenaResult {
  return {
    handNumber,
    board: [],
    revealed: [],
    net: [
      { userId: 1, net: -100, won: 0 },
      { userId: 2, net: 90, won: 190 },
    ],
    fees: { house: 5, prize: 5, contested: 200 },
  } as ArenaResult;
}
function assertBalanced() {
  expect(
    db
      .prepare(
        `SELECT t.id FROM tournament_journal_transactions t
    LEFT JOIN tournament_journal_lines l ON l.transaction_id = t.id
    GROUP BY t.id HAVING COALESCE(SUM(l.delta), 0) != 0`,
      )
      .all(),
  ).toEqual([]);
  expect(db.prepare('SELECT COUNT(*) AS n FROM ledger').get()).toEqual({ n: 0 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM settlements').get()).toEqual({ n: 0 });
}

describe('tournament chip journal', () => {
  it('migrates idempotently without inventing legacy economics', () => {
    db.prepare(
      `INSERT INTO tournament_entries
      (tournament_id,user_id,agent_name,kind,joined_at,last_seen,net)
      VALUES (?,1,'Legacy player','human',0,0,125)`,
    ).run(id);
    economy.initializeTournamentEconomy(db);
    expect(economy.playerEarnings(db, id, 1)).toEqual({
      entryFee: 0,
      joiningReward: 0,
      prize: 0,
      playNet: 0,
      settlementNet: 0,
      recordedPaid: 0,
      outstanding: 0,
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM tournament_journal_transactions').get()).toEqual({
      n: 0,
    });
    expect(economy.economyView(db, id)).toEqual({
      unit: 'chips',
      pool: 0,
      house: 0,
      guaranteed: 0,
      entryFees: 0,
      joiningRewards: 0,
      prizes: 0,
      sponsorContributions: 0,
    });
  });

  it('reverses only the active fee and allows re-enrollment without repeated rewards', () => {
    enter(1, 100);
    economy.recordEntry(db, id, 1, 100);
    expect(() => economy.recordEntry(db, id, 1, 101)).toThrow(/different|fee/i);
    economy.withdrawEntry(db, id, 1);
    economy.withdrawEntry(db, id, 1);
    expect(economy.playerEarnings(db, id, 1).entryFee).toBe(0);
    economy.recordEntry(db, id, 1, 100);
    economy.fundTournament(db, id, 30, 'organizer-1', 'guarantee');
    start(30);
    economy.startRewards(db, id, { ...DEFAULT_TOURNAMENT_POLICY, joiningReward: 30 });
    expect(economy.playerEarnings(db, id, 1)).toMatchObject({
      entryFee: 100,
      joiningReward: 30,
      settlementNet: -70,
    });
    expect(economy.economyView(db, id).pool).toBe(100);
    expect(() => economy.withdrawEntry(db, id, 1)).toThrow(/start|locked/i);
    assertBalanced();
  });

  it('does not partly grant joining rewards when the pool cannot fund every entrant', () => {
    enter(1);
    enter(2);
    economy.fundTournament(db, id, 39, 'guarantee', 'guarantee');
    expect(() => start(20)).toThrow(/pool|fund/i);
    expect(economy.playerEarnings(db, id, 1).joiningReward).toBe(0);
    economy.fundTournament(db, id, 1, 'topup', 'guarantee');
    start(20);
    expect(economy.playerEarnings(db, id, 1).joiningReward).toBe(20);
    expect(economy.playerEarnings(db, id, 2).joiningReward).toBe(20);
    expect(economy.economyView(db, id).pool).toBe(0);
    assertBalanced();
  });

  it('tracks a zero-fee withdrawal as a closed enrollment cycle', () => {
    enter(1);
    economy.withdrawEntry(db, id, 1);
    economy.recordEntry(db, id, 1, 0);
    economy.recordEntry(db, id, 1, 0);
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM tournament_journal_transactions WHERE kind = 'entry'")
        .get(),
    ).toEqual({ n: 2 });
    economy.fundTournament(db, id, 10, 'joining', 'guarantee');
    start(10);
    expect(economy.playerEarnings(db, id, 1).joiningReward).toBe(10);
    assertBalanced();
  });

  it('records each hand once, balances fees, and rejects inconsistent retries atomically', () => {
    enter(1, 10);
    enter(2, 10);
    start();
    economy.recordHandEconomy(db, id, result());
    economy.recordHandEconomy(db, id, result());
    expect(economy.playerEarnings(db, id, 1).playNet).toBe(-100);
    expect(economy.playerEarnings(db, id, 2).playNet).toBe(90);
    expect(economy.economyView(db, id)).toMatchObject({ pool: 25, house: 5 });
    const changed = result();
    changed.net[0]!.net = -101;
    changed.net[1]!.net = 91;
    expect(() => economy.recordHandEconomy(db, id, changed)).toThrow(/different|conflict/i);
    const invalid = result(2);
    invalid.net[1]!.net = 91;
    expect(() => economy.recordHandEconomy(db, id, invalid)).toThrow(/balance|conserv/i);
    expect(economy.playerEarnings(db, id, 2).playNet).toBe(90);
    assertBalanced();
  });

  it('keeps hand scoring losses out of settlement obligations', () => {
    enter(1);
    enter(2);
    start();
    economy.recordHandEconomy(db, id, result());
    economy.completePrizes(
      db,
      id,
      [
        { userId: 2, rank: 1 },
        { userId: 1, rank: 2 },
      ],
      [10000],
    );
    terminal();
    expect(economy.playerEarnings(db, id, 1)).toMatchObject({
      playNet: -100,
      entryFee: 0,
      settlementNet: 0,
      outstanding: 0,
    });
    expect(economy.playerEarnings(db, id, 2)).toMatchObject({
      playNet: 90,
      prize: 5,
      settlementNet: 5,
    });
    expect(() => economy.recordTournamentSettlement(db, id, 1, -100, 'not-a-debt', '', 4)).toThrow(
      /outstanding/i,
    );
  });

  it('splits a commission-funded bonus pool 50/30/20 across the top three', () => {
    enter(1);
    enter(2);
    enter(3);
    economy.fundTournament(db, id, 1000, 'bonus', 'guarantee');
    start();
    economy.completePrizes(
      db,
      id,
      [
        { userId: 1, rank: 1 },
        { userId: 2, rank: 2 },
        { userId: 3, rank: 3 },
      ],
      DEFAULT_TOURNAMENT_POLICY.payoutBps,
    );
    expect(economy.playerEarnings(db, id, 1).prize).toBe(500);
    expect(economy.playerEarnings(db, id, 2).prize).toBe(300);
    expect(economy.playerEarnings(db, id, 3).prize).toBe(200);
    expect(economy.economyView(db, id).pool).toBe(0);
  });

  it('distributes absent payout places proportionally and allocates the entire pool once', () => {
    enter(1);
    enter(2);
    economy.fundTournament(db, id, 101, 'guarantee', 'guarantee');
    start();
    const ranks = [
      { userId: 1, rank: 1 },
      { userId: 2, rank: 2 },
    ];
    economy.completePrizes(db, id, ranks, [6000, 3000, 1000]);
    economy.completePrizes(db, id, ranks, [6000, 3000, 1000]);
    expect(economy.playerEarnings(db, id, 1).prize).toBe(67);
    expect(economy.playerEarnings(db, id, 2).prize).toBe(34);
    expect(economy.economyView(db, id).pool).toBe(0);
    expect(() => economy.fundTournament(db, id, 1, 'late', 'sponsor')).toThrow(
      /complete|final|closed/i,
    );
    assertBalanced();
  });

  it('combines tied payout slots and gives tie odd chips in user ID order', () => {
    for (const userId of [1, 2, 3, 4]) enter(userId);
    economy.fundTournament(db, id, 103, 'guarantee', 'guarantee');
    start();
    terminal('cancelled');
    economy.completePrizes(
      db,
      id,
      [
        { userId: 4, rank: 3 },
        { userId: 3, rank: 3 },
        { userId: 2, rank: 1 },
        { userId: 1, rank: 1 },
      ],
      [6000, 3000, 1000],
    );
    expect([1, 2, 3, 4].map((u) => economy.playerEarnings(db, id, u).prize)).toEqual([
      47, 46, 5, 5,
    ]);
    expect(economy.economyView(db, id).pool).toBe(0);
    assertBalanced();
  });

  it('rejects malformed payout schedules and rankings without spending the pool', () => {
    enter(1);
    enter(2);
    economy.fundTournament(db, id, 101, 'guarantee', 'guarantee');
    start();
    for (const rankings of [
      [{ userId: 1, rank: 1 }],
      [
        { userId: 1, rank: 1 },
        { userId: 1, rank: 2 },
      ],
      [
        { userId: 1, rank: 1 },
        { userId: 3, rank: 2 },
      ],
      [
        { userId: 1, rank: 1 },
        { userId: 2, rank: 3 },
      ],
    ]) {
      expect(() => economy.completePrizes(db, id, rankings, [10000])).toThrow();
    }
    for (const payout of [[], [9000], [-1, 10001], [10000.1]]) {
      expect(() =>
        economy.completePrizes(
          db,
          id,
          [
            { userId: 1, rank: 1 },
            { userId: 2, rank: 2 },
          ],
          payout,
        ),
      ).toThrow();
    }
    expect(economy.economyView(db, id).pool).toBe(101);
    economy.completePrizes(
      db,
      id,
      [
        { userId: 1, rank: 1 },
        { userId: 2, rank: 2 },
      ],
      [10000],
    );
    expect(() =>
      economy.completePrizes(
        db,
        id,
        [
          { userId: 2, rank: 1 },
          { userId: 1, rank: 2 },
        ],
        [10000],
      ),
    ).toThrow(/different/i);
    assertBalanced();
  });

  it('preserves exact whole-chip allocation for large prize pools', () => {
    for (const userId of [1, 2, 3]) enter(userId);
    economy.fundTournament(db, id, 999_999_999_999, 'large-guarantee', 'guarantee');
    start();
    economy.completePrizes(
      db,
      id,
      [
        { userId: 3, rank: 1 },
        { userId: 2, rank: 1 },
        { userId: 1, rank: 1 },
      ],
      [6000, 3000, 1000],
    );
    expect([1, 2, 3].map((u) => economy.playerEarnings(db, id, u).prize)).toEqual([
      333_333_333_333, 333_333_333_333, 333_333_333_333,
    ]);
    expect(economy.economyView(db, id).pool).toBe(0);
    assertBalanced();
  });

  it('refunds pre-start cancellation to original sources without duplicate credits', () => {
    enter(1, 100);
    enter(2, 100);
    economy.fundTournament(db, id, 30, 'guarantee', 'guarantee');
    economy.fundTournament(db, id, 40, 'sponsor', 'sponsor');
    terminal('cancelled');
    economy.cancelBeforeStart(db, id);
    economy.cancelBeforeStart(db, id);
    expect(economy.economyView(db, id)).toMatchObject({
      pool: 0,
      entryFees: 0,
      guaranteed: 0,
      sponsorContributions: 0,
    });
    expect(economy.playerEarnings(db, id, 1).settlementNet).toBe(0);
    expect(() => economy.recordEntry(db, id, 1, 100)).toThrow(/cancel|closed/i);
    assertBalanced();
  });

  it('links each cancelled funding reversal to its original contributor reference', () => {
    economy.fundTournament(db, id, 15, 'sponsor-a', 'sponsor');
    economy.fundTournament(db, id, 25, 'sponsor-b', 'sponsor');
    economy.fundTournament(db, id, 10, 'organizer', 'guarantee');
    economy.cancelBeforeStart(db, id);
    const refunds = db
      .prepare(
        `SELECT metadata FROM tournament_journal_transactions
      WHERE kind IN ('refund-sponsor', 'refund-guarantee') ORDER BY id`,
      )
      .all() as { metadata: string }[];
    expect(refunds.map((row) => JSON.parse(row.metadata))).toEqual([
      { source: 'sponsor', amount: 15, originalRef: 'fund:sponsor-a' },
      { source: 'sponsor', amount: 25, originalRef: 'fund:sponsor-b' },
      { source: 'guarantee', amount: 10, originalRef: 'fund:organizer' },
    ]);
    assertBalanced();
  });

  it('retains withdrawn entrants in earnings and preserves immutable journal rows', () => {
    enter(1, 10);
    economy.withdrawEntry(db, id, 1);
    db.prepare('DELETE FROM tournament_entries WHERE tournament_id = ? AND user_id = 1').run(id);
    expect(economy.earningsRows(db, 1)).toEqual([
      expect.objectContaining({
        tournamentId: id,
        playerName: 'player1',
        entryFee: 0,
        outstanding: 0,
      }),
    ]);
    expect(() => db.prepare('UPDATE tournament_journal_lines SET delta = 0').run()).toThrow(
      /immutable/i,
    );
    expect(() => db.prepare('DELETE FROM tournament_journal_transactions').run()).toThrow(
      /immutable/i,
    );
    expect(() =>
      db
        .prepare(
          `INSERT INTO tournament_journal_lines (transaction_id, account, delta)
      SELECT MIN(id), 'house', 50 FROM tournament_journal_transactions`,
        )
        .run(),
    ).toThrow(/immutable/i);
    assertBalanced();
  });

  it('uses nested savepoints so caller rollback also rolls back journal work', () => {
    expect(() =>
      db
        .transaction(() => {
          enter(1, 100);
          economy.fundTournament(db, id, 20, 'guarantee', 'guarantee');
          throw new Error('caller rolled back');
        })
        .immediate(),
    ).toThrow('caller rolled back');
    expect(economy.economyView(db, id).pool).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM tournament_entries').get()).toEqual({ n: 0 });
  });

  it('rejects fractional, unsafe, negative and conflicting funding inputs', () => {
    for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1e12 + 1]) {
      expect(() => economy.fundTournament(db, id, amount, 'bad', 'sponsor')).toThrow();
    }
    economy.fundTournament(db, id, 25, 'receipt-1', 'sponsor');
    economy.fundTournament(db, id, 25, 'receipt-1', 'sponsor');
    expect(() => economy.fundTournament(db, id, 26, 'receipt-1', 'sponsor')).toThrow(
      /different|conflict/i,
    );
    expect(economy.economyView(db, id).sponsorContributions).toBe(25);
    assertBalanced();
  });
});

describe('no organizer commission', () => {
  it('does not add an organizer payment from obsolete policy metadata', () => {
    db.prepare('UPDATE tournaments SET owner_id=3, policy_json=? WHERE id=?').run(
      JSON.stringify({ ...DEFAULT_TOURNAMENT_POLICY, bankerUserId: 3, bankerBps: 50 }),
      id,
    );
    enter(1);
    enter(2);
    start();
    economy.recordHandEconomy(db, id, result());
    economy.completePrizes(
      db,
      id,
      [
        { userId: 2, rank: 1 },
        { userId: 1, rank: 2 },
      ],
      [10000],
    );
    terminal();
    expect(economy.earningsRows(db, 3)).toEqual([]);
    expect(economy.playerEarnings(db, id, 3).settlementNet).toBe(0);
    expect(() =>
      economy.recordTournamentSettlement(db, id, 3, 1, 'no-commission', '', 4),
    ).toThrow();
    expect(economy.economyView(db, id)).toMatchObject({ house: 5, pool: 0, prizes: 5 });
    expect(
      db.prepare("SELECT COUNT(*) n FROM tournament_journal_lines WHERE account='banker'").get(),
    ).toEqual({ n: 0 });
    assertBalanced();
  });

  it('keeps the entrant organizer score separate without a commission payout', () => {
    enter(1, 10);
    enter(2, 10);
    start();
    economy.recordHandEconomy(db, id, result());
    expect(economy.earningsRows(db, 1)).toHaveLength(1);
    expect(economy.playerEarnings(db, id, 1)).toMatchObject({
      entryFee: 10,
      playNet: -100,
      settlementNet: -10,
    });
    expect(economy.playerEarnings(db, id, 1)).not.toHaveProperty('bankerCommission');
    assertBalanced();
  });
});

describe('tournament recorded settlements', () => {
  beforeEach(() => {
    enter(1, 100);
    enter(2, 100);
    start();
    economy.completePrizes(
      db,
      id,
      [
        { userId: 1, rank: 1 },
        { userId: 2, rank: 2 },
      ],
      [10000],
    );
    terminal();
  });

  it('records signed partial payments, accepts exact retries, and rejects overpayment or wrong direction', () => {
    expect(economy.playerEarnings(db, id, 1).outstanding).toBe(100);
    economy.recordTournamentSettlement(db, id, 1, 40, 'receipt-1', 'offline attestation', 4);
    economy.recordTournamentSettlement(db, id, 1, 40, 'receipt-1', 'offline attestation', 4);
    expect(economy.playerEarnings(db, id, 1)).toMatchObject({ recordedPaid: 40, outstanding: 60 });
    expect(() =>
      economy.recordTournamentSettlement(db, id, 1, 41, 'receipt-1', 'offline attestation', 4),
    ).toThrow(/different|conflict/i);
    expect(() =>
      economy.recordTournamentSettlement(db, id, 1, 40, 'receipt-1', 'changed note', 4),
    ).toThrow(/different|conflict/i);
    for (const amount of [61, -1, 0, 0.5]) {
      expect(() => economy.recordTournamentSettlement(db, id, 1, amount, 'bad', '', 4)).toThrow();
    }
    economy.recordTournamentSettlement(db, id, 1, 60, 'receipt-2', '', 4);
    economy.recordTournamentSettlement(db, id, 2, -100, 'receipt-3', '', 4);
    expect(economy.playerEarnings(db, id, 1).outstanding).toBe(0);
    expect(economy.playerEarnings(db, id, 2)).toMatchObject({ recordedPaid: -100, outstanding: 0 });
    expect(economy.settlementRows(db, id)).toHaveLength(3);
    expect(economy.settlementRows(db, id)[0]).toMatchObject({
      userId: 1,
      amount: 40,
      requestId: 'receipt-1',
      note: 'offline attestation',
      recordedBy: 4,
    });
    expect(() => db.prepare('UPDATE tournament_settlements SET amount = 1').run()).toThrow(
      /immutable/i,
    );
    expect(() => db.prepare('DELETE FROM tournament_settlements').run()).toThrow(/immutable/i);
    assertBalanced();
  });

  it('rejects payment records until the event ends and includes receipt-only former entrants', () => {
    terminal('running');
    expect(() => economy.recordTournamentSettlement(db, id, 1, 100, 'receipt', '', 4)).toThrow(
      /complete|end|terminal/i,
    );
    terminal('cancelled');
    economy.recordTournamentSettlement(db, id, 1, 100, 'receipt', '', 4);
    db.prepare('DELETE FROM tournament_entries WHERE tournament_id = ? AND user_id = 1').run(id);
    expect(economy.earningsRows(db, 1)[0]).toMatchObject({ recordedPaid: 100, outstanding: 0 });
  });
});
