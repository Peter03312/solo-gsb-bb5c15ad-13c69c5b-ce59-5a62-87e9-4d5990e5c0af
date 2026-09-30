# 小剧场灯光 Cue 排演（Lighting Cue Rehearsal）

一款用于小剧场灯光排演的 Web 应用。录入**灯具**与按演出秒数触发的 **Cue**
（灯具编号、目标亮度、非负渐变时长），所有灯光效果都在浏览器中模拟，**无需连接任何真实灯具**。
支持播放 / 暂停 / 跳转，并实时显示任意时刻每盏灯的实际亮度；发布后生成**不可变演出版本**。
排演人员还可针对已发布版本建立**临时调光记录**，按演出时码追加灯具的“覆盖 / 归还”操作，
查看任意时刻的逐灯实际输出（操作可中途接管，提交带修订号，刷新后按版本快照重算）。

技术栈：Node.js + Express + SQLite（better-sqlite3），原生 HTML/CSS/JS 前端，无前端构建步骤。

## 灯光规则

- 亮度范围 **0～100**，按**线性渐变**变化。
- 每条 Cue 在指定时码（非负秒数，支持小数）触发，把目标灯具从触发瞬间的**实际亮度**
  渐变到目标亮度；渐变时长为非负秒数，`0` 表示瞬变。
- **中途接管**：新 Cue 到来时，若同一盏灯仍在渐变中，效果从该时刻的实际亮度直接转向
  新目标（不跳变、不重置）。
- **同秒顺序**：同一秒触发的多条 Cue，按 Cue 编号（正整数、唯一）从小到大依次生效。
- **不可变版本**：发布即对当前灯具与草稿 Cue 做完整快照。开始播放后始终使用开始时所选的
  版本；之后继续编辑草稿或发布新版本，都不会影响正在/已开始的那次播放。
- 提交校验：非法时码（负数/非数字）、未知灯具编号、无效亮度（超出 0～100/非数字）
  或非法渐变时长会明确指出错误，并且**整次提交被拒绝**（批量录入任意一行非法则全部不落库）。

## 一键启动（Docker Compose）

需要 Docker 与 Docker Compose 插件。在本目录执行：

```bash
docker compose up --build -d
```

该命令会一次性完成：安装依赖 → 初始化 SQLite 数据库与表结构 → 启动服务。

启动后访问：

- 地址：<http://localhost:3000>
- 端口：容器内固定 `3000`，宿主机默认映射到 `3000`（可用 `HOST_PORT` 修改）

停止：

```bash
docker compose down          # 停止（数据保留在命名卷 cue-data 中）
docker compose down -v       # 停止并删除演出数据
```

查看日志：`docker compose logs -f`

## 配置（环境变量）

在 docker-compose.yml 中配置，或通过 `.env` / 环境变量覆盖：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST_PORT` | `3000` | 宿主机映射端口（访问端口），如 `HOST_PORT=8080 docker compose up -d` |
| `PORT` | `3000` | 容器内监听端口（改动需同步调整 compose 的端口映射） |
| `DB_PATH` | `/data/app.db` | SQLite 数据库文件路径；位于挂载卷中，容器重建不丢数据 |
| `NODE_ENV` | `production` | 运行环境 |

## 不使用 Docker 的本地运行方式

需要 Node.js ≥ 20。

```bash
npm install
npm start                 # 默认监听 http://localhost:3000，数据文件在 ./data/app.db
PORT=8080 DB_PATH=/tmp/cue.db npm start   # 自定义端口与数据库位置
npm test                  # 运行灯光渐变引擎单元测试
```

## 使用说明

1. **灯具录入**：添加灯具（名称唯一），系统自动分配灯具编号 `#1、#2 …`。
2. **草稿 Cue**：
   - 单条录入：选择灯具、填写触发秒数、目标亮度（0～100）、渐变秒数；
     Cue 编号可留空自动分配，也可手填正整数。
   - 批量录入：每行 `时码 灯具编号 目标亮度 渐变时长 [Cue编号]`，空格分隔；
     任一行非法将拒绝整次提交。
   - 草稿可随时编辑/删除；这些改动只作用于草稿。
3. **发布版本**：填写备注（可留空）后点击“冻结并发布当前草稿”，生成不可变版本。
4. **排演播放**：选择版本后即可 ▶ 播放 / ⏸ 暂停 / ⏹ 回起点 / 拖动时间轴 / 输入秒数跳转，
   可切换 0.5× / 1× / 2× 速度；舞台模拟、亮度条与 Cue 状态（等待 / 渐变中 / 已触发）
   随时间实时更新。快捷键：页面空白处按空格播放/暂停。
