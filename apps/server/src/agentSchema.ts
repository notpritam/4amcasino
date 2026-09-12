import type { DB } from './db.js';
export function migrateAgentPlatform(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'registration',
      capacity INTEGER NOT NULL, hand_limit INTEGER NOT NULL, starting_stack INTEGER NOT NULL,
      sb INTEGER NOT NULL, bb INTEGER NOT NULL, action_seconds INTEGER NOT NULL,
      prize_description TEXT NOT NULL DEFAULT '', rules TEXT NOT NULL DEFAULT '',
      seed TEXT NOT NULL, completed_hands INTEGER NOT NULL DEFAULT 0, round_json TEXT,
      deadline INTEGER, last_result TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tournament_entries (
      tournament_id TEXT NOT NULL REFERENCES tournaments(id), user_id INTEGER NOT NULL REFERENCES users(id),
      agent_name TEXT NOT NULL, kind TEXT NOT NULL, joined_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
      net INTEGER NOT NULL DEFAULT 0, hands INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
      timeouts INTEGER NOT NULL DEFAULT 0, award_note TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(tournament_id, user_id), UNIQUE(tournament_id, agent_name)
    );
    CREATE TABLE IF NOT EXISTS tournament_actions (
      tournament_id TEXT NOT NULL REFERENCES tournaments(id), user_id INTEGER NOT NULL,
      request_id TEXT NOT NULL, hand_number INTEGER NOT NULL, action_seq INTEGER NOT NULL,
      action_json TEXT NOT NULL, timed_out INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL,
      PRIMARY KEY(tournament_id, user_id, request_id), UNIQUE(tournament_id, hand_number, action_seq)
    );
    CREATE TABLE IF NOT EXISTS tournament_results (
      tournament_id TEXT NOT NULL REFERENCES tournaments(id), hand_number INTEGER NOT NULL,
      result_json TEXT NOT NULL, PRIMARY KEY(tournament_id, hand_number)
    );
    CREATE TABLE IF NOT EXISTS agent_grants (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), token_hash TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL, scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL,
      can_play INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS agent_grants_owner ON agent_grants(user_id, created_at);
    CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL,
      type TEXT NOT NULL, data_json TEXT NOT NULL, ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_events_scope ON agent_events(scope_kind, scope_id, id);
    CREATE TRIGGER IF NOT EXISTS agent_room_membership_ended AFTER DELETE ON room_players BEGIN
      UPDATE agent_grants SET revoked_at = COALESCE(revoked_at, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE scope_kind = 'room' AND scope_id = OLD.room_id AND user_id = OLD.user_id;
    END;
    CREATE TRIGGER IF NOT EXISTS agent_tournament_membership_ended AFTER DELETE ON tournament_entries BEGIN
      UPDATE agent_grants SET revoked_at = COALESCE(revoked_at, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE scope_kind = 'tournament' AND scope_id = OLD.tournament_id AND user_id = OLD.user_id;
    END;
    CREATE TRIGGER IF NOT EXISTS agent_identity_changed AFTER UPDATE OF pubkey, disabled ON users WHEN OLD.pubkey != NEW.pubkey OR NEW.disabled != 0 BEGIN
      UPDATE agent_grants SET revoked_at = COALESCE(revoked_at, CAST(strftime('%s','now') AS INTEGER)*1000) WHERE user_id = NEW.id;
    END;
  `);
}
