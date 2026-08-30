import Database from 'better-sqlite3';

export type DB = Database.Database;

/** How long a login lasts. Long enough that a weekly game never re-authenticates
 *  mid-session, short enough that a leaked token eventually dies. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      auth_hash TEXT NOT NULL,
      auth_salt TEXT NOT NULL,
      pubkey TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      join_code TEXT NOT NULL UNIQUE,
      host_id INTEGER NOT NULL,
      banker_id INTEGER NOT NULL,
      sb INTEGER NOT NULL,
      bb INTEGER NOT NULL,
      audit_mode TEXT NOT NULL DEFAULT 'private',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS room_players (
      room_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      seat INTEGER,
      stack INTEGER NOT NULL DEFAULT 0,
      sitting_out INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (room_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      delta INTEGER NOT NULL,
      kind TEXT NOT NULL,
      approved_by INTEGER,
      note TEXT,
      ref TEXT,
      ts INTEGER NOT NULL,
      prev_hash TEXT NOT NULL,
      entry_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS buy_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transcripts (
      hand_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      head TEXT NOT NULL,
      entries TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
  `);
  ensureColumn(db, 'users', 'display_name', 'TEXT');
  ensureColumn(db, 'users', 'bio', 'TEXT');
  ensureColumn(db, 'users', 'avatar', 'BLOB');
  ensureColumn(db, 'users', 'avatar_mime', 'TEXT');
  ensureColumn(db, 'users', 'avatar_version', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'card_back', "TEXT NOT NULL DEFAULT 'indigo'");
  ensureColumn(db, 'users', 'four_color', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'theme', "TEXT NOT NULL DEFAULT 'cyber'");
  ensureColumn(db, 'users', 'avatar3d', 'TEXT');
  // 2026-08-24 redesign: cyber becomes the game's look for everyone, once.
  // Settings still offers light/dark, so a later explicit choice sticks.
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  const cyberFlag = db.prepare("SELECT value FROM meta WHERE key = 'cyber-theme-migrated'").get();
  if (!cyberFlag) {
    db.prepare("UPDATE users SET theme = 'cyber'").run();
    db.prepare("INSERT INTO meta (key, value) VALUES ('cyber-theme-migrated', '1')").run();
  }
  // heal balances damaged by the old absolute-stack settlement write (a buy
  // approved mid-hand was erased at hand end): the hash-chained ledger is the
  // source of truth, so recompute any stack that disagrees with it, once
  const healFlag = db.prepare("SELECT value FROM meta WHERE key = 'stack-ledger-heal-1'").get();
  if (!healFlag) {
    db.prepare(
      `UPDATE room_players SET stack = COALESCE((SELECT SUM(l.delta) FROM ledger l WHERE l.room_id = room_players.room_id AND l.user_id = room_players.user_id), 0)
       WHERE stack != COALESCE((SELECT SUM(l.delta) FROM ledger l WHERE l.room_id = room_players.room_id AND l.user_id = room_players.user_id), 0)`,
    ).run();
    db.prepare("INSERT INTO meta (key, value) VALUES ('stack-ledger-heal-1', '1')").run();
  }
  ensureColumn(db, 'users', 'quick_phrases', 'TEXT');
  ensureColumn(db, 'rooms', 'action_secs', 'INTEGER');
  ensureColumn(db, 'rooms', 'co_banker_id', 'INTEGER');
  ensureColumn(db, 'rooms', 'min_settle_hands', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'rooms', 'auto_approve_buys', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'rooms', 'seven_deuce_bonus', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'private_mode', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'last_seen', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'auto_join_invites', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'rooms', 'voided', 'INTEGER NOT NULL DEFAULT 0');
  // Archiving retires a finished table: it leaves the room list, stops dealing,
  // and its results stop counting towards stats. Nothing is deleted - the
  // ledger and every transcript stay readable, and money still owed between
  // players stays owed. See the comment on /api/rooms/:id/archive.
  ensureColumn(db, 'rooms', 'archived', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'rooms', 'archived_at', 'INTEGER');
  // Deletion, like archiving, is soft: rows are never dropped. Archive/unarchive
  // and delete both go through room_lifecycle_requests below and only take
  // effect once a platform admin approves them.
  ensureColumn(db, 'rooms', 'deleted', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'rooms', 'deleted_at', 'INTEGER');
  ensureColumn(db, 'rooms', 'meet_link', 'TEXT');
  ensureColumn(db, 'rooms', 'visibility', "TEXT NOT NULL DEFAULT 'private'");
  ensureColumn(db, 'rooms', 'spectate_token', 'TEXT');
  ensureColumn(db, 'rooms', 'allow_spectators', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'rooms', 'tv_replays', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'show_best_hand', 'INTEGER NOT NULL DEFAULT 1');
  // "deal me in without asking every hand" - the ready check exists so nobody is
  // dealt into a hand they walked away from, which is a per-player call
  ensureColumn(db, 'users', 'auto_ready', 'INTEGER NOT NULL DEFAULT 0');
  // account recovery: hash of the one-time recovery code, salted like a password
  // (requested by notpritam, docs/FEATURES.md)
  // Signup order, as its own fact rather than something inferred from the
  // primary key. `id` happens to be sequential today, but it is an
  // implementation detail: a restore, a merge, or a deleted row puts gaps in it,
  // and then "member #7" would quietly change meaning. This column never does.
  ensureColumn(db, 'users', 'join_number', 'INTEGER');
  db.exec(`
    UPDATE users SET join_number = (
      SELECT COUNT(*) FROM users u2
      WHERE u2.created_at < users.created_at
         OR (u2.created_at = users.created_at AND u2.id <= users.id)
    ) WHERE join_number IS NULL
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_join_number ON users(join_number)');
  ensureColumn(db, 'users', 'recovery_hash', 'TEXT');
  ensureColumn(db, 'users', 'recovery_salt', 'TEXT');
  ensureColumn(db, 'users', 'recovery_set_at', 'INTEGER');
  ensureColumn(db, 'sessions', 'last_used', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'sessions', 'label', 'TEXT');
  // Sessions used to be immortal: nothing wrote an expiry and nothing swept the
  // table, so a token lifted from a log line or a backup stayed live forever.
  // Existing rows are grandfathered a full window rather than logged out on deploy.
  ensureColumn(db, 'sessions', 'expires_at', 'INTEGER NOT NULL DEFAULT 0');
  db.prepare('UPDATE sessions SET expires_at = ? WHERE expires_at = 0').run(
    Date.now() + SESSION_TTL_MS,
  );
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.exec(`
    CREATE TABLE IF NOT EXISTS settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      low_user INTEGER NOT NULL,
      high_user INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      debtor INTEGER NOT NULL,
      confirmed_low INTEGER NOT NULL DEFAULT 0,
      confirmed_high INTEGER NOT NULL DEFAULT 0,
      created_ts INTEGER NOT NULL,
      settled_ts INTEGER
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS friends (
      requester_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (requester_id, target_id)
    );
    CREATE TABLE IF NOT EXISTS spectators (
      room_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      PRIMARY KEY (room_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS join_requests (
      id INTEGER PRIMARY KEY,
      room_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY,
      room_id TEXT NOT NULL,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      ts INTEGER NOT NULL
    );
  `);
  db.exec(`
    -- What each side said when they marked a debt settled: a remark, and
    -- optionally a photo of the transfer. One row per person per settlement, so
    -- both halves of the story are kept separately rather than overwriting.
    CREATE TABLE IF NOT EXISTS settlement_marks (
      settlement_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      note TEXT,
      proof BLOB,
      proof_mime TEXT,
      ts INTEGER NOT NULL,
      PRIMARY KEY (settlement_id, user_id)
    );
    -- Money owed to the house for keeping the servers up. Dues are derived from
    -- the rake the ledger already records; this table is only the paying side.
    CREATE TABLE IF NOT EXISTS house_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      note TEXT,
      proof BLOB,
      proof_mime TEXT,
      ts INTEGER NOT NULL,
      confirmed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_house_payments_user ON house_payments(user_id);
  `);
  db.exec(`
    -- Archive/unarchive/delete are requested by a host or banker but only take
    -- effect once a platform admin approves them (see requirePlatform).
    CREATE TABLE IF NOT EXISTS room_lifecycle_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      action TEXT NOT NULL,            -- 'archive' | 'unarchive' | 'delete'
      requested_by INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
      note TEXT,
      created_at INTEGER NOT NULL,
      decided_at INTEGER,
      decided_by INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_lifecycle_status ON room_lifecycle_requests(status);
  `);
  // The schema had no indexes at all, so every ledger and transcript read was a
  // full table scan - which is what turns "this table has played a lot of hands"
  // into "the settle-up page times out".
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ledger_room ON ledger(room_id, id);
    CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, kind);
    CREATE INDEX IF NOT EXISTS idx_ledger_ref ON ledger(ref);
    CREATE INDEX IF NOT EXISTS idx_transcripts_room ON transcripts(room_id, ts);
    CREATE INDEX IF NOT EXISTS idx_transcripts_head ON transcripts(head);
    CREATE INDEX IF NOT EXISTS idx_buyreq_room ON buy_requests(room_id, status);
    CREATE INDEX IF NOT EXISTS idx_roomplayers_user ON room_players(user_id);
    CREATE INDEX IF NOT EXISTS idx_invites_to ON invites(to_id, status);
    CREATE INDEX IF NOT EXISTS idx_joinreq_room ON join_requests(room_id, status);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_settlements_pair ON settlements(room_id, low_user, high_user);
  `);
}

function ensureColumn(db: DB, table: string, column: string, decl: string): void {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
