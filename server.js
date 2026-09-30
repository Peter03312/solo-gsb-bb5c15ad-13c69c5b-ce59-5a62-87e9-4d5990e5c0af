'use strict';

const path = require('path');
const express = require('express');
const { open, get } = require('./src/db');
const Engine = require('./public/engine');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');

open(DB_PATH);
const db = get();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------- 校验工具 ------------------------------- */

const NAME_RE = /\S/;

// 严格数字转换：数字、数字字符串通过；NaN/Infinity/其他类型一律拒绝
function toNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '' && v.trim() !== '-') {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function toPosInt(v) {
  const n = toNum(v);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

/**
 * 校验一条 Cue 的可写字段。
 * 返回 { value: {cue_no?, light_id, time, target, duration} } 或 { error }。
 */
function validateCue(input, { allowCueNo = true, existingId = null } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Cue 必须是一个对象' };
  }

  // 灯具编号
  const lightId = toPosInt(input.light_id);
  if (Number.isNaN(lightId)) {
    return { error: `灯具编号无效：${JSON.stringify(input.light_id)}（须为已存在的灯具编号）` };
  }
  const light = db.prepare('SELECT id FROM lights WHERE id = ?').get(lightId);
  if (!light) {
    return { error: `未知灯具：编号 ${lightId} 不存在` };
  }

  // 触发时码：非负演出秒数
  const time = toNum(input.time);
  if (Number.isNaN(time)) {
    return { error: `非法时码：${JSON.stringify(input.time)}（须为数字）` };
  }
  if (time < 0) {
    return { error: `非法时码：${time}（不得为负）` };
  }

  // 目标亮度 0～100
  const target = toNum(input.target);
  if (Number.isNaN(target)) {
    return { error: `无效亮度：${JSON.stringify(input.target)}（须为数字）` };
  }
  if (target < 0 || target > 100) {
    return { error: `无效亮度：${target}（须在 0～100 之间）` };
  }

  // 渐变时长：非负秒数
  const duration = toNum(input.duration);
  if (Number.isNaN(duration)) {
    return { error: `非法渐变时长：${JSON.stringify(input.duration)}（须为数字）` };
  }
  if (duration < 0) {
    return { error: `非法渐变时长：${duration}（不得为负）` };
  }

  const value = { light_id: lightId, time, target, duration };

  // Cue 编号可选（不传则自动分配）
  if (input.cue_no !== undefined && input.cue_no !== null && input.cue_no !== '') {
    if (!allowCueNo) return { error: '不允许指定 Cue 编号' };
    const cueNo = toPosInt(input.cue_no);
    if (Number.isNaN(cueNo)) {
      return { error: `非法 Cue 编号：${JSON.stringify(input.cue_no)}（须为正整数）` };
    }
    const dup = db
      .prepare('SELECT id FROM cues WHERE cue_no = ? AND id IS NOT ?')
      .get(cueNo, existingId);
    if (dup) {
      return { error: `Cue 编号 ${cueNo} 已被占用（同秒触发按编号顺序生效，编号须唯一）` };
    }
    value.cue_no = cueNo;
  }

  return { value };
}

function err(res, code, message) {
  return res.status(code).json({ error: message });
}

function readCue(row) {
  return {
    id: row.id,
    cue_no: row.cue_no,
    light_id: row.light_id,
    light_name: row.light_name,
    time: row.time,
    target: row.target,
    duration: row.duration,
  };
}

const cueSelect = `
  SELECT c.id, c.cue_no, c.light_id, l.name AS light_name,
         c.time, c.target, c.duration
  FROM cues c JOIN lights l ON l.id = c.light_id
  ORDER BY c.time ASC, c.cue_no ASC
`;

/* -------------------------------- 灯具 -------------------------------- */

app.get('/api/lights', (req, res) => {
  res.json(db.prepare('SELECT * FROM lights ORDER BY id ASC').all());
});

app.post('/api/lights', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!NAME_RE.test(name)) return err(res, 400, '灯具名称不能为空');

  try {
    const info = db
      .prepare('INSERT INTO lights (name, created_at) VALUES (?, ?)')
      .run(name, Date.now() / 1000);
    res.status(201).json(db.prepare('SELECT * FROM lights WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return err(res, 409, `灯具名称已存在：${name}`);
    throw e;
  }
});

app.delete('/api/lights/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const light = db.prepare('SELECT * FROM lights WHERE id = ?').get(id);
  if (!light) return err(res, 404, `灯具 ${id} 不存在`);

  const used = db.prepare('SELECT COUNT(*) AS n FROM cues WHERE light_id = ?').get(id).n;
  if (used > 0) {
    return err(res, 409, `灯具 ${light.name} 仍被 ${used} 条草稿 Cue 引用，请先删除这些 Cue`);
  }
  db.prepare('DELETE FROM lights WHERE id = ?').run(id);
  res.status(204).end();
});