5. **版本比对**：选择两个已发布版本（允许相同），输入非负时窗起点/终点、时窗内的查看时刻
   与 0～100 的亮度差阈值，页面显示该时刻两版逐灯亮度，并精确列出时窗内各灯亮度差
   **严格大于**阈值的连续区间及端点包含性（`[ ]` 含端点、`( )` 不含端点，零长度 `[t,t]`
   表示仅该瞬间超差）。按灯具编号匹配；仅在一版存在的灯具单列为**配置差异**，缺失不当作熄灭；
   无差异返回空区间；零长度时窗只返回该时刻亮度。区间在转折点（Cue 触发时刻、渐变结束时刻）
   之间用一次方程求阈值交点，**不做固定间隔采样**，同秒编号顺序、瞬变、中途接管、线性渐变
   规则与播放器完全一致。比对只读发布快照，不修改草稿，也不影响任何播放会话。
6. **临时调光**：针对任意**已发布版本**建立独立的临时调光记录（记录创建时即绑定该版本的
   不可变快照；之后修改草稿或发布新版本都不改变既有记录）。在记录中按演出时码为指定灯具
   追加两类操作：
   - **覆盖（override）**：从操作瞬间该灯的**实际输出**线性渐变到 0～100 的目标亮度，渐变
     结束后保持；后台原版 Cue 仍按既有规则持续运行，不受影响。
   - **归还（return）**：以操作瞬间的实际输出为固定起点，在指定时长内按进度与**该时刻持续
     变化的原版亮度**线性融合（`(1-p)×起点 + p×原版(t)`），时长结束后完全跟随原版。
   - 时长为 `0` 秒时立即生效：覆盖即刻跳到目标，归还即刻等于当前原版亮度。
   - **同秒按追加顺序生效**；下一操作可在上一操作未完成的渐变**中途接管**（从当时实际输出
     直接转向，不跳变）——与原版 Cue 的接管语义一致。
   - 仅允许追加**时码不早于记录末项**的操作；每次提交必须携带**记录修订号**（= 已追加操作
     数，初始为 0；成功追加 N 条后变为 +N）。过期修订号返回 **409 冲突**且**不写入**。
   - 跳转 / 暂停 / 拖动时间轴，或刷新页面重新打开记录时，均按绑定版本快照与操作序列
     **整体重算**逐灯实际输出；页面同时展示叠加后的实际亮度与后台原版亮度。

## 临时调光 HTTP API

所有写操作均为整次事务：参数非法（负时码、负时长、未知灯具、覆盖缺目标亮度、时码早于
末项等）返回 `400` 且**整次提交不部分写入**；记录不存在返回 `404`；修订号过期返回 `409`，
响应头 `X-Record-Revision` 给出当前最新修订号。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/override-records` | 建立记录 `{version_id, name?}`（版本须已发布，否则 404；name 可留空自动命名） |
| GET | `/api/override-records` | 记录列表（含绑定版本、修订号） |
| GET | `/api/override-records/:id` | 记录详情：绑定版本快照（灯具+原版 Cue）+ 全部操作，供整体重算 |
| POST | `/api/override-records/:id/operations` | 追加操作 `{revision, operations:[...]}`，成功返回更新后的完整记录（201） |

操作对象字段：

| 字段 | 含义 |
| --- | --- |
| `light_id` | 灯具编号，必须存在于绑定版本的快照中 |
| `time` | 非负演出时码（秒，可小数）；不得早于记录末项，批内同样按顺序单调 |
| `kind` | `"override"`（覆盖）或 `"return"`（归还）；也接受中文 `"覆盖"` / `"归还"` |
| `duration` | 非负时长（秒）；`0` 立即生效 |
| `target` | 目标亮度 0～100；**仅覆盖操作必填**，归还时忽略 |

调用示例：

```bash
# 1) 针对版本 #1 建立临时调光记录
curl -X POST http://localhost:3000/api/override-records \
  -H 'Content-Type: application/json' \
  -d '{"version_id":1,"name":"今晚临时处理"}'
# -> 201，记录 id=1，revision=0，operations=[]

# 2) 携带修订号追加操作：t=5s 把 #1 号灯从当时实际输出渐变到 0，用时 10 秒
curl -X POST http://localhost:3000/api/override-records/1/operations \
  -H 'Content-Type: application/json' \
  -d '{"revision":0,"operations":[
        {"light_id":1,"time":5,"kind":"override","duration":10,"target":0}
      ]}'
# -> 201，返回完整记录，revision 变为 1

# 3) 批量追加（整批事务；可同秒，同秒按数组顺序生效）：先覆盖、再归还
curl -X POST http://localhost:3000/api/override-records/1/operations \
  -H 'Content-Type: application/json' \
  -d '{"revision":1,"operations":[
        {"light_id":2,"time":6,"kind":"覆盖","duration":0,"target":30},
        {"light_id":1,"time":7,"kind":"return","duration":3}
      ]}'

# 4) 跳转/刷新后取回快照与操作序列，逐灯重算任意时刻实际输出（GET 只读）
curl http://localhost:3000/api/override-records/1
```

过期修订号：

```bash
curl -i -X POST http://localhost:3000/api/override-records/1/operations \
  -H 'Content-Type: application/json' \
  -d '{"revision":0,"operations":[{"light_id":1,"time":9,"kind":"归还","duration":0}]}'
