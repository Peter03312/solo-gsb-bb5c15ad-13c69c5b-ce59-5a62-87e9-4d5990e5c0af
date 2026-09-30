# 小剧场灯光 Cue 排演（Lighting Cue Rehearsal）

一款用于小剧场灯光排演的 Web 应用。录入**灯具**与按演出秒数触发的 **Cue**
（灯具编号、目标亮度、非负渐变时长），所有灯光效果都在浏览器中模拟，**无需连接任何真实灯具**。
支持播放 / 暂停 / 跳转，并实时显示任意时刻每盏灯的实际亮度；发布后生成**不可变演出版本**。
排演人员还可针对已发布版本建立**临时调光记录**，按演出时码追加「覆盖 / 归还」操作，
随时查看任意时刻的**逐灯实际输出**；记录绑定版本快照，草稿修改与新版本发布都不影响既有记录。

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

## 临时调光记录（覆盖 / 归还）

排演人员可针对**已发布版本**建立独立的临时调光记录（不改动任何版本与草稿）：

- **绑定快照**：记录建立时绑定该版本完整快照；原版 Cue 仍按既有规则（线性渐变、同秒顺序、
  中途接管）在后台运行。之后修改草稿或发布新版本**都不改变既有记录**。
- **覆盖（override）**：从操作瞬间的**实际输出**线性渐变到 0～100 的目标亮度，此后保持，
  直到被后续操作接管；时长 0 秒立即生效。
- **归还（return）**：以操作瞬间的**实际输出**为起点，在指定时长内按进度（0→1）
  与该时刻**持续变化的原版亮度**线性融合，结束后完全跟随原版；时长 0 秒立即生效。
- **接管与同秒**：下一操作可接管未完成的渐变（起点取接管瞬间实际输出，不跳变）；
  同一时码的多条操作按**追加顺序**依次生效。
- **操作字段**：灯具、非负时码、类型（`override`/`return`）、非负时长；覆盖另需目标亮度 0～100。
- **只准追加**：时码不得早于末项操作（同秒可继续追加）。
- **修订号（乐观并发）**：每次成功追加后记录修订号 +1，提交必须携带当前修订号；
  过期修订号返回 **409 冲突且不写入**，刷新后可用最新序列重试。
- **原子提交**：无效参数、未知灯具（不在绑定快照中）、时码回退、记录不存在等都明确报错，
  整次提交（含批量）**不部分写入**。
- **随时重算**：跳转或刷新页面后，依据绑定的版本快照与操作序列重算任意时刻逐灯实际输出
  （页面地址栏 `#record=<id>&t=<时刻>` 可直接定位到某记录的某时刻）。

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
6. **临时调光记录**：在「调光记录」页选择已发布版本并建立记录，打开后选择灯具、填写演出时码、
   类型（覆盖/归还）、时长（覆盖再填目标亮度）追加操作；拖动时间轴或输入查看时刻即可重算
   逐灯的原版亮度与实际输出（覆盖中/归还融合中/跟随原版）。操作只追加（时码不早于末项，
   同秒按追加顺序）；若有人同时追加导致修订号过期，会自动拉取最新序列后提示重试。

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

## 临时调光记录 HTTP API

记录（record）绑定一个已发布版本；操作（op）只能追加。修订号用于乐观并发控制。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/records` | 建立记录 `{version_id, label?}`，返回记录详情（含绑定快照与空操作序列） |
| GET | `/api/records` | 记录列表（含修订号、操作数、绑定版本） |
| GET | `/api/records/:id` | 记录详情：元数据 + 绑定版本的灯具/Cue 快照 + 操作序列（刷新/跳转后据此重算） |
| DELETE | `/api/records/:id` | 删除记录及其全部操作 |
| POST | `/api/records/:id/ops` | 追加操作：单条 `{revision, op}` 或批量 `{revision, ops:[...]}`，整批事务 |
| GET | `/api/records/:id/output?at=<时码>` | 查看某时刻逐灯原版亮度与实际输出（只读重算） |

操作对象字段：

| 字段 | 含义 |
| --- | --- |
| `light_id` | 灯具编号，必须存在于**绑定版本快照**中 |
| `time` | 非负演出时码（秒，可小数），不得早于当前末项操作的时码 |
| `op_type` | `override`（覆盖）或 `return`（归还） |
| `duration` | 非负时长（秒）；`0` 立即生效 |
| `target` | 仅覆盖需要：0～100 目标亮度；归还携带该字段会报错 |

调用示例：

```bash
# 1) 基于版本 1 建立记录
curl -X POST http://localhost:3000/api/records \
  -H 'Content-Type: application/json' \
  -d '{"version_id":1,"label":"技术联排夜场"}'