/* ------------------------------- 草稿 Cue ------------------------------ */

app.get('/api/cues', (req, res) => {
  res.json(db.prepare(cueSelect).all().map(readCue));
});

// 新增：接受单条对象，或数组（批量提交；任一条非法则整次拒绝、全部不落库）
app.post('/api/cues', (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [req.body];
  if (rows.length === 0) return err(res, 400, '提交内容为空');

  const parsed = [];
  for (let i = 0; i < rows.length; i++) {
    const prefix = Array.isArray(req.body) ? `第 ${i + 1} 行：` : '';
    const r = validateCue(rows[i]);
    if (r.error) return err(res, 400, prefix + r.error);
    parsed.push(r.value);
  }

  // 已有编号（库内 + 本批显式指定）都要在自动分配时避开
  const used = new Set(db.prepare('SELECT cue_no FROM cues').all().map((r) => r.cue_no));
  let nextNo = (used.size ? Math.max(...used) : 0) + 1;
  for (const v of parsed) {
    if (v.cue_no !== undefined) {
      if (used.has(v.cue_no)) {
        return err(res, 409, `Cue 编号 ${v.cue_no} 冲突，本次提交已全部撤销`);
      }
      used.add(v.cue_no);
    }
  }
  for (const v of parsed) {
    if (v.cue_no === undefined) {
      while (used.has(nextNo)) nextNo++;
      v.cue_no = nextNo;
      used.add(nextNo);
      nextNo++;
    }
  }

  const insert = db.prepare(
    'INSERT INTO cues (cue_no, light_id, time, target, duration) VALUES (?, ?, ?, ?, ?)'
  );
  const tx = db.transaction((items) => {
    for (const v of items) insert.run(v.cue_no, v.light_id, v.time, v.target, v.duration);
  });
  try {
    tx(parsed);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return err(res, 409, 'Cue 编号冲突，本次提交已全部撤销');
    }
    throw e;
  }

  const created = db.prepare(cueSelect).all().map(readCue);
  res.status(201).json(created);
});

// 修改草稿 Cue
app.patch('/api/cues/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM cues WHERE id = ?').get(id);
  if (!row) return err(res, 404, `Cue ${id} 不存在`);

  const merged = {
    cue_no: 'cue_no' in req.body ? req.body.cue_no : row.cue_no,
    light_id: 'light_id' in req.body ? req.body.light_id : row.light_id,
    time: 'time' in req.body ? req.body.time : row.time,
    target: 'target' in req.body ? req.body.target : row.target,
    duration: 'duration' in req.body ? req.body.duration : row.duration,
  };
  const r = validateCue(merged, { existingId: id });
  if (r.error) return err(res, 400, r.error);
  const v = r.value;

  db.prepare(
    'UPDATE cues SET cue_no = ?, light_id = ?, time = ?, target = ?, duration = ? WHERE id = ?'
  ).run(v.cue_no, v.light_id, v.time, v.target, v.duration, id);

  res.json(db.prepare(cueSelect).all().map(readCue));
});