# HTTP/1.1 409 Conflict
# X-Record-Revision: 2
# {"error":"修订号已过期：提交基于 0，当前为 2"}
```

前端「临时调光」页提供与 API 等价的操作：建立记录、按当前修订号追加覆盖/归还、
播放/跳转查看逐灯实际输出（实际/原版双列）与操作状态（等待 / 覆盖渐变中 / 归还融合中 /
覆盖保持 / 已跟随原版）。冲突时页面提示并自动重新加载最新操作序列。

## 版本比对 HTTP API

`GET /api/compare`（query 参数，便于直接调用/分享）或 `POST /api/compare`（JSON body），
参数相同：

| 参数 | 含义 |
| --- | --- |
| `version_a` / `version_b` | 两个已发布版本编号（正整数；允许相同；任一不存在返回 404） |
| `start` / `end` | 非负时窗起止秒数，`start > end` 报错；二者相等为零长度时窗 |
| `at` | 查看时刻（非负秒数），必须落在 `[start, end]` 内 |
| `threshold` | 亮度差阈值，0～100（含边界）；严格大于才算超差 |

调用示例：

```bash
curl 'http://localhost:3000/api/compare?version_a=1&version_b=2&start=0&end=10&at=4&threshold=30'

curl -X POST http://localhost:3000/api/compare \
  -H 'Content-Type: application/json' \
  -d '{"version_a":1,"version_b":2,"start":0,"end":10,"at":4,"threshold":30}'
```

返回（节选）：

```json
{
  "versions": {"a": {"id": 1, "label": "首演"}, "b": {"id": 2, "label": "复排"}},
  "window": {"start": 0, "end": 10},
  "at": 4,
  "threshold": 30,
  "levels": [
    {"light_id": 1, "name": "面光1", "brightness_a": 40, "brightness_b": 20,
     "difference": 20, "exceeds": false}
  ],
  "intervals": [
    {"light_id": 2, "name": "侧光L", "intervals": [
      {"start": 5, "end": 7.5, "start_inclusive": true, "end_inclusive": false}
    ]}
  ],
  "config_differences": {
    "only_in_a": [{"light_id": 3, "name": "逆光"}],
    "only_in_b": []
  }
}
```

- `intervals` 只含有差异的灯具；无差异时为 `[]`。`start_inclusive/end_inclusive`
  标明区间端点是否包含（阈值交点不含；Cue 触发瞬间若超差则含）。
- 起点大于终点、查看时刻越界、非数字/负数参数、阈值越界（<0 或 >100）、
  版本不存在等情况均返回 `400/404` 与中文错误原因。

## HTTP API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/lights` | 灯具列表 |
| POST | `/api/lights` | 新增灯具 `{name}` |
| DELETE | `/api/lights/:id` | 删除灯具（仍被草稿 Cue 引用时返回 409） |
| GET | `/api/cues` | 草稿 Cue 列表（按时码、编号排序） |
| POST | `/api/cues` | 新增 Cue，接受单条对象或数组（数组为批量，整批事务） |
| PATCH | `/api/cues/:id` | 修改草稿 Cue |
| DELETE | `/api/cues/:id` | 删除草稿 Cue |
| POST | `/api/versions` | 冻结当前草稿，发布不可变版本 |
| GET | `/api/versions` | 版本列表 |
| GET | `/api/versions/:id` | 版本完整快照（灯具 + Cue，供播放器使用） |
| GET/POST | `/api/compare` | 两版亮度差异比对（查看时刻逐灯亮度 + 超差连续区间 + 配置差异），只读 |
| POST | `/api/override-records` | 针对已发布版本建立临时调光记录（绑定不可变快照） |
| GET | `/api/override-records` | 临时调光记录列表 |
| GET | `/api/override-records/:id` | 记录详情（版本快照 + 操作序列，供重算） |
| POST | `/api/override-records/:id/operations` | 携带修订号追加覆盖/归还操作（整次事务，过期 409 不写入） |

所有错误返回 `400/404/409` 与形如 `{"error": "具体中文原因"}` 的 JSON。

## 目录结构

```
server.js            Express 服务与 API、输入校验、版本快照事务、两版比对、临时调光记录与修订号冲突控制
src/db.js            SQLite 初始化与表结构
public/engine.js     纯函数灯光渐变引擎（浏览器/Node 共用，含线性渐变、中途接管、精确差值区间，
                     以及临时调光的覆盖/归还叠加与按快照+操作序列重算）
public/index.html    单页界面
public/styles.css    剧场暗色主题
public/app.js        前端交互、版本比对页、基于 requestAnimationFrame 的播放器与临时调光工作区
test/engine.test.js  渐变规则单元测试
test/compare.test.js 两版亮度差区间单元测试（交点精度、端点包含性、瞬变、接管）
test/override.test.js 临时调光覆盖/归还/接管/同秒顺序/重算单元测试
Dockerfile           镜像构建（依赖、初始化、启动）
docker-compose.yml   一键编排
```