# 2) 在修订号 0 上追加一条覆盖：t=2s 把 #1 从当时实际输出渐变到 80，用时 6s
curl -X POST http://localhost:3000/api/records/1/ops \
  -H 'Content-Type: application/json' \
  -d '{"revision":0,"op":{"light_id":1,"time":2,"op_type":"override","target":80,"duration":6}}'

# 3) 同秒追加两条操作（按数组顺序生效）：#2 先瞬变到 10，再用 2s 归还到原版
curl -X POST http://localhost:3000/api/records/1/ops \
  -H 'Content-Type: application/json' \
  -d '{"revision":1,"ops":[
        {"light_id":2,"time":8,"op_type":"override","target":10,"duration":0},
        {"light_id":2,"time":8,"op_type":"return","duration":2}
      ]}'

# 4) 查看 t=9s 的逐灯实际输出（原版仍在后台运行）
curl 'http://localhost:3000/api/records/1/output?at=9'
```

追加成功返回最新记录详情（`revision` 已自增、`ops` 为完整序列）。冲突示例：

```json
{ "revision": 0, "op": {"light_id":1,"time":9,"op_type":"override","target":0,"duration":1} }
```

```json
{"error":"修订号冲突：提交基于修订号 0，记录当前已为修订号 2；请刷新操作序列后重试（本次未写入）"}
```

`GET /api/records/:id/output?at=9` 返回（节选）：

```json
{
  "record": {"id": 1, "label": "技术联排夜场", "revision": 2},
  "version": {"id": 1, "label": "首演"},
  "at": 9,
  "levels": [
    {"light_id": 1, "name": "面光1", "original": 90, "actual": 80, "overridden": true,
     "state": "override", "active_seq": 1},
    {"light_id": 2, "name": "侧光L", "original": 60, "actual": 60, "overridden": false,
     "state": "original", "active_seq": null}
  ]
}
```

- `state`：`override`（覆盖保持/渐变中）、`return`（归还融合中）、`original`（完全跟随原版）。
- 版本不存在 → 404；记录不存在 → 404；版本号/灯具/时码/时长/亮度/类型非法、
  时码早于末项、归还携带目标亮度、缺少修订号 → 400；修订号过期 → 409。
  批量追加时任一条非法则整批拒绝（**不部分写入**）。

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
| POST | `/api/records` | 针对已发布版本建立临时调光记录 |
| GET | `/api/records` | 调光记录列表 |
| GET | `/api/records/:id` | 记录详情（绑定版本快照 + 操作序列） |
| DELETE | `/api/records/:id` | 删除记录及其操作 |
| POST | `/api/records/:id/ops` | 追加覆盖/归还操作（携带修订号，单条或批量，整批事务） |
| GET | `/api/records/:id/output` | 查询某时刻逐灯原版亮度与实际输出，只读重算 |

所有错误返回 `400/404/409` 与形如 `{"error": "具体中文原因"}` 的 JSON。

## 目录结构

```
server.js            Express 服务与 API、输入校验、版本快照事务、两版比对、临时调光记录（修订号/追加事务）
src/db.js            SQLite 初始化与表结构（含调光记录与操作序列表）
public/engine.js     纯函数灯光渐变引擎（浏览器/Node 共用，含线性渐变、中途接管、精确差值区间、覆盖/归还重算）
public/index.html    单页界面
public/styles.css    剧场暗色主题
public/app.js        前端交互、版本比对页、播放器与调光记录页（基于 requestAnimationFrame 的播放、快照本地重算）
test/engine.test.js  渐变规则单元测试
test/compare.test.js 两版亮度差区间单元测试（交点精度、端点包含性、瞬变、接管）
test/override.test.js 覆盖/归还单元测试（渐变起点、同秒顺序、中途接管、0 秒立即生效、归还融合）
Dockerfile           镜像构建（依赖、初始化、启动）
docker-compose.yml   一键编排
```
