'use strict';

const Engine = window.LightingEngine;

const state = {
  lights: [],
  cues: [],
  versions: [],
  // 播放器会话：一旦开始播放，快照与排序后的 Cue 即冻结，草稿/新发布不影响本次播放
  session: null,
  time: 0,
  playing: false,
  speed: 1,
  rafId: null,
  lastWall: 0,
};

/* ------------------------------- API ------------------------------- */

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

const fmt = (n) => {
  const v = Math.round(n * 100) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (id) => document.getElementById(id);
const showErr = (el, msg) => { el.textContent = msg; el.hidden = false; };
const clearErr = (el) => { el.hidden = true; el.textContent = ''; };

/* ----------------------------- 标签页 ----------------------------- */

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach((p) =>
      p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`)
    );
  });
});

/* ----------------------------- 灯具 ----------------------------- */

async function loadLights() {
  state.lights = await api('GET', '/api/lights');
  renderLights();
  renderLightOptions();
}

function renderLights() {
  const tb = $('light-table').querySelector('tbody');
  tb.innerHTML = state.lights
    .map(
      (l) => `
      <tr>
        <td>#${l.id}</td>
        <td>${esc(l.name)}</td>
        <td><button class="danger" data-del-light="${l.id}">删除</button></td>
      </tr>`
    )
    .join('');
}

function renderLightOptions() {
  const opts = state.lights.map((l) => `<option value="${l.id}">#${l.id} ${esc(l.name)}</option>`).join('');
  $('cue-light').innerHTML = opts;
}

$('form-light').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErr($('light-error'));
  const name = $('light-name').value.trim();
  if (!name) return;
  try {
    await api('POST', '/api/lights', { name });
    $('light-name').value = '';
    await loadLights();
  } catch (err) {
    showErr($('light-error'), err.message);
  }
});

$('light-table').addEventListener('click', async (e) => {
  const id = e.target.dataset?.delLight;
  if (!id) return;
  clearErr($('light-error'));
  try {
    await api('DELETE', `/api/lights/${id}`);
    await loadLights();
  } catch (err) {
    showErr($('light-error'), err.message);
  }
});

/* ----------------------------- 草稿 Cue ----------------------------- */

async function loadCues() {
  state.cues = await api('GET', '/api/cues');
  renderCues();
}

