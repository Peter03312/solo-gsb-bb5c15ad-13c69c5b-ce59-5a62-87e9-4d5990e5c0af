'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lights (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS cues (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cue_no     INTEGER NOT NULL,
  light_id   INTEGER NOT NULL REFERENCES lights(id),
  time       REAL NOT NULL CHECK (time >= 0),
  target     REAL NOT NULL CHECK (target >= 0 AND target <= 100),
  duration   REAL NOT NULL CHECK (duration >= 0),
  UNIQUE (cue_no)
);

CREATE INDEX IF NOT EXISTS idx_cues_time ON cues (time, cue_no);
CREATE INDEX IF NOT EXISTS idx_cues_light ON cues (light_id);

-- 已发布的不可变演出版本
CREATE TABLE IF NOT EXISTS versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,
  created_at REAL NOT NULL,
  cue_count  INTEGER NOT NULL DEFAULT 0
);

-- 版本快照：发布时灯具与 Cue 的完整冻结副本
CREATE TABLE IF NOT EXISTS version_lights (
  version_id INTEGER NOT NULL REFERENCES versions(id),
  light_id   INTEGER NOT NULL,
  name       TEXT NOT NULL,
  pos        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS version_cues (
  version_id INTEGER NOT NULL REFERENCES versions(id),
  cue_no     INTEGER NOT NULL,
  light_id   INTEGER NOT NULL,
  time       REAL NOT NULL,
  target     REAL NOT NULL,
  duration   REAL NOT NULL,
  pos        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_version_cues ON version_cues (version_id, time, cue_no);
`;

let db;

function open(dbPath) {
  if (db) return db;
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

function get() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

module.exports = { open, get };
