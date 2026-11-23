'use strict';

/* Conexão SQLite (módulo nativo node:sqlite) + schema + migrações.
   O banco oficial da liga é data/f1.db. Ele é versionado no Git: é a
   partir dele que o site público é gerado. */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = process.env.F1_DB_PATH || path.join(DATA_DIR, 'f1.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const READONLY = process.env.F1_READONLY === '1';
const db = new DatabaseSync(DB_PATH, READONLY ? { readOnly: true } : {});
// journal_mode=DELETE mantém tudo dentro de f1.db (sem arquivos -wal/-shm),
// o que deixa o arquivo sempre pronto para backup e para o commit no Git.
if (!READONLY) db.exec('PRAGMA journal_mode = DELETE;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 3000;');

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function withTransaction(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  }
}

if (!READONLY) db.exec(`
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#e10600',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  default_team_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY(default_team_id) REFERENCES teams(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS championships (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  season TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  points TEXT NOT NULL,
  sprint_points TEXT NOT NULL,
  fastest_lap_point INTEGER NOT NULL DEFAULT 1,
  fastest_lap_top10 INTEGER NOT NULL DEFAULT 1,
  winner_driver_id TEXT,
  winner_team_id TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS races (
  id TEXT PRIMARY KEY,
  championship_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  flag TEXT DEFAULT '',
  circuit TEXT DEFAULT '',
  is_sprint INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(championship_id) REFERENCES championships(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS driver_entries (
  id TEXT PRIMARY KEY,
  championship_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  from_round INTEGER NOT NULL DEFAULT 1,
  is_reserve INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(championship_id) REFERENCES championships(id) ON DELETE CASCADE,
  FOREIGN KEY(driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
  FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  championship_id TEXT NOT NULL,
  race_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  position INTEGER,
  status TEXT DEFAULT 'finished',
  sprint_position INTEGER,
  fastest_lap INTEGER NOT NULL DEFAULT 0,
  pole INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(championship_id) REFERENCES championships(id) ON DELETE CASCADE,
  FOREIGN KEY(race_id) REFERENCES races(id) ON DELETE CASCADE,
  FOREIGN KEY(driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
  FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE,
  UNIQUE(championship_id, race_id, driver_id)
);

CREATE TABLE IF NOT EXISTS qualifying (
  id TEXT PRIMARY KEY,
  championship_id TEXT NOT NULL,
  race_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  team_id TEXT,
  position INTEGER NOT NULL,
  best_lap_ms INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',   -- manual | telemetria
  FOREIGN KEY(championship_id) REFERENCES championships(id) ON DELETE CASCADE,
  FOREIGN KEY(race_id) REFERENCES races(id) ON DELETE CASCADE,
  FOREIGN KEY(driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
  UNIQUE(race_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_races_champ ON races(championship_id, round);
CREATE INDEX IF NOT EXISTS idx_quali_champ ON qualifying(championship_id, race_id);
CREATE INDEX IF NOT EXISTS idx_entries_champ ON driver_entries(championship_id, driver_id);
CREATE INDEX IF NOT EXISTS idx_results_champ ON results(championship_id, race_id);
`);

// Migrações leves (bancos antigos)
if (!READONLY) {
  const cols = db.prepare('PRAGMA table_info(driver_entries)').all();
  if (!cols.some(c => c.name === 'is_reserve')) {
    db.exec('ALTER TABLE driver_entries ADD COLUMN is_reserve INTEGER NOT NULL DEFAULT 0');
  }
}

function getMeta(key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setMeta(key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? '' : String(value));
}

/** Uma equipe é "de reservas" quando o nome começa com "Reserv" (Reserva, Reservas...). */
const isReserveTeamName = (name) => /^reserv/i.test(String(name || '').trim());

module.exports = { db, uuid, now, withTransaction, getMeta, setMeta, isReserveTeamName, DB_PATH, ROOT, DATA_DIR };