function renderCues() {
  const tb = $('cue-table').querySelector('tbody');
  tb.innerHTML = state.cues
    .map(
      (c) => `
      <tr data-cue-id="${c.id}">
        <td class="edit-cell"><input data-f="cue_no" type="number" min="1" step="1" value="${c.cue_no}" /></td>
        <td>
          <select data-f="light_id">
            ${state.lights
              .map((l) => `<option value="${l.id}" ${l.id === c.light_id ? 'selected' : ''}>#${l.id} ${esc(l.name)}</option>`)
              .join('')}
          </select>
        </td>
        <td class="edit-cell"><input data-f="time" type="number" min="0" step="0.1" value="${c.time}" /></td>
        <td class="edit-cell"><input data-f="target" type="number" min="0" max="100" step="0.1" value="${c.target}" /></td>
        <td class="edit-cell"><input data-f="duration" type="number" min="0" step="0.1" value="${c.duration}" /></td>
        <td>
          <button data-save-cue="${c.id}">保存</button>
          <button class="danger" data-del-cue="${c.id}">删除</button>
        </td>
      </tr>`
    )
    .join('');
}

$('form-cue').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErr($('cue-error'));
  const body = {
    light_id: Number($('cue-light').value),
    time: $('cue-time').value,
    target: $('cue-target').value,
    duration: $('cue-duration').value,
  };
  const no = $('cue-no').value.trim();
  if (no) body.cue_no = no;
  try {
    state.cues = await api('POST', '/api/cues', body);
    $('cue-no').value = '';
    renderCues();
  } catch (err) {
    showErr($('cue-error'), '提交被拒绝：' + err.message);
  }
});

$('cue-table').addEventListener('click', async (e) => {
  const saveId = e.target.dataset?.saveCue;
  const delId = e.target.dataset?.delCue;
  clearErr($('cue-error'));
  try {
    if (saveId) {
      const tr = e.target.closest('tr');
      const body = {};
      tr.querySelectorAll('[data-f]').forEach((el) => {
        body[el.dataset.f] = el.value;
      });
      state.cues = await api('PATCH', `/api/cues/${saveId}`, body);
      renderCues();
    } else if (delId) {
      await api('DELETE', `/api/cues/${delId}`);
      await loadCues();
    }
  } catch (err) {
    showErr($('cue-error'), '提交被拒绝：' + err.message);
  }
});

$('btn-bulk').addEventListener('click', async () => {
  clearErr($('bulk-error'));
  const payload = [];
  const lines = $('cue-bulk').value.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 4 && parts.length !== 5) {
      return showErr($('bulk-error'), `第 ${i + 1} 行格式错误：应为「时码 灯具编号 目标亮度 渐变时长 [Cue编号]」`);
    }
    const [time, light_id, target, duration, cue_no] = parts;
    const row = { time, light_id, target, duration };
    if (cue_no !== undefined) row.cue_no = cue_no;
    payload.push(row);
  }
  if (payload.length === 0) return showErr($('bulk-error'), '没有可提交的行');
  try {
    state.cues = await api('POST', '/api/cues', payload);
    $('cue-bulk').value = '';
    renderCues();
  } catch (err) {
    showErr($('bulk-error'), '整次提交已拒绝：' + err.message);
  }
});

/* ----------------------------- 发布版本 ----------------------------- */

async function loadVersions({ keepSelection = true } = {}) {
  const prev = $('version-select').value;
  const prevA = $('cmp-version-a').value;
  const prevB = $('cmp-version-b').value;
  state.versions = await api('GET', '/api/versions');
  renderVersions();
  renderVersionOptions(keepSelection ? prev : null);
  renderCompareOptions();
  if (keepSelection) {
    if (state.versions.some((v) => String(v.id) === String(prevA))) $('cmp-version-a').value = prevA;
    if (state.versions.some((v) => String(v.id) === String(prevB))) $('cmp-version-b').value = prevB;
  }
}

function renderVersions() {
  const tb = $('version-table').querySelector('tbody');
  tb.innerHTML = state.versions
    .map(
      (v) => `
      <tr>
        <td>#${v.id}</td>
        <td>${esc(v.label)}</td>
        <td>${new Date(v.created_at * 1000).toLocaleString('zh-CN', { hour12: false })}</td>
        <td>${v.cue_count}</td>
      </tr>`
    )
    .join('');
}

function renderVersionOptions(preferId) {
  const sel = $('version-select');
  if (state.versions.length === 0) {
    sel.innerHTML = '<option value="">— 请先发布一个版本 —</option>';
    return;
  }
  sel.innerHTML = state.versions
    .map((v) => `<option value="${v.id}">#${v.id} ${esc(v.label)}（${v.cue_count} 条 Cue）</option>`)
    .join('');
  if (preferId && state.versions.some((v) => String(v.id) === String(preferId))) {
    sel.value = preferId;
  }
}

$('form-publish').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErr($('publish-error'));
  try {
    const snap = await api('POST', '/api/versions', { label: $('version-label').value });
    $('version-label').value = '';
    await loadVersions({ keepSelection: false });
    $('version-select').value = String(snap.id);
    if (!state.playing) await loadSession(snap.id, true);
  } catch (err) {
    showErr($('publish-error'), err.message);
  }
});

/* ----------------------------- 播放器 ----------------------------- */

async function loadSession(versionId, resetTime) {
  const snap = await api('GET', `/api/versions/${versionId}`);
  const cues = Engine.prepareCues(snap.cues);
  state.session = {
    id: snap.id,
    label: snap.label,
    lights: snap.lights,
    cues,
    duration: Engine.showDuration(cues),
  };
  if (resetTime) state.time = 0;
  const tl = $('timeline');
  tl.max = String(Math.max(state.session.duration, 0));
  $('time-total').textContent = fmt(state.session.duration);
  $('session-info').textContent = `本次播放冻结于版本 #${snap.id}：${snap.label}`;
  renderPlayer();
}

$('version-select').addEventListener('change', async () => {
  if (state.playing) return; // 播放中不允许切换，保证使用开始时的版本
  const id = $('version-select').value;
  if (id) await loadSession(id, true);
});

function tick(ts) {
  if (!state.playing) return;
  const dt = ((ts - state.lastWall) / 1000) * state.speed;
  state.lastWall = ts;
  state.time += dt;
  if (state.time >= state.session.duration) {
    state.time = state.session.duration;
    state.playing = false;
    $('version-select').disabled = false;
    renderPlayer();
    return;
  }
  renderPlayer();
  state.rafId = requestAnimationFrame(tick);
}

