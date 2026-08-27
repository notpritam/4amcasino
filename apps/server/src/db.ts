import Database from 'better-sqlite3';

export type DB = Database.Database;

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
  ensureColumn(db, 'rooms', 'meet_link', 'TEXT');
  ensureColumn(db, 'rooms', 'visibility', "TEXT NOT NULL DEFAULT 'private'");
  ensureColumn(db, 'rooms', 'spectate_token', 'TEXT');
  ensureColumn(db, 'rooms', 'allow_spectators', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'rooms', 'tv_replays', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'show_best_hand', 'INTEGER NOT NULL DEFAULT 1');
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
}

function ensureColumn(db: DB, table: string, column: string, decl: string): void {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