app.delete('/api/cues/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM cues WHERE id = ?').get(id);
  if (!row) return err(res, 404, `Cue ${id} 不存在`);
  db.prepare('DELETE FROM cues WHERE id = ?').run(id);
  res.status(204).end();
});

/* --------------------------- 发布不可变版本 ---------------------------- */

function loadVersionSnapshot(versionId) {
  const version = db.prepare('SELECT * FROM versions WHERE id = ?').get(versionId);
  if (!version) return null;
  const lights = db
    .prepare('SELECT light_id AS id, name FROM version_lights WHERE version_id = ? ORDER BY pos')
    .all(versionId);
  const cues = db
    .prepare(
      `SELECT cue_no, light_id, time, target, duration
       FROM version_cues WHERE version_id = ? ORDER BY time, cue_no`
    )
    .all(versionId);
  return {
    id: version.id,
    label: version.label,
    created_at: version.created_at,
    cue_count: version.cue_count,
    lights,
    cues,
  };
}

app.post('/api/versions', (req, res) => {
  const labelRaw = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
  const label = labelRaw || `演出版本 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;

  const lights = db.prepare('SELECT * FROM lights ORDER BY id').all();
  const cues = db
    .prepare(
      `SELECT cue_no, light_id, time, target, duration
       FROM cues ORDER BY time, cue_no`
    )
    .all();

  const tx = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO versions (label, created_at, cue_count) VALUES (?, ?, ?)')
      .run(label, Date.now() / 1000, cues.length);
    const vid = info.lastInsertRowid;
    const insL = db.prepare(
      'INSERT INTO version_lights (version_id, light_id, name, pos) VALUES (?, ?, ?, ?)'
    );
    lights.forEach((l, i) => insL.run(vid, l.id, l.name, i));
    const insC = db.prepare(
      'INSERT INTO version_cues (version_id, cue_no, light_id, time, target, duration, pos) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    cues.forEach((c, i) =>
      insC.run(vid, c.cue_no, c.light_id, c.time, c.target, c.duration, i)
    );
    return vid;
  });

  const vid = tx();
  res.status(201).json(loadVersionSnapshot(vid));
});

app.get('/api/versions', (req, res) => {
  res.json(
    db
      .prepare('SELECT id, label, created_at, cue_count FROM versions ORDER BY id DESC')
      .all()
  );
});

app.get('/api/versions/:id', (req, res) => {
  const snap = loadVersionSnapshot(parseInt(req.params.id, 10));
  if (!snap) return err(res, 404, '版本不存在');
  res.json(snap);
});

/* --------------------------- 两版亮度差比对 ---------------------------- */
// 只读已发布快照：不触碰草稿 Cue/灯具，也不影响任何播放会话。
// GET（query，方便直接调用/分享链接）与 POST（JSON body）均支持，同一套校验。

function round6(n) {
  const r = Math.round(n * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

function handleCompare(req, res) {
  const input = { ...req.query, ...(req.body || {}) };

  // 版本编号：正整数且必须存在（相同版本可与自身比较）
  const ids = {};
  for (const key of ['a', 'b']) {
    const field = `version_${key}`;
    const id = toPosInt(input[field]);
    if (Number.isNaN(id)) {
      return err(res, 400, `版本编号无效：${JSON.stringify(input[field])}（须为正整数）`);
    }
    ids[key] = id;
  }
  const snapA = loadVersionSnapshot(ids.a);
  if (!snapA) return err(res, 404, `版本不存在：#${ids.a}`);
  const snapB = ids.b === ids.a ? snapA : loadVersionSnapshot(ids.b);
  if (!snapB) return err(res, 404, `版本不存在：#${ids.b}`);

  // 时窗起止 / 查看时刻：非负数字
  const nums = {};
  const numFields = { start: '时窗起点', end: '时窗终点', at: '查看时刻' };
  for (const field of ['start', 'end', 'at']) {
    const n = toNum(input[field]);
    if (Number.isNaN(n)) {
      return err(res, 400, `${numFields[field]}无效：${JSON.stringify(input[field])}（须为非负数字秒数）`);
    }
    if (n < 0) {
      return err(res, 400, `${numFields[field]}无效：${n}（不得为负）`);
    }
    nums[field] = n;
  }
  if (nums.start > nums.end) {
    return err(res, 400, `时窗起点（${nums.start}）不能大于终点（${nums.end}）`);
  }
  if (nums.at < nums.start || nums.at > nums.end) {
    return err(
      res,
      400,
      `查看时刻 ${nums.at} 超出时窗 [${nums.start}, ${nums.end}]`
    );
  }

  // 亮度差阈值：0～100
  const threshold = toNum(input.threshold);
  if (Number.isNaN(threshold)) {
    return err(res, 400, `亮度差阈值无效：${JSON.stringify(input.threshold)}（须为 0～100 的数字）`);
  }
  if (threshold < 0 || threshold > 100) {
    return err(res, 400, `亮度差阈值越界：${threshold}（须在 0～100 之间）`);
  }

  const cuesA = Engine.prepareCues(snapA.cues);
  const cuesB = Engine.prepareCues(snapB.cues);
  const mapA = new Map(snapA.lights.map((l) => [l.id, l.name]));
  const mapB = new Map(snapB.lights.map((l) => [l.id, l.name]));
  const commonIds = [...mapA.keys()].filter((id) => mapB.has(id)).sort((x, y) => x - y);

  const levels = [];
  const intervals = [];
  for (const id of commonIds) {
    const va = Engine.brightnessAt(cuesA, id, nums.at);
    const vb = Engine.brightnessAt(cuesB, id, nums.at);
    const diff = Math.abs(va - vb);
    levels.push({
      light_id: id,
      name: mapA.get(id),
      brightness_a: round6(va),
      brightness_b: round6(vb),
      difference: round6(diff),
      exceeds: diff > threshold + 1e-9,
    });
    // 零长度时窗：只返回该时刻亮度，不产生任何区间
    const segs =
      nums.end > nums.start
        ? Engine.differenceIntervals(cuesA, cuesB, id, nums.start, nums.end, threshold)
        : [];
    if (segs.length > 0) intervals.push({ light_id: id, name: mapA.get(id), intervals: segs });
  }

  // 配置差异：仅在一版存在的灯具单列；缺失不等于熄灭，不参与逐灯亮度比较
  const onlyA = [...mapA.keys()]
    .filter((id) => !mapB.has(id))
    .sort((x, y) => x - y)
    .map((id) => ({ light_id: id, name: mapA.get(id) }));
  const onlyB = [...mapB.keys()]
    .filter((id) => !mapA.has(id))
    .sort((x, y) => x - y)
    .map((id) => ({ light_id: id, name: mapB.get(id) }));

  res.json({
    versions: {
      a: { id: snapA.id, label: snapA.label },
      b: { id: snapB.id, label: snapB.label },
    },
    window: { start: nums.start, end: nums.end },
    at: nums.at,
    threshold,
    levels,
    intervals,
    config_differences: { only_in_a: onlyA, only_in_b: onlyB },
  });
}

app.get('/api/compare', handleCompare);
app.post('/api/compare', handleCompare);

/* ------------------------------ 临时调光记录 ----------------------------- */
// 排演人员针对已发布版本建立独立的临时调光记录；记录只绑定发布时的版本快照，
// 草稿修改与新版本发布都不影响既有记录。操作序列不可变地追加，提交须携带修订号。

const KIND_MAP = { override: 'override', return: 'return', 覆盖: 'override', 归还: 'return' };

class RevisionConflict extends Error {}

function loadOverrideRecord(recordId) {
  const rec = db.prepare('SELECT * FROM override_records WHERE id = ?').get(recordId);
  if (!rec) return null;
  const snap = loadVersionSnapshot(rec.version_id);
  // 版本为不可变快照，正常必存在；防御性兜底
  if (!snap) return null;
  const operations = db
    .prepare(
      `SELECT seq, light_id, time, kind, duration, target
       FROM override_ops WHERE record_id = ? ORDER BY seq ASC`
    )
    .all(rec.id)
    .map((o) => ({
      seq: o.seq,
      light_id: o.light_id,
      time: o.time,
      kind: o.kind,
      duration: o.duration,
      target: o.target,
    }));
  return {
    id: rec.id,
    name: rec.name,
    created_at: rec.created_at,
    revision: rec.revision,
    version_id: rec.version_id,
    version: { id: snap.id, label: snap.label },
    lights: snap.lights,
    cues: snap.cues,
    operations,
  };
}

/** 校验一条调光操作（灯具必须存在于绑定版本的快照中） */
function validateOverrideOp(input, snapLights, prefix) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { error: `${prefix}操作必须是一个对象` };
  }

  const lightId = toPosInt(input.light_id);
  if (Number.isNaN(lightId)) {
    return { error: `${prefix}灯具编号无效：${JSON.stringify(input.light_id)}（须为正整数）` };
  }
  if (!snapLights.some((l) => l.id === lightId)) {
    return { error: `${prefix}未知灯具：编号 ${lightId} 不在该记录绑定版本的快照中` };
  }

  const time = toNum(input.time);
  if (Number.isNaN(time)) return { error: `${prefix}非法时码：${JSON.stringify(input.time)}（须为数字）` };
  if (time < 0) return { error: `${prefix}非法时码：${time}（不得为负）` };

  const kind = KIND_MAP[input.kind];
  if (!kind) {
    return { error: `${prefix}操作类型无效：${JSON.stringify(input.kind)}（须为 override 覆盖 或 return 归还）` };
  }

  const duration = toNum(input.duration);
  if (Number.isNaN(duration)) {
    return { error: `${prefix}非法时长：${JSON.stringify(input.duration)}（须为数字）` };
  }
  if (duration < 0) return { error: `${prefix}非法时长：${duration}（不得为负）` };

  const value = { light_id: lightId, time, kind, duration, target: null };

  if (kind === 'override') {
    const target = toNum(input.target);
    if (Number.isNaN(target)) {
      return { error: `${prefix}覆盖操作必须提供目标亮度：${JSON.stringify(input.target)}（须为数字）` };
    }
    if (target < 0 || target > 100) {
      return { error: `${prefix}无效目标亮度：${target}（须在 0～100 之间）` };
    }
    value.target = target;
  }
  return { value };
}

