'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../public/engine.js');

// 后台原版：可由多条 Cue 构成
const prep = (cues) => Engine.prepareCues(cues);
const build = (cues, lights, ops) =>
  Engine.prepareOperations(prep(cues), lights, ops);
const val = (cues, lights, ops, id, t) =>
  Engine.overrideBrightnessAt(prep(cues), build(cues, lights, ops), id, t);
const approx = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !=~ ${expected}`);

const LIGHTS = [{ id: 1 }, { id: 2 }];

test('无操作时实际输出完全等于后台原版亮度', () => {
  const cues = [{ cue_no: 1, light_id: 1, time: 0, target: 100, duration: 10 }];
  assert.equal(val(cues, LIGHTS, [], 1, 5), 50);
  assert.equal(val(cues, LIGHTS, [], 1, 20), 100);
});

test('0 秒覆盖立即生效并保持，原版仍在后台运行', () => {
  // 原版：0→100 用 10 秒；t=5 覆盖到 20（0 秒）
  const cues = [{ cue_no: 1, light_id: 1, time: 0, target: 100, duration: 10 }];
  const ops = [{ seq: 1, light_id: 1, time: 5, kind: 'override', duration: 0, target: 20 }];
  approx(val(cues, LIGHTS, ops, 1, 4.9), 49);
  assert.equal(val(cues, LIGHTS, ops, 1, 5), 20);
  assert.equal(val(cues, LIGHTS, ops, 1, 8), 20); // 覆盖保持，不跟随原版
  assert.equal(val(cues, LIGHTS, ops, 1, 100), 20);
});

test('覆盖从操作瞬间实际输出线性渐变到目标，此后保持', () => {
  // 原版：0→100 用 10 秒；t=5 实际 50 → 覆盖目标 0 用 10 秒（50→0）
  const cues = [{ cue_no: 1, light_id: 1, time: 0, target: 100, duration: 10 }];
  const ops = [{ seq: 1, light_id: 1, time: 5, kind: 'override', duration: 10, target: 0 }];
  assert.equal(val(cues, LIGHTS, ops, 1, 5), 50);
  assert.equal(val(cues, LIGHTS, ops, 1, 10), 25);
  assert.equal(val(cues, LIGHTS, ops, 1, 15), 0);
  assert.equal(val(cues, LIGHTS, ops, 1, 30), 0); // 保持目标
});

test('归还以操作瞬间实际输出为起点，与持续变化的原版亮度线性融合', () => {
  // 原版：0→100 用 10 秒；t=2 实际 20 被覆盖到 80（0 秒）；
  // t=5 实际 80 发起归还，时长 10 秒。原版在 t∈[5,10] 为 10(t)，t>=10 恒 100。
  const cues = [{ cue_no: 1, light_id: 1, time: 0, target: 100, duration: 10 }];
  const ops = [
    { seq: 1, light_id: 1, time: 2, kind: 'override', duration: 0, target: 80 },
    { seq: 2, light_id: 1, time: 5, kind: 'return', duration: 10 },
  ];
  assert.equal(val(cues, LIGHTS, ops, 1, 5), 80); // p=0：起点实际输出
  // p=0.5（t=10）：0.5*80 + 0.5*base(10)=0.5*80+0.5*100 = 90
  assert.equal(val(cues, LIGHTS, ops, 1, 10), 90);
  // p=0.25（t=7.5）：0.75*80 + 0.25*75 = 60 + 18.75
  approx(val(cues, LIGHTS, ops, 1, 7.5), 78.75);
  assert.equal(val(cues, LIGHTS, ops, 1, 15), 100); // 结束后完全跟随原版
  assert.equal(val(cues, LIGHTS, ops, 1, 50), 100);
});

test('0 秒归还立即等于操作瞬间原版亮度（覆盖被立刻撤销）', () => {
  const cues = [{ cue_no: 1, light_id: 1, time: 0, target: 100, duration: 10 }];
  const ops = [
    { seq: 1, light_id: 1, time: 2, kind: 'override', duration: 0, target: 80 },
    { seq: 2, light_id: 1, time: 5, kind: 'return', duration: 0 },
  ];
  approx(val(cues, LIGHTS, ops, 1, 4.999), 80);
  assert.equal(val(cues, LIGHTS, ops, 1, 5), 50); // 立刻等于原版 50
  assert.equal(val(cues, LIGHTS, ops, 1, 8), 80);
});

test('下一覆盖操作可在渐变中途接管未完成的渐变', () => {
  // 覆盖1：t=0 实际 0 → 100 用 10；t=5 实际 50 被覆盖2：50 → 0 用 5
  const cues = [];
  const ops = [
    { seq: 1, light_id: 1, time: 0, kind: 'override', duration: 10, target: 100 },
    { seq: 2, light_id: 1, time: 5, kind: 'override', duration: 5, target: 0 },
  ];
  assert.equal(val(cues, LIGHTS, ops, 1, 0), 0);
  assert.equal(val(cues, LIGHTS, ops, 1, 4), 40);
  assert.equal(val(cues, LIGHTS, ops, 1, 5), 50);
  assert.equal(val(cues, LIGHTS, ops, 1, 7.5), 25);
  assert.equal(val(cues, LIGHTS, ops, 1, 10), 0);
  assert.equal(val(cues, LIGHTS, ops, 1, 11), 0);
});

test('归还中途被覆盖接管：接管点取当时实际融合输出', () => {
  // t=0 覆盖到 80（0 秒）；t=2 归还时长 8 秒：t=6 时 p=0.5，值=0.5*80+0.5*base=40
  // （原版恒 0）；t=6 覆盖到 100 时长 0 → 立即 100 并保持
  const cues = [];
  const ops = [
    { seq: 1, light_id: 1, time: 0, kind: 'override', duration: 0, target: 80 },
    { seq: 2, light_id: 1, time: 2, kind: 'return', duration: 8 },
    { seq: 3, light_id: 1, time: 6, kind: 'override', duration: 0, target: 100 },
  ];
  assert.equal(val(cues, LIGHTS, ops, 1, 5), 50);
  assert.equal(val(cues, LIGHTS, ops, 1, 6), 100);
  assert.equal(val(cues, LIGHTS, ops, 1, 9), 100);
});

test('同秒操作按追加顺序（seq）生效', () => {
  const cues = [];
  const ops = [
    { seq: 1, light_id: 1, time: 3, kind: 'override', duration: 0, target: 10 },
    { seq: 2, light_id: 1, time: 3, kind: 'override', duration: 0, target: 90 },
  ];
  assert.equal(val(cues, LIGHTS, ops, 1, 3), 90);
  // 调换 seq：后追加者接管
  const ops2 = ops.map((o) => ({ ...o, seq: o.seq === 1 ? 2 : 1 }));
  assert.equal(val(cues, LIGHTS, ops2, 1, 3), 10);
});

test('同秒：先 0 秒覆盖、后渐变覆盖；渐变从瞬变后的亮度起步', () => {
  const cues = [];
  const ops = [
    { seq: 1, light_id: 1, time: 0, kind: 'override', duration: 0, target: 80 },
    { seq: 2, light_id: 1, time: 0, kind: 'override', duration: 10, target: 100 },
  ];
  assert.equal(val(cues, LIGHTS, ops, 1, 0), 80);
  assert.equal(val(cues, LIGHTS, ops, 1, 5), 90);
  assert.equal(val(cues, LIGHTS, ops, 1, 10), 100);
});

test('同秒：先归还（0秒）再覆盖，归还瞬间锚定原版', () => {
  // 原版恒 60；先覆盖到 10，同秒归还 0 秒 → 立刻等于原版 60；
  // 再覆盖 0 秒到 30 → 最终 30
  const cues = [{ cue_no: 1, light_id: 1, time: 0, target: 60, duration: 0 }];
  const ops = [
    { seq: 1, light_id: 1, time: 4, kind: 'override', duration: 0, target: 10 },
    { seq: 2, light_id: 1, time: 4, kind: 'return', duration: 0 },
    { seq: 3, light_id: 1, time: 4, kind: 'override', duration: 0, target: 30 },
  ];
  assert.equal(val(cues, LIGHTS, ops, 1, 3.999), 60);
  assert.equal(val(cues, LIGHTS, ops, 1, 4), 30);
});

test('操作只影响指定灯具，多灯互不干扰', () => {
  const cues = [
    { cue_no: 1, light_id: 1, time: 0, target: 100, duration: 10 },
    { cue_no: 2, light_id: 2, time: 0, target: 40, duration: 0 },
  ];
  const ops = [{ seq: 1, light_id: 1, time: 5, kind: 'override', duration: 0, target: 0 }];
  const built = build(cues, LIGHTS, ops);
  assert.deepEqual(Engine.overrideLevelsAt(prep(cues), built, LIGHTS, 8), {
    1: 0,  // 被覆盖
    2: 40, // 未操作：跟随原版
  });
});

test('overrideShowDuration 取原版与所有操作结束时刻的较大者', () => {
  const cues = [{ cue_no: 1, light_id: 1, time: 0, target: 100, duration: 4 }];
  const ops = [{ seq: 1, light_id: 1, time: 10, kind: 'override', duration: 5, target: 0 }];
  const built = build(cues, LIGHTS, ops);
  assert.equal(Engine.overrideShowDuration(prep(cues), built), 15);
  assert.equal(Engine.overrideShowDuration(prep(cues), []), 4);
});

test('刷新重算等价：只依赖版本快照与操作序列（prepare 幂等）', () => {
  const cues = [{ cue_no: 1, light_id: 1, time: 0, target: 100, duration: 10 }];
  const ops = [
    { seq: 1, light_id: 1, time: 2, kind: 'override', duration: 0, target: 80 },
    { seq: 2, light_id: 1, time: 5, kind: 'return', duration: 10 },
  ];
  const first = Engine.prepareOperations(prep(cues), LIGHTS, ops);
  const second = Engine.prepareOperations(prep(cues), LIGHTS, ops);
  for (const t of [0, 2, 5, 7.5, 10, 15, 30]) {
    assert.equal(
      Engine.overrideBrightnessAt(prep(cues), first, 1, t),
      Engine.overrideBrightnessAt(prep(cues), second, 1, t)
    );
  }
});

test('归还结束后原版继续变化时实际输出完全跟随原版', () => {
  // 原版：t=0 瞬变 100，t=10 瞬变 0；t=2 覆盖到 50（0 秒），t=4 归还时长 2 秒。
  const cues = [
    { cue_no: 1, light_id: 1, time: 0, target: 100, duration: 0 },
    { cue_no: 2, light_id: 1, time: 10, target: 0, duration: 0 },
  ];
  const ops = [
    { seq: 1, light_id: 1, time: 2, kind: 'override', duration: 0, target: 50 },
    { seq: 2, light_id: 1, time: 4, kind: 'return', duration: 2 },
  ];
  assert.equal(val(cues, LIGHTS, ops, 1, 6), 100); // 归还结束，跟随原版 100
  assert.equal(val(cues, LIGHTS, ops, 1, 10), 0);  // 原版瞬变，实际同步
});
