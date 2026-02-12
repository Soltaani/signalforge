import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS items (
  id           TEXT PRIMARY KEY,
  sourceId     TEXT NOT NULL,
  tier         INTEGER NOT NULL CHECK(tier IN (1, 2, 3)),
  weight       REAL NOT NULL CHECK(weight >= 0 AND weight <= 5),
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,
  publishedAt  TEXT NOT NULL,
  text         TEXT DEFAULT '',
  author       TEXT,
  hash         TEXT NOT NULL,
  fetchedAt    TEXT NOT NULL,
  tags         TEXT DEFAULT '[]',
  dedupedInto  TEXT REFERENCES items(id),
  UNIQUE(hash)
);

CREATE INDEX IF NOT EXISTS idx_items_publishedAt ON items(publishedAt);
CREATE INDEX IF NOT EXISTS idx_items_sourceId ON items(sourceId);
CREATE INDEX IF NOT EXISTS idx_items_hash ON items(hash);

CREATE TABLE IF NOT EXISTS feeds (
  id            TEXT PRIMARY KEY,
  url           TEXT NOT NULL UNIQUE,
  tier          INTEGER NOT NULL CHECK(tier IN (1, 2, 3)),
  weight        REAL NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  tags          TEXT DEFAULT '[]',
  lastFetchedAt TEXT,
  lastStatus    TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS runs (
  runId             TEXT PRIMARY KEY,
  window            TEXT NOT NULL,
  topic             TEXT DEFAULT '',
  evidencePackHash  TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'running',
  createdAt         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cache (
  cacheKey    TEXT PRIMARY KEY,
  stageId     TEXT NOT NULL,
  reportJson  TEXT NOT NULL,
  createdAt   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cache_stageId ON cache(stageId);
`;

export function createDatabase(dbPath: string): Database.Database {
  try {
    mkdirSync(dirname(dbPath), { recursive: true });

    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(SCHEMA_SQL);

    logger.debug('Database initialized', { path: dbPath });
    return db;
  } catch (err) {
    throw new DatabaseError(
      `Failed to initialize database at "${dbPath}": ${(err as Error).message}`,
      err as Error
    );
  }
}

export function closeDatabase(db: Database.Database): void {
  try {
    db.close();
  } catch (err) {
    logger.warn('Error closing database', { error: (err as Error).message });
  }
}