// 建立记录
app.post('/api/override-records', (req, res) => {
  const versionId = toPosInt(req.body?.version_id);
  if (Number.isNaN(versionId)) {
    return err(res, 400, `版本编号无效：${JSON.stringify(req.body?.version_id)}（须为正整数）`);
  }
  const version = db.prepare('SELECT id FROM versions WHERE id = ?').get(versionId);
  if (!version) return err(res, 404, `版本不存在：#${versionId}`);

  const nameRaw = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const name = nameRaw || `临时调光 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;

  const info = db
    .prepare('INSERT INTO override_records (version_id, name, created_at, revision) VALUES (?, ?, ?, 0)')
    .run(versionId, name, Date.now() / 1000);
  res.status(201).json(loadOverrideRecord(info.lastInsertRowid));
});

// 记录列表
app.get('/api/override-records', (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.created_at, r.revision, r.version_id, v.label AS version_label
       FROM override_records r JOIN versions v ON v.id = r.version_id
       ORDER BY r.id DESC`
    )
    .all();
  res.json(rows);
});

// 记录详情：含绑定版本快照（灯具 + 原版 Cue）与全部操作，供跳转/刷新后整体重算
app.get('/api/override-records/:id', (req, res) => {
  const rec = loadOverrideRecord(parseInt(req.params.id, 10));
  if (!rec) return err(res, 404, '临时调光记录不存在');
  res.json(rec);
});

