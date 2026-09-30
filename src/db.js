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

-- 临时调光记录：绑定一个已发布的不可变版本；revision = 已追加操作数
CREATE TABLE IF NOT EXISTS override_records (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES versions(id),
  name       TEXT NOT NULL,
  created_at REAL NOT NULL,
  revision   INTEGER NOT NULL DEFAULT 0
);

-- 临时调光操作：按追加顺序自增 seq，同秒操作据此排序；target 仅覆盖类型需要
CREATE TABLE IF NOT EXISTS override_ops (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES override_records(id),
  seq       INTEGER NOT NULL,
  light_id  INTEGER NOT NULL,
  time      REAL NOT NULL CHECK (time >= 0),
  kind      TEXT NOT NULL CHECK (kind IN ('override', 'return')),
  duration  REAL NOT NULL CHECK (duration >= 0),
  target    REAL CHECK (target IS NULL OR (target >= 0 AND target <= 100))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_override_ops_seq
  ON override_ops (record_id, seq);
CREATE INDEX IF NOT EXISTS idx_override_ops_record
  ON override_ops (record_id, time, seq);
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
