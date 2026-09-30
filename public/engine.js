/*
 * 灯光 Cue 渐变引擎（纯函数，无依赖）
 * 浏览器与 Node 共用：浏览器挂到 window.LightingEngine，Node 通过 module.exports 引入。
 *
 * 规则：
 *  - 每条 Cue 在 time 秒触发，把指定灯具从触发瞬间的“实际亮度”线性渐变到 target，
 *    渐变耗时 duration 秒（0 表示瞬变）。
 *  - 新 Cue 到来时，若该灯仍在上一条 Cue 的渐变中，以上一渐变在该时刻的实际亮度
 *    为起点转向新目标（中途接管，不跳变）。
 *  - 同一秒触发的多条 Cue，按 Cue 编号（cue_no）从小到大依次生效：
 *      · 前一条是普通渐变时，它在同一瞬间尚未来得及渐变，起点取其起始亮度；
 *      · 前一条是 0 秒瞬变时，它先一步跳到目标，起点取其目标亮度。
 *  - 亮度始终限制在 0～100。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LightingEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN = 0;
  const MAX = 100;

  function clamp(v) {
    if (v < MIN) return MIN;
    if (v > MAX) return MAX;
    return v;
  }

  /**
   * 整理一场演出的 Cue：按触发时码、再按 Cue 编号（同秒先后次序）排序，
   * 并为每盏灯把 Cue 展开成“渐变段”，预先记录每条 Cue 触发瞬间的实际起始亮度。
   * cue 字段：{ cue_no, light_id, time, target, duration }
   */
  function prepareCues(cues) {
    const ordered = cues
      .map((c) => ({
        cueNo: c.cue_no,
        lightId: c.light_id,
        time: Number(c.time),
        target: clamp(Number(c.target)),
        duration: Number(c.duration),
        end: Number(c.time) + Number(c.duration),
        from: 0, // 触发瞬间的实际亮度，下面按灯逐条计算
      }))
      .sort((a, b) => a.time - b.time || a.cueNo - b.cueNo);

    // 每盏灯只与自己的上一条 Cue 衔接
    const last = new Map();
    for (const seg of ordered) {
      const prev = last.get(seg.lightId);
      if (!prev) {
        seg.from = 0; // 该灯的第一条 Cue：从熄灭状态起步
      } else if (seg.time > prev.time) {
        if (seg.time >= prev.end || prev.duration === 0) {
          seg.from = prev.target; // 上一渐变已结束（或为瞬变）：保持在目标
        } else {
          // 中途接管：取上一渐变在新 Cue 触发时刻的实际亮度
          const k = (seg.time - prev.time) / prev.duration;
          seg.from = clamp(prev.from + (prev.target - prev.from) * k);
        }
      } else {
        // 同一时刻触发（已按编号排好序）：
        // 瞬变 Cue 先一步跳到目标；普通渐变此刻还未产生变化，取其起始亮度
        seg.from = prev.duration === 0 ? prev.target : prev.from;
      }
      last.set(seg.lightId, seg);
    }
    return ordered;
  }

  /**
   * 计算 t 秒时某盏灯的实际亮度：
   * 只需找到该灯“触发时刻 <= t”的最后一条 Cue（即当前生效段）。
   */
  function brightnessAt(orderedCues, lightId, t) {
    let active = null;
    for (const seg of orderedCues) {
      if (seg.lightId !== lightId) continue;
      if (seg.time > t) break; // 全局已按 time, cueNo 排序
      active = seg;
    }
    if (!active) return 0;
    if (active.duration === 0 || t >= active.end) return active.target;
    const k = (t - active.time) / active.duration;
    return clamp(active.from + (active.target - active.from) * k);
  }

  /** 整场演出所有灯具在 t 秒的亮度表 { lightId: brightness } */
  function levelsAt(orderedCues, lights, t) {
    const out = {};
    for (const l of lights) {
      out[l.id] = brightnessAt(orderedCues, l.id, t);
    }
    return out;
  }

  /** 演出总时长 = 最后一条 Cue 渐变结束时刻（无 Cue 时为 0） */
  function showDuration(orderedCues) {
    let d = 0;
    for (const c of orderedCues) {
      if (c.end > d) d = c.end;
    }
    return d;
  }

  /* ----------- 临时调光记录：在原版 Cue 之上叠加“覆盖 / 归还”操作 ----------- */

  /**
   * 计算某个调光操作在 t（>= op.time）时刻给出的实际输出。
   * baseCues 为 prepareCues 后的原版 Cue（始终在后台按既有规则运行）。
   *
   *  - 覆盖（override）：从操作瞬间的实际输出 op.from 线性渐变到 target，此后保持。
   *  - 归还（return）：以 op.from 为固定锚点，在 duration 内按进度与“该时刻持续
   *    变化的原版亮度”线性融合；结束后完全跟随原版。
   *  - duration 为 0 时立即生效：覆盖即刻到 target，归还即刻等于原版亮度。
   */
  function operationValue(op, t, baseCues) {
    const baseAt = (tt) => brightnessAt(baseCues, op.lightId, tt);
    if (op.duration === 0) {
      return op.kind === 'override' ? op.target : clamp(baseAt(t));
    }
    if (t >= op.end) {
      return op.kind === 'override' ? op.target : clamp(baseAt(t));
    }
    // t === op.time 时 p = 0，取操作起点实际输出（无跳变）
    const p = (t - op.time) / op.duration;
    if (op.kind === 'override') {
      return clamp(op.from + (op.target - op.from) * p);
    }
    return clamp(op.from * (1 - p) + baseAt(t) * p);
  }

  /**
   * 整理一条临时调光记录的操作序列：
   * 全局按（时码 time, 追加序号 seq）排序——同秒操作按追加顺序生效；
   * 并为每盏灯逐条计算每个操作起点瞬间的“实际输出”：
   * 下一操作可在上一操作尚未结束的渐变中途直接接管（不跳变、不重置），
   * 规则与原版 Cue 的中途接管一致。
   *
   * op 字段：{ seq, light_id, time, kind: 'override' | 'return', duration, target? }
   * target 仅覆盖操作需要；不属于绑定版本快照灯具的操作被忽略（正常不会出现）。
   */
  function prepareOperations(baseCues, lights, operations) {
    const known = new Set((lights || []).map((l) => l.id));
    const ordered = operations
      .filter((o) => known.has(o.light_id))
      .map((o) => ({
        seq: Number(o.seq),
        lightId: o.light_id,
        time: Number(o.time),
        kind: o.kind,
        duration: Number(o.duration),
        end: Number(o.time) + Number(o.duration),
        target: o.kind === 'override' ? clamp(Number(o.target)) : null,
        from: 0, // 操作起点瞬间的实际输出，下面按灯逐条计算
      }))
      .sort((a, b) => a.time - b.time || a.seq - b.seq);

    const last = new Map();
    for (const op of ordered) {
      const prev = last.get(op.lightId);
      op.from = prev
        ? operationValue(prev, op.time, baseCues) // 同秒/中途接管：取上一操作此刻实际输出
        : clamp(brightnessAt(baseCues, op.lightId, op.time));
      last.set(op.lightId, op);
    }
    return ordered;
  }

  /**
   * 叠加临时调光操作后，t 秒时某盏灯的实际亮度：
   * 找到该灯“时码 <= t”的最后一条操作（当前生效操作）；
   * 不存在操作时完全等于后台原版 Cue 的亮度。
   */
  function overrideBrightnessAt(baseCues, orderedOps, lightId, t) {
    let active = null;
    for (const op of orderedOps) {
      if (op.lightId !== lightId) continue;
      if (op.time > t) break; // 全局已按 time, seq 排序
      active = op;
    }
    if (!active) return brightnessAt(baseCues, lightId, t);
    return operationValue(active, t, baseCues);
  }

  /** 叠加临时调光后，t 秒所有灯具的实际亮度表 { lightId: brightness } */
  function overrideLevelsAt(baseCues, orderedOps, lights, t) {
    const out = {};
    for (const l of lights) {
      out[l.id] = overrideBrightnessAt(baseCues, orderedOps, l.id, t);
    }
    return out;
  }

  /** 记录重算的时间轴长度：原版结束时刻与所有操作结束时刻的较大者 */
  function overrideShowDuration(baseCues, orderedOps) {
    let d = showDuration(baseCues);
    for (const op of orderedOps) {
      if (op.end > d) d = op.end;
    }
    return d;
  }

  /* --------------------- 两版亮度差区间（精确解析解） --------------------- */

  // 浮点容差：用于“本应相等”的端点归类（阈值交点、重复转折点），
  // 输出也按 1e-9 四舍五入，避免二进制末位噪声。
  const EPS = 1e-9;

  function norm9(x) {
    const r = Math.round(x * 1e9) / 1e9;
    return r === 0 ? 0 : r;
  }

  /** 收集一版中某盏灯落在 [start, end] 内的全部转折点（Cue 触发时刻 + 渐变结束时刻） */
  function collectBreakpoints(orderedCues, lightId, start, end, out) {
    for (const seg of orderedCues) {
      if (seg.lightId !== lightId) continue;
      if (seg.time >= start && seg.time <= end) out.push(seg.time);
      if (seg.end >= start && seg.end <= end) out.push(seg.end);
    }
  }

  /**
   * 取 t 所在开区间上该灯亮度的线性表达式 b(t) = a*t + b0。
   * 调用方保证 t 不落在任何转折点上：此时生效段唯一，亮度必为线性（含常量）。
   */
  function lineAt(orderedCues, lightId, t) {
    let active = null;
    for (const seg of orderedCues) {
      if (seg.lightId !== lightId) continue;
      if (seg.time > t) break; // 全局已按 time, cueNo 排序
      active = seg;
    }
    if (!active) return { a: 0, b: 0 };
    if (active.duration === 0 || t >= active.end) return { a: 0, b: active.target };
    const a = (active.target - active.from) / active.duration;
    return { a, b: active.from - a * active.time };
  }

  function snapEdge(x, u, v) {
    if (Math.abs(x - u) <= EPS) return u;
    if (Math.abs(x - v) <= EPS) return v;
    return x;
  }

  /**
   * 开区间 (u,v) 内 L(t)=a*t+b0 为线性，求 |L| > threshold 的部分，
   * 以两端开区间形式加入 pieces（端点是否属于集合由转折点上的单点决定）。
   */
  function pushLinearPieces(pieces, a, b0, u, v, threshold) {
    const open = (lo, hi) => {
      if (hi - lo > EPS) pieces.push({ lo, hi, loInc: false, hiInc: false });
    };
    if (Math.abs(a) <= EPS) {
      if (Math.abs(b0) - threshold > EPS) open(u, v);
      return;
    }
    const rHi = snapEdge((threshold - b0) / a, u, v);  // L = +threshold
    const rLo = snapEdge((-threshold - b0) / a, u, v); // L = -threshold
    if (a > 0) {
      if (rHi < v) open(Math.max(u, rHi), v); // L > threshold：t > rHi
      if (rLo > u) open(u, Math.min(v, rLo)); // L < -threshold：t < rLo
    } else {
      if (rHi > u) open(u, Math.min(v, rHi)); // L > threshold：t < rHi
      if (rLo < v) open(Math.max(u, rLo), v); // L < -threshold：t > rLo
    }
  }

  /**
   * 合并一维区间（含端点包含性）。相邻 [..,x] 与 [x,..] 只要任一侧包含 x 即连通，
   * 因此夹在中间的闭单点（瞬变造成的孤立超差时刻）能把两侧区间桥接起来。
   */
  function unionPieces(input) {
    const ps = input
      .map((p) => ({ ...p }))
      .sort((x, y) => x.lo - y.lo || Number(y.loInc) - Number(x.loInc));
    const out = [];
    for (const p of ps) {
      let cur = p;
      while (out.length) {
        const q = out[out.length - 1];
        const atJoint = Math.abs(cur.lo - q.hi) <= EPS;
        const overlap = cur.lo < q.hi && !atJoint;
        if (!overlap && !(atJoint && (q.hiInc || cur.loInc))) break;
        out.pop();
        let lo, loInc, hi, hiInc;
        if (q.lo < cur.lo) { lo = q.lo; loInc = q.loInc; }
        else if (cur.lo < q.lo) { lo = cur.lo; loInc = cur.loInc; }
        else { lo = q.lo; loInc = q.loInc || cur.loInc; }
        if (q.hi > cur.hi) { hi = q.hi; hiInc = q.hiInc; }
        else if (cur.hi > q.hi) { hi = cur.hi; hiInc = cur.hiInc; }
        else { hi = q.hi; hiInc = q.hiInc || cur.hiInc; }
        cur = { lo, hi, loInc, hiInc };
      }
      out.push(cur);
    }
    return out
      .filter((p) => p.hi - p.lo > EPS || (p.loInc && p.hiInc))
      .map((p) => ({
        start: norm9(p.lo),
        end: norm9(p.hi),
        start_inclusive: p.loInc,
        end_inclusive: p.hiInc,
      }));
  }

  /**
   * 计算时窗 [start, end] 内，某盏灯在两版间亮度差严格大于 threshold 的全部连续区间。
   *
   * 精确做法（不做固定间隔采样）：
   *  1. 转折点 = 两版该灯全部 Cue 触发时刻与渐变结束时刻（再加时窗端点）。
   *     瞬变只在触发点造成跳变，其余位置两版亮度均连续（中途接管不跳变）。
   *  2. 相邻转折点之间，两版亮度各为一条直线，差值 |L(t)| 为线性函数取绝对值，
   *     与 ±threshold 的交点用一次方程精确求出，严格大于故交点本身为开端点。
   *  3. 每个转折点处按引擎语义（同秒编号顺序、瞬变、接管）取真实亮度，
   *     超差则作为闭单点参与合并，从而准确界定跳变时刻的端点包含性
   *     （含“仅某一瞬间超差”的零长度区间 [t,t]）。
   *
   * cuesA/cuesB 均为 prepareCues 的结果；start === end（零长度时窗）返回 []。
   */
  function differenceIntervals(cuesA, cuesB, lightId, start, end, threshold) {
    if (!(end > start)) return [];

    const bp = [start, end];
    collectBreakpoints(cuesA, lightId, start, end, bp);
    collectBreakpoints(cuesB, lightId, start, end, bp);
    bp.sort((x, y) => x - y);
    const points = [];
    for (const t of bp) {
      if (!points.length || points[points.length - 1] !== t) points.push(t);
    }

    const pieces = [];

    // 转折点上的真实取值（瞬变跳变只可能发生在这里）
    for (const p of points) {
      const d = Math.abs(brightnessAt(cuesA, lightId, p) - brightnessAt(cuesB, lightId, p));
      if (d - threshold > EPS) {
        pieces.push({ lo: p, hi: p, loInc: true, hiInc: true });
      }
    }

    // 相邻转折点之间：差值为 |线性函数|，精确解交点
    for (let i = 0; i + 1 < points.length; i++) {
      const u = points[i];
      const v = points[i + 1];
      if (!(v - u > EPS)) continue; // 近重复点造成的退化段
      const m = (u + v) / 2;
      const la = lineAt(cuesA, lightId, m);
      const lb = lineAt(cuesB, lightId, m);
      pushLinearPieces(pieces, la.a - lb.a, la.b - lb.b, u, v, threshold);
    }

    return unionPieces(pieces);
  }

  return {
    clamp,
    prepareCues,
    brightnessAt,
    levelsAt,
    showDuration,
    prepareOperations,
    overrideBrightnessAt,
    overrideLevelsAt,
    overrideShowDuration,
    differenceIntervals,
  };
});