// 追加操作：body 形如 { revision, operations: [...] }（单条也用数组承载）
app.post('/api/override-records/:id/operations', (req, res) => {
  const rec = db
    .prepare('SELECT * FROM override_records WHERE id = ?')
    .get(parseInt(req.params.id, 10));
  if (!rec) return err(res, 404, '临时调光记录不存在');
  const snap = loadVersionSnapshot(rec.version_id);

  const body = req.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return err(res, 400, '提交体必须是对象：{ revision: 修订号, operations: [操作...] }');
  }

  // 修订号：非负整数，必填（过期修订号在事务内判定为冲突，且不写入）
  const revision = toNum(body.revision);
  if (Number.isNaN(revision) || !Number.isInteger(revision) || revision < 0) {
    return err(res, 400, `记录修订号无效：${JSON.stringify(body.revision)}（须为非负整数）`);
  }

  if (!Array.isArray(body.operations) || body.operations.length === 0) {
    return err(res, 400, 'operations 必须是非空数组；整次提交不做部分写入');
  }

  const parsed = [];
  let lastTime = db
    .prepare('SELECT MAX(time) AS t FROM override_ops WHERE record_id = ?')
    .get(rec.id).t;
  if (lastTime === null || lastTime === undefined) lastTime = null;

  for (let i = 0; i < body.operations.length; i++) {
    const prefix = `第 ${i + 1} 条：`;
    const r = validateOverrideOp(body.operations[i], snap.lights, prefix);
    if (r.error) return err(res, 400, r.error);
    // 仅允许时码不早于末项的追加（批内同样按提交顺序单调）
    if (lastTime !== null && r.value.time + 1e-9 < lastTime) {
      return err(
        res,
        400,
        `${prefix}时码 ${r.value.time} 早于记录末项时码 ${lastTime}，仅允许不早于末项的追加`
      );
    }
    lastTime = r.value.time;
    parsed.push(r.value);
  }

  const insert = db.prepare(
    'INSERT INTO override_ops (record_id, seq, light_id, time, kind, duration, target) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const tx = db.transaction((items, baseRevision) => {
    const cur = db.prepare('SELECT revision FROM override_records WHERE id = ?').get(rec.id);
    if (cur.revision !== baseRevision) {
      throw new RevisionConflict(`修订号已过期：提交基于 ${baseRevision}，当前为 ${cur.revision}`);
    }
    items.forEach((v, i) => {
      insert.run(rec.id, baseRevision + i + 1, v.light_id, v.time, v.kind, v.duration, v.target);
    });
    db.prepare('UPDATE override_records SET revision = ? WHERE id = ?').run(
      baseRevision + items.length,
      rec.id
    );
  });

  try {
    tx(parsed, revision);
  } catch (e) {
    if (e instanceof RevisionConflict) {
      // 冲突：整次提交不写入
      const cur = db.prepare('SELECT revision FROM override_records WHERE id = ?').get(rec.id);
      res.setHeader('X-Record-Revision', String(cur.revision));
      return err(res, 409, e.message);
    }
    throw e;
  }
  res.status(201).json(loadOverrideRecord(rec.id));
});

/* ------------------------------- 错误处理 ------------------------------ */

// JSON 解析失败（如非法时码导致的畸形 JSON 之外的格式错误）
app.use((e, req, res, next) => {
  if (e.type === 'entity.parse.failed') {
    return err(res, 400, '请求体不是合法 JSON，提交已拒绝');
  }
  console.error(e);
  err(res, 500, '服务器内部错误');
});

// 前端单页回退（API 未命中返回 JSON 404）
app.use('/api', (req, res) => err(res, 404, `接口不存在：${req.method} ${req.path}`));
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`小剧场灯光 Cue 排演应用已启动: http://localhost:${PORT}`);
  console.log(`数据库: ${DB_PATH}`);
});