$('btn-play').addEventListener('click', async () => {
  clearErr($('player-error'));
  try {
    const id = $('version-select').value;
    if (!id) return showErr($('player-error'), '还没有已发布版本，请先到「发布版本」页冻结一版。');
    // 开始播放时固定版本；暂停后继续则沿用同一会话
    if (!state.session || String(state.session.id) !== String(id)) {
      await loadSession(id, true);
    }
    if (state.time >= state.session.duration) state.time = 0; // 播完后再按播放：从头开始
    if (state.session.duration === 0) {
      state.time = 0;
      renderPlayer();
      return;
    }
    state.playing = true;
    state.lastWall = performance.now();
    $('version-select').disabled = true;
    state.rafId = requestAnimationFrame(tick);
  } catch (err) {
    showErr($('player-error'), err.message);
  }
});

$('btn-pause').addEventListener('click', pause);
function pause() {
  state.playing = false;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  $('version-select').disabled = false;
  renderPlayer();
}

$('btn-stop').addEventListener('click', () => {
  pause();
  state.time = 0;
  renderPlayer();
});

$('play-speed').addEventListener('change', (e) => {
  state.speed = Number(e.target.value);
});

$('timeline').addEventListener('input', (e) => {
  if (!state.session) return;
  state.time = Math.min(Math.max(Number(e.target.value), 0), state.session.duration);
  renderPlayer();
});

$('btn-jump').addEventListener('click', () => {
  clearErr($('player-error'));
  if (!state.session) return showErr($('player-error'), '请先选择并加载一个演出版本。');
  const t = Number($('jump-time').value);
  if (!Number.isFinite(t)) return showErr($('player-error'), '跳转时刻必须是数字。');
  if (t < 0) return showErr($('player-error'), `非法时码：${$('jump-time').value}（不得为负）。`);
  state.time = Math.min(t, state.session.duration);
  renderPlayer();
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)) {
    e.preventDefault();
    state.playing ? pause() : $('btn-play').click();
  }
});

function renderPlayer() {
  const s = state.session;
  const t = state.time;

  $('time-current').textContent = fmt(t);
  const tl = $('timeline');
  tl.value = String(t);

  if (!s) {
    $('stage').innerHTML = '<p class="muted" style="margin:auto">暂无演出版本</p>';
    $('levels').innerHTML = '';
    $('cue-timeline').querySelector('tbody').innerHTML = '';
    return;
  }

  const levels = Engine.levelsAt(s.cues, s.lights, t);

  // 舞台灯具
  $('stage').innerHTML = s.lights
    .map((l) => {
      const v = Math.round(levels[l.id] * 10) / 10;
      const a = v / 100;
      return `
        <div class="lamp">
          <div class="beam" style="
              background: rgba(245,185,66,${(0.05 + a * 0.95).toFixed(3)});
              box-shadow: 0 0 ${(12 + a * 46).toFixed(0)}px rgba(245,185,66,${(a * 0.85).toFixed(3)});
              border-color: rgba(245,185,66,${(0.2 + a * 0.6).toFixed(3)});
              color: ${a > 0.5 ? '#2a1d04' : '#555'};">${fmt(v)}</div>
          <div class="name" title="${esc(l.name)}">#${l.id} ${esc(l.name)}</div>
        </div>`;
    })
    .join('');

  // 亮度条
  $('levels').innerHTML = s.lights
    .map((l) => {
      const v = levels[l.id];
      return `
        <div class="level-item">
          <label><span>#${l.id} ${esc(l.name)}</span><span class="v">${fmt(v)}</span></label>
          <div class="level-track"><div class="level-fill" style="width:${v.toFixed(2)}%"></div></div>
        </div>`;
    })
    .join('');

  // Cue 时间线状态
  const nameOf = {};
  s.lights.forEach((l) => (nameOf[l.id] = l.name));
  $('cue-timeline').querySelector('tbody').innerHTML = s.cues
    .map((c) => {
      const end = c.time + c.duration;
      let status, cls;
      if (t < c.time) {
        status = '<span class="badge waiting">等待</span>';
        cls = '';
      } else if (c.duration > 0 && t < end) {
        status = '<span class="badge fading">渐变中</span>';
        cls = 'fading';
      } else {
        status = '<span class="badge done">已触发</span>';
        cls = 'done';
      }
      return `
        <tr class="${cls}">
          <td>${c.cueNo}</td>
          <td>#${c.lightId} ${esc(nameOf[c.lightId] || '?')}</td>
          <td>${fmt(c.time)}</td>
          <td>${fmt(c.target)}</td>
          <td>${fmt(c.duration)}</td>
          <td>${status}</td>
        </tr>`;
    })
    .join('');
}

/* ----------------------------- 版本比对 ----------------------------- */

function renderCompareOptions() {
  const make = (sel) => {
    if (state.versions.length === 0) {
      sel.innerHTML = '<option value="">— 暂无已发布版本 —</option>';
      return;
    }
    sel.innerHTML = state.versions
      .map((v) => `<option value="${v.id}">#${v.id} ${esc(v.label)}</option>`)
      .join('');
  };
  make($('cmp-version-a'));
  make($('cmp-version-b'));
  // 默认 A 选最新、B 选次新（或相同版本）
  if (state.versions.length > 0) $('cmp-version-a').value = String(state.versions[0].id);
  if (state.versions.length > 1) $('cmp-version-b').value = String(state.versions[1].id);
}

function intervalText(iv) {
  // [含端点 / (不含端点；start=end 表示仅该瞬间超差的零长度闭区间
  const s = iv.start_inclusive ? '[' : '(';
  const e = iv.end_inclusive ? ']' : ')';
  return `${s}${fmt(iv.start)}, ${fmt(iv.end)}${e}`;
}

$('form-compare').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErr($('compare-error'));
  const body = {
    version_a: $('cmp-version-a').value,
    version_b: $('cmp-version-b').value,
    start: $('cmp-start').value,
    end: $('cmp-end').value,
    at: $('cmp-at').value,
    threshold: $('cmp-threshold').value,
  };
  try {
    const d = await api('POST', '/api/compare', body);
    renderCompare(d);
  } catch (err) {
    $('compare-result').hidden = true;
    showErr($('compare-error'), '比对失败：' + err.message);
  }
});

function renderCompare(d) {
  $('compare-result').hidden = false;
  $('cmp-at-title').textContent =
    `查看时刻 t = ${fmt(d.at)} s：两版逐灯亮度（阈值 ${fmt(d.threshold)}）`;

  // 逐灯亮度
  $('cmp-levels').querySelector('tbody').innerHTML = d.levels
    .map((r) => `
      <tr class="${r.exceeds ? 'cmp-hot' : ''}">
        <td>#${r.light_id} ${esc(r.name)}</td>
        <td>${fmt(r.brightness_a)}</td>
        <td>${fmt(r.brightness_b)}</td>
        <td>${fmt(r.difference)}</td>
        <td>${r.exceeds ? '<span class="badge fading">超差</span>' : '<span class="badge done">否</span>'}</td>
      </tr>`)
    .join('');

  // 区间
  const zeroWindow = d.window.start === d.window.end;
  $('cmp-window-note').textContent = zeroWindow
    ? `零长度时窗 [${fmt(d.window.start)}, ${fmt(d.window.end)}]：仅返回该时刻亮度，不产生区间。`
    : `时窗 [${fmt(d.window.start)}, ${fmt(d.window.end)}] 秒，区间端点含 [ ] / 不含 ( )。`;
  $('cmp-intervals').querySelector('tbody').innerHTML = d.intervals
    .map((g) => `
      <tr>
        <td>#${g.light_id} ${esc(g.name)}</td>
        <td class="cmp-iv-list">${g.intervals.map(intervalText).map(esc).join('，')}</td>
        <td>${g.intervals.length}</td>
      </tr>`)
    .join('');
  $('cmp-no-diff').hidden = d.intervals.length > 0;

  // 配置差异
  const renderOnly = (list, label, cls) =>
    list.length
      ? `<div class="cmp-cfg-group ${cls}"><b>${label}（${list.length}）</b>：` +
        list.map((l) => `#${l.light_id} ${esc(l.name)}`).join('、') +
        '</div>'
      : '';
  const cfgHtml =
    renderOnly(d.config_differences.only_in_a, `仅存在于版本 A（#${d.versions.a.id}）`, 'only-a') +
    renderOnly(d.config_differences.only_in_b, `仅存在于版本 B（#${d.versions.b.id}）`, 'only-b');
  $('cmp-config').innerHTML = cfgHtml || '<p class="muted">两版灯具配置一致。</p>';
}

/* ----------------------------- 启动 ----------------------------- */

(async function init() {
  try {
    [state.lights, state.cues, state.versions] = await Promise.all([
      api('GET', '/api/lights'),
      api('GET', '/api/cues'),
      api('GET', '/api/versions'),
    ]);
    renderLights();
    renderLightOptions();
    renderCues();
    renderVersions();
    renderVersionOptions(null);
    renderCompareOptions();
    if (state.versions.length > 0) {
      await loadSession(state.versions[0].id, true); // 默认加载最新版本，停在 0 秒
    } else {
      renderPlayer();
    }
  } catch (err) {
    showErr($('player-error'), '初始化失败：' + err.message);
  }
})();
