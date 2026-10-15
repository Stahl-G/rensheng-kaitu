# 人生开图（开图 Kaitu）产品需求文档

- 版本：v0.1（草案）
- 日期：2026-10-15
- 状态：想法验证阶段，先做出来再定品牌与发布策略
- 仓库：当前为 `stahl-g/-`（计划改名 `rensheng-kaitu`），显示名「人生开图」；安装后应用名「开图」，命令行与包名 `kaitu`
- 配套文档：[`HANDOFF.md`](HANDOFF.md)（开发交接）、[`reference/interview-transcript.md`](reference/interview-transcript.md)（访谈全文）

---

## 0. 北极星与一句话

**北极星：灵感来自孙哥和 Alan 四小时访谈，目标是任何人都能用孙哥方法用 AI。**

展开说：不用懂技术，打开一个工作台，访谈里提到的 10 件事（§4）都能在这里完成；人只看进度、做确认，其余交给 Agent。取舍冲突时，以「是否让普通人更简单」为准。

> 「孙哥」「Alan」只用于内部文档。对外文案（README、产品界面、包名）遵守 HANDOFF §3 的命名约束，使用正式姓名并保留免责声明。

一句话：照孙宇晨 × 邵艾伦访谈里的方法，把个人生活「全部 AI 化」：所有个人数据放在本地一个文件夹里，任何 Agent（Codex、DeepSeek Harness、Claude Code……）读了这个文件夹就知道你是谁、在做什么、做到哪、下一步该做什么；人通过一个只显示「需要人看」内容的 Workbench 查看进度、确认建议。

> 灵感来自邵艾伦 × 孙宇晨的访谈。本项目为独立开源项目，与二人及其公司无关联。（README 首屏必须保留这句免责声明。）

---

## 1. 背景

访谈中孙宇晨描述了一套完整的个人 AI 化流程：饮食拍照交给 AI 算热量、Oura Ring 读取睡眠与消耗、训练视频交给 AI 记录组数与重量、AI 每天出日报、所有资料存为本地 MD 文档并写好 README，换任何 Agent 都能直接接手。

普通用户已经把大量个人信息告诉了 ChatGPT 等聊天机器人，但：

1. 没有一个可视化的地方看自己的进度；
2. 这些信息锁在各家服务里，自己的 Agent（Codex、Hermes 等）不知道；
3. 自己搭这套流程需要懂 MD、API、MCP，门槛高。

开图要把这套流程做成开箱即用的开源工具。

---

## 2. 产品原则

| # | 原则 | 含义 |
|---|---|---|
| P1 | 文件即数据 | 全部数据是 `~/kaitu/` 下的 Markdown 与 JSON。人能读，任何 Agent 能读，不锁定在任何产品里 |
| P2 | 运行时无关 | 不绑定任何 Agent。第一阶段用 Codex，第二阶段内置 DeepSeek Harness，其他 Agent 通过 `AGENTS.md` 与 MCP 接入 |
| P3 | 人看进度，Agent 管细节 | 首页只显示需要人看的内容（日程、健康、动态、我的）；其余模块由 Agent 管理，只在需要人处理时出现 |
| P4 | 先建议，后确认 | 写入外部系统（日历）和批量导入需要人确认；日常记录、自动记忆直接写入但可撤销 |
| P5 | 能用开源不自造 | 健康数据、饮食识别、日历、RSS、Agent 运行时、模型适配全部复用成熟开源项目 |
| P6 | 个人工具，不做企业级溯源 | 不做证据绑定、评分、审计包、多用户。版本历史足以支撑撤销与回看 |
| P7 | 本地优先、隐私优先 | 默认不做云同步、不发送产品埋点；明确告知哪些数据会发给哪个模型。Google Drive 模式为用户主动开启的可选项，版本库与密钥始终留在本机（见 `docs/drive-sync.md`） |

---

## 3. 用户与场景

### 3.1 目标用户

- **主要**：已经在用 ChatGPT / Codex 等 AI 工具、想把生活管理交给 AI、但不想自己搭系统的年轻人（访谈中的「20–40 岁」人群）。
- **次要**：技术用户，愿意自己接入更多数据源、写自定义模块。

### 3.2 非目标

- 企业或团队使用；多人共享工作区。
- 手机 App（v1 不做；有用户需求再说）。
- 医疗诊断。健康模块只做记录、趋势与提醒，不提供医疗建议。

### 3.3 核心场景

1. 第一次使用：导入 ChatGPT 记忆 → 开图自动生成「我的」档案与初始记忆 → 填目标与作息规则。
2. 每天早上：Agent 读取日程、健康状态、各模块下一步，生成今天的安排；日程建议等人确认后写入日历。
3. 白天随手记录：「今天深蹲 3×12，60kg」「午饭一份鸡胸肉饭」，Agent 直接记到健康模块。
4. 每天晚上：Agent 复盘当天完成情况、更新各模块进度、整理记忆，生成日报。
5. 每周、每月：生成复盘；数据积累 2–4 个月后生成「现状分析」。
6. 任意时刻问 Agent：「我现在该做什么？」「过去 180 天我为什么没练成？」

---

## 4. 访谈依据：功能覆盖清单

以下 10 项是孙宇晨在访谈中提出的内容，产品必须全部覆盖（时间为原片时间戳）。

| # | 功能 | 访谈内容 | 位置 | 产品落点 |
|---|---|---|---|---|
| 1 | 个人档案与现状 | 持续收集个人现状、健康等资料并数字化，积累 2–4 个月后交给 AI 结合兴趣和擅长领域分析 | 00:16:38–00:21:16 | 页面「我的」 |
| 2 | 薄肌训练 | 训练日与休息日隔天交替、动作、重量、组数、次数、训练视频、渐进超负荷、教练与 AI 双重反馈 | 00:01:39–00:07:07 | 健康 · 训练 |
| 3 | 饮食与营养 | 餐前餐后拍照估算热量、蛋白质 140–150 g、补充剂（蛋白粉 25 g、肌酸 5 g）、进食顺序建议 | 00:01:39–00:06:33 | 健康 · 饮食 |
| 4 | 睡眠与日常活动 | Oura Ring 读取睡眠与消耗，热量缺口 600 卡以内，与饮食、训练合并分析 | 00:03:34–00:04:48 | 健康 · 睡眠与活动 |
| 5 | 身体指标与健康记录 | 身高、体重、体脂；6 个月、一年的体态对比照片；血糖、血脂、胆固醇等检查；「主动健康管理」 | 00:01:18；约 00:19；02:03:52 | 健康 · 身体指标（含体态照片与按日期对比） |
| 6 | 日程与日常安排 | 主持人概括「健身、上课、schedule 都 AI 化」，孙认可，未展开具体功能 | 00:10:40–00:10:45 | 页面「今天」 |
| 7 | 科技与行业动态 | 看 X 和关注人物动态，自己抓加 AI 抓，围绕兴趣选一个方向钻研 | 00:17:56–00:21:07 | 页面「动态」 |
| 8 | 学习与认知更新 | 理论建设一周、教程视频逐帧逐句交给 AI、与 AI 辩论修正旧观念、学完立即执行 | 00:05:19；00:21:51；01:18:17；02:13:01 | Agent 管理：学习 |
| 9 | 方向探索与决策 | 问三家模型取其中；用 AI 逐个比较 100 个专业的未来 10 年；买房先看 100 套、先探图再决策 | 00:16:38–00:21:16；00:40:06–00:46:43 | Agent 管理：方向与决策 |
| 10 | 日报与长期复盘 | AI 每天出日报；观察几个月的变化；回看过去 180 天为什么没达成目标 | 00:03:35–00:07:07；00:58:11 | 页面「今天」 + Agent 管理：复盘 |

不做成功能的内容：孙学、黄毛、薄肌等观点性理论（00:12:29–00:15:34）、婚姻家庭（访谈中明确未给方案）。

---

## 5. 信息架构

### 5.1 导航（只放需要人看的 4 个页面）

| 页面 | 内容 |
|---|---|
| 今天 | 日程周视图、今天的时间线（日程 + Agent 建议）、下一步、待确认、需要你处理的事、日报入口 |
| 健康 | 4 个子页：训练、饮食、睡眠与活动、身体指标；健康评分卡 |
| 动态 | 每日简报、订阅源管理、兴趣关键词 |
| 我的 | 档案、目标、作息与规则、月度现状报告 |

右侧常驻对话面板，随时可问 Agent。

### 5.2 Agent 管理的模块（不进导航）

| 模块 | 人接触的方式 |
|---|---|
| 项目（个人项目与工作） | 对话中发起；下一步出现在「今天」，进度卡片在「我的」（是否单独进导航由界面设计决定）；早间计划按 `rules.md` 的工作时间区分工作与个人项目 |
| 学习 | 对话中发起；需要人做的事出现在「今天」 |
| 方向与决策 | 对话中发起；待拍板时「今天」出现卡片 |
| 复盘 | 日报 / 周报 / 月报推送到对话；可随时问 Agent 回看任意时间段 |

### 5.3 设置

模型与 API Key、记忆管理、导入、数据源连接（日历、Oura、饮食应用）、模块管理（显示 / 隐藏 / 新建）、版本历史、数据与模块浏览器（只读）、隐私说明。

---

## 6. 数据规范（`~/kaitu/`）

这是本产品最核心的交付物。所有阶段、所有 Agent 都遵守同一份规范。

### 6.1 目录结构

```
~/kaitu/
├─ AGENTS.md                 # 自动生成：Agent 入口说明（见 §8）
├─ CLAUDE.md                 # 一行：指向 AGENTS.md
├─ NOW.md                    # 今天的计划（见 §6.4）
├─ LOCK.json                 # Drive 状态文件租约锁（最长 15 分钟）
├─ handoffs/YYYY-MM/<时间>-<agent>.md # 只追加交接记录，frontmatter: agent、at
├─ me/                       # 我的
│  ├─ module.json
│  ├─ profile.md             # 基本情况（用户主动维护）
│  ├─ goals.json             # 目标
│  ├─ rules.md               # 作息与排程约束
│  ├─ STATUS.md
│  ├─ data/tasks/YYYY-MM.jsonl # 待办与提醒，按创建时间 ts 分月
│  └─ reports/YYYY-MM.md     # 月度现状报告
├─ health/
│  ├─ module.json
│  ├─ STATUS.md
│  ├─ data/
│  │  ├─ workouts/YYYY-MM.jsonl
│  │  ├─ meals/YYYY-MM.jsonl
│  │  ├─ sleep/YYYY-MM.jsonl
│  │  ├─ activity/YYYY-MM.jsonl
│  │  ├─ metrics/YYYY-MM.jsonl     # 体重、体脂、血压等单值指标
│  │  ├─ labs/YYYY-MM-DD-<slug>.json # 体检报告抽取结果
│  │  └─ photos/YYYY-MM.jsonl       # 体态照片记录（照片文件在 files/photos/）
│  └─ files/                 # 体检 PDF 等原件
│     └─ photos/YYYY-MM-DD-<id>.<ext>  # 体态照片原件，只存本机
├─ calendar/
│  ├─ module.json
│  ├─ STATUS.md
│  └─ data/events/YYYY-MM.jsonl     # 日历快照（从 MCP 或 .ics）
├─ feed/
│  ├─ module.json
│  ├─ STATUS.md
│  ├─ feeds.json             # 订阅源与兴趣关键词
│  └─ digests/YYYY-MM-DD.md
├─ learning/
│  ├─ module.json
│  └─ <topic>/
│     ├─ STATUS.md
│     ├─ sources/            # 资料与文字稿
│     ├─ notes.md            # 要点
│     ├─ beliefs.md          # 观念变化记录
│     └─ actions.md          # 转成的行动
├─ projects/                # 个人项目与工作（D21）
│  ├─ module.json
│  └─ <slug>/
│     ├─ STATUS.md           # frontmatter 另含 kind: work | personal、local_only: bool
│     ├─ notes.md            # 背景、要点、相关人
│     └─ log.md              # 按日期记的进展
├─ decisions/
│  ├─ module.json
│  └─ <slug>/
│     ├─ STATUS.md
│     └─ decision.md         # 候选、标准、多模型意见、选择与理由、复议条件
├─ reviews/
│  ├─ module.json
│  ├─ daily/YYYY-MM-DD.md
│  ├─ weekly/YYYY-Www.md
│  └─ monthly/YYYY-MM.md
├─ memory/                   # 项目记忆（见 §7.1）
│  ├─ MEMORY.md
│  └─ <type>_<slug>.md
├─ chats/YYYY/MM/<id>.jsonl  # 对话记录（含导入的历史对话）
├─ inbox/                    # 导入原件与待整理材料
├─ <custom-module>/          # 用户自定义模块，结构同上
└─ .kaitu/                   # 程序状态，不给 Agent 改
   ├─ config.json            # 版本、已启用模块、数据源配置（不含密钥）
   ├─ secrets.json           # 密钥，权限 600，不进版本历史
   ├─ index.sqlite           # 对话全文索引（可重建，不进版本历史）
   └─ cache/
```

约定：

- 时间一律 ISO 8601，带时区偏移；日期按用户本地时区切分。
- 记录类数据用 JSON Lines，按月分文件，只追加；修改通过追加同 `id` 的新版本记录并带 `rev`，读取时取最新版本；删除追加 `{"id": ..., "deleted": true}`。
- 每条记录必有字段：`id`（ULID）、`ts`、`by`（`user` | `agent` | `import:<source>`）。
- 文件名、目录名用小写英文与 `-`；显示名在 `module.json` 中。

### 6.2 `module.json`

```json
{
  "id": "health",
  "name": "健康",
  "version": 1,
  "visibility": "nav",
  "description": "训练、饮食、睡眠活动与身体指标",
  "tabs": ["workouts", "meals", "sleep-activity", "metrics"],
  "records": {
    "workout": {
      "path": "data/workouts/{YYYY-MM}.jsonl",
      "schema": "schemas/workout.schema.json"
    }
  },
  "views": [
    { "type": "chart", "title": "体重趋势", "record": "metric", "filter": { "kind": "weight" }, "x": "ts", "y": "value" },
    { "type": "table", "title": "训练日志", "record": "workout", "columns": ["ts", "exercise", "sets", "reps", "weight_kg"] }
  ],
  "sources": [
    { "type": "import", "id": "apple-health" },
    { "type": "api", "id": "oura" },
    { "type": "import", "id": "nut-ai" },
    { "type": "api", "id": "caloriemate" },
    { "type": "manual" }
  ],
  "agent": {
    "instructions": "力量训练按 workout schema 写入，对比上次同动作重量给出下次加重建议；有氧用 modality: cardio，记录时长和已知距离，对比同项目配速或时长。"
  }
}
```

- `visibility`：`nav`（显示在导航）| `agent`（由 Agent 管理，只通过「今天」和对话露面）。
- `views.type` v1 只支持 6 种：`table`、`kanban`、`timeline`、`chart`、`progress`、`doc`。
- 自定义模块与内置模块用同一份格式；Agent 可创建、修改、删除自定义模块的 `module.json`，删除前必须经人确认。

### 6.3 `STATUS.md`

每个模块（及学习主题、决策档案）各一份；frontmatter 机器读，正文给人和 Agent 读。

```markdown
---
updated: 2026-10-15T21:00:00+08:00
progress: { label: "薄肌计划", current: 3, target: 24, unit: "周" }
next:
  - id: h-12
    title: "腿部训练：深蹲 3×12，比上次加 2.5 kg"
    priority: high          # high | normal | low
    estimate: 40min
    when: "训练日"
    due: null
    status: todo            # todo | proposed | done | skipped
  - id: h-13
    title: "复查血脂"
    priority: normal
    due: 2026-11-01
    status: todo
blocked: []
---
本周完成 2/3 次训练；蛋白质日均 128 g，低于 150 g 目标……
```

项目 `projects/<slug>/STATUS.md` 在通用字段之外包含 `title`（显示名）、`kind: work|personal`、
`stage: idea|active|paused|done`、`local_only`（默认 false）和 `links` 数组。
每条链接包含本机绝对路径或 `~/` 开头的 `path`、`role: manuscript|repo|folder`，可用 `include` 指定相对路径 glob。
正文与代码留在链接文件夹内，只读；项目目录只存 STATUS、背景笔记 `notes.md` 与按 `## YYYY-MM-DD` 分节的 `log.md`。
Drive 模式下，仅本机项目在本机状态目录 `local-projects/<slug>/`，进度记录也留本机，core 透明解析位置。

### 6.4 `NOW.md`

```markdown
---
date: 2026-10-15
generated_at: 2026-10-15T07:30:00+08:00
blocks:
  - { id: b1, start: "08:00", end: "09:00", title: "周会", kind: event, status: confirmed }
  - { id: b2, start: "09:30", end: "10:10", title: "腿部训练", kind: proposal, module: health, ref: h-12, status: pending }
attention:
  - { kind: decision, title: "选健身房：已对比 3 家，等你拍板", ref: decisions/gym }
  - { kind: confirm, title: "2 条日程建议待确认", ref: b2 }
---
今天是训练日。昨晚睡眠 6.2 小时，低于平均……
```

- `kind`：`event`（日历已有）| `proposal`（Agent 建议，待确认）| `task`（不占具体时间的待办）。
- `status`：`confirmed` | `pending` | `done` | `skipped` | `rejected`。
- 人确认 `proposal` 后才写入外部日历，写入成功后改为 `event`。

### 6.5 `me/goals.json` 与 `me/rules.md`

```json
[
  { "id": "g1", "title": "6 个月练出薄肌", "area": "health", "priority": 1, "status": "active",
    "metric": "体脂率", "target": "≤ 18%", "due": "2027-04-15" }
]
```

`rules.md` 用 frontmatter 存可执行约束，正文写补充说明。v1 默认值按访谈预填，用户可改：

```markdown
---
timezone: Asia/Shanghai
sleep: { start: "23:30", end: "07:30" }
work_hours: { start: "09:30", end: "19:00", days: [1,2,3,4,5] }
no_tasks_after: "22:00"
training: { pattern: "alternate-days", duration_min: 40, preferred: "evening" }
nutrition: { protein_g: [140, 150], deficit_kcal_max: 600 }
goal_priority: [g1]
---
```

### 6.6 记录 schema（v1 内置）

| 记录 | 关键字段 |
|---|---|
| workout（力量） | `modality?: strength`（缺省视为力量）、`exercise`、`sets`、`reps`、`weight_kg`、`session_id`；可选 `rpe`、`video`、`notes` |
| workout（有氧） | `modality: cardio`、`exercise`、`duration_min`；可选 `distance_km`、`avg_hr`、`kcal`、`elevation_m`、`rpe`、`notes`、`session_id` |
| task（me 模块） | `title`、`status: open / done / cancelled`（新建为 open）；可选 `due`（日期或带偏移时间）、`remind_at`（带偏移时间）、`project`（slug）、`notes`、`source` |
| meal | `meal`（早/午/晚/加餐）、`items[]`（`name`、`grams?`）、`kcal`、`protein_g`、`carbs_g?`、`fat_g?`、`uncertainty?`、`photo?`、`source` |
| supplement | `name`、`amount`、`unit` |
| sleep | `start`、`end`、`duration_min`、`score?`、`hrv?`、`resting_hr?`、`source` |
| activity | `date`、`steps?`、`active_kcal?`、`total_kcal?`、`source` |
| metric | `kind`（weight / body_fat / height / bp / glucose …）、`value`、`unit`、`source` |
| lab | `date`、`items[]`（`name`、`value`、`unit`、`ref_range?`、`flag?`）、`file` |
| photo | `file`（相对健康模块目录，如 `files/photos/2026-10-15-01J….jpg`）、`pose`（front / side / back / other）、`notes?` |
| event | `start`、`end`、`title`、`calendar`、`external_id?`、`source` |
| project_metric | `project`（slug）、`kind`（words / commits）、`value`（当前总字数 / 当天提交数）、`detail?`（至多 10 条提交标题，每条至多 80 字） |
| feed_item | 在 `.kaitu/cache` 中，不进版本历史；简报写入 `digests/` |

待办按创建时间 `ts` 分月，状态变化通过 `updateRecord` 追加同 id 的修订，保留创建时间。
日期型 due 在用户时区当天结束后才过期，时间型 due 按具体时刻过期；今天到期和今天提醒按用户时区查询。
`kaitu status`、OVERVIEW.md 和今天页列出今天到期、已过期、今天提醒的 open 待办；今天页可标完成。
提醒暂由早间计划与今天页列出，推送通道留到 M5。收件箱 records 可新增 task，笔记中的待办由晚间复盘整理。

完整 JSON Schema 放在仓库 `schemas/` 目录，由程序校验，不在提示词中重复。

---

## 7. 系统功能

### 7.1 记忆（仿 ChatGPT）

两层：

1. **已保存的记忆**：`memory/` 下的条目，每次会话开始时把 `MEMORY.md` 整份注入给 Agent。
2. **参考历史对话**：`chats/` 建 SQLite FTS5 全文索引，Agent 通过 `search_chats` 检索。

条目格式：

```markdown
---
type: preference          # preference | fact | context | person | decision
name: 训练时间偏好
text: 不喜欢早上训练，偏好晚上 7 点以后
source: chats/2026/10/01J....jsonl
created: 2026-10-15
updated: 2026-10-15
sensitive: false
---
```

`MEMORY.md` 每条一行：`- [类型] 名称 —— 一句话（文件名）`，总量上限约 3k tokens，超出时在晚间复盘中合并。

写入规则：

- 用户说「记住……」：Agent 调用 `memory_save` 保存。
- **自动提取默认开启**：每轮对话结束后提取值得记的内容直接保存，界面提示「已记住：……」并提供撤销；设置中可「暂停记忆」。
- **有对应模块的内容写进模块，不进记忆**（如蛋白质目标写入 `rules.md`，训练记录写入健康模块）。
- 健康诊断等敏感信息默认不自动记，仅在用户明确要求时保存，并标 `sensitive: true`。
- 每晚复盘时整理：合并重复、处理矛盾、刷新 `profile.md` 摘要。

界面：浏览、搜索、编辑、删除、查看来源对话、暂停记忆。

### 7.2 导入

统一流水线：

```
来源适配器 → 解析为候选 → 与已有记忆/数据去重 → 分流（记忆 / 模块）→ 一屏确认 → 写入并生成版本 → 可一键撤销
```

| 版本 | 来源 | 方式 |
|---|---|---|
| v1 | ChatGPT 记忆 | ① 提示词贴回（主要方式）② 粘贴「设置 → 个性化 → 记忆 → 管理」列表 |
| v1 | ChatGPT 对话 | 导入 `conversations.json`（或导出 zip）到 `chats/`，建立全文索引 |
| v1 | Apple Health | 导入 `export.zip`，解析到健康模块 |
| v1 | 日历 | 导入 `.ics` |
| v1 | 饮食应用 | Nut AI 导出 JSON；CalorieMate 通过其 PocketBase REST 接口读取 |
| v2 | Claude | 提示词贴回 + `conversations.json` |
| v3 | Gemini | 提示词贴回 + 粘贴 Saved info；对话记录尽力而为 |
| — | 任意文件 | 拖入 `inbox/`，由 Agent 整理 |

结构化数据（Apple Health、`.ics`、饮食应用）用确定性解析器直接导入；聊天内容由 Agent 解析为候选。日常记录不弹确认，批量导入必须一屏确认（默认全选）。

反向导出：一键把记忆按同一格式导出，可贴入 Claude / ChatGPT 的导入功能。

导入提示词见附录 A。

### 7.3 版本历史

- 内置 isomorphic-git（纯 JS，不要求用户安装 git）。每次写入自动提交，提交说明用人能读懂的话：「Agent 更新了健康模块：记录训练 1 次」。
- 单一线性历史，无分支。外部 Agent 直接改文件时，监听文件变化并合并为一次提交（防抖 30 秒）。
- 界面不出现 git 字样：每个模块、每条记忆旁有「历史」，可查看改动、恢复到某个版本；导入确认页提供「撤销导入」。
- `.kaitu/secrets.json`、`.kaitu/index.sqlite`、`.kaitu/cache/` 不进版本历史。
- 设置中提供「备份到我自己的 Git 远程仓库」，默认关闭。

### 7.4 定时任务

| 任务 | 默认时间 | 内容 |
|---|---|---|
| 早间计划 | 07:30 | 同步数据源 → 生成 `NOW.md` → 生成动态简报 |
| 晚间复盘 | 22:00 | 更新各模块 `STATUS.md` → 写日报 → 整理记忆 |
| 周复盘 | 周日 21:00 | 写 `reviews/weekly/` |
| 月复盘与现状 | 每月 1 日 | 写 `reviews/monthly/`；数据满 2 个月后同时生成 `me/reports/` 现状分析 |

时间可在设置中修改。阶段 1 由用户在 Codex 中手动触发；阶段 3 由 DeepSeek Harness 的 schedule 执行。

### 7.5 确认流

Drive 模式下状态文件须持锁修改，接力步骤见 [cloud-relay.md](cloud-relay.md)。

| 操作 | 是否需要人确认 |
|---|---|
| 日常记录（训练、饮食、指标） | 否，可撤销 |
| 自动记忆 | 否，可撤销 |
| 写入外部日历 | 是 |
| 批量导入 | 是（一屏） |
| 删除模块、删除超过 10 条记录 | 是 |
| 修改 `rules.md`、`goals.json` | 是（Agent 提出修改建议，人确认） |

### 7.6 模块定制

- 对话中说「帮我加一个写小说的模块」：Agent 生成 `module.json`（含记录 schema、视图、Agent 说明）与 `STATUS.md`，询问是否显示在导航后创建。
- 设置 → 模块管理：显示 / 隐藏、重命名、删除（需确认）、查看定义。
- 预置模板（不默认启用）：参照对象、体验清单、创造与消费比例、写作项目、读书。

---

## 8. Agent 规范

### 8.1 `AGENTS.md`（程序生成，人可追加）

必须包含：

1. 我是谁：引用 `me/profile.md` 摘要与 `memory/MEMORY.md`。
2. 进入后的读取顺序：`me/profile.md` → `me/rules.md` → `NOW.md` → 各模块 `STATUS.md` → 需要时再读 `data/`。
3. 模块清单：每个模块的路径、用途、记录类型、`visibility`。
4. 写入规则：只写 `~/kaitu/` 内；记录类数据只追加；遵守 §6 格式；写完调用校验；不改 `.kaitu/`。
5. 确认规则：照 §7.5。
6. 记忆规则：照 §7.1。
7. 日常节奏：早间计划、晚间复盘、周 / 月复盘分别做什么。
8. 可用的技能与命令清单。
9. 安全：不执行与本文件夹无关的命令；不把密钥写进任何文件；健康内容不做医疗诊断。

### 8.2 技能（Skills，`SKILL.md` 通用格式）

| 技能 | 触发 | 做什么 |
|---|---|---|
| onboarding | 首次使用 | 引导导入 ChatGPT 记忆、填写档案、目标、规则、连接数据源 |
| import-chatgpt-memory | 「导入 ChatGPT」 | 给出提示词 → 解析贴回内容 → 列候选 → 确认后写入 |
| morning-plan | 「早上好」/ 定时 | 同步 → 读规则、目标、日程、各模块下一步 → 写 `NOW.md` → 提出日程建议 |
| evening-review | 「复盘」/ 定时 | 对照 `NOW.md` 判断完成情况 → 更新 `STATUS.md` → 写日报 → 整理记忆 |
| weekly-review / monthly-review | 定时或手动 | 周 / 月复盘；月度现状分析 |
| look-back | 「过去 N 天……」 | 按时间段汇总各模块数据与对话，回答「为什么没达成」类问题 |
| log-workout | 训练描述 | 解析并写入力量或有氧 workout；力量给出下次加重建议，有氧对比配速或时长 |
| log-meal | 饮食描述或饮食应用导入 | 文字记录或从 Nut AI / CalorieMate 导入；汇总当天热量与蛋白质 |
| health-import | 手动导入 | Apple Health / Nut AI / .ics 预览与确认导入 |
| lab-import | 拖入体检 PDF | 抽取指标写入 `labs/`，标注异常，提出复查建议 |
| daily-feed | 早间计划内 / 手动 | 拉取订阅源 → 按兴趣筛选 → 写当天简报 |
| learn-topic | 「帮我学 XX」 | 建主题目录、整理资料、与用户讨论、记录观念变化、转成行动 |
| decision | 「帮我决定 XX」 | 建决策档案、列候选与标准、可选询问多个模型、记录选择与复议条件 |
| add-module | 「加一个 XX 模块」 | 生成 `module.json` 与 `STATUS.md` |
| log-photo | 体态照片 | 保存原件与姿势，在工作台按日期对比 |

技能正本在 `.agents/skills/`，初始化与 `agents-md` 同步复制至 `.claude/skills/`；体态照片与进度查看使用 `kaitu ui`。

### 8.3 工具 / 命令（`kaitu` CLI，同时以 MCP 暴露）

| 命令 | 说明 |
|---|---|
| `kaitu init [dir]` | 从模板创建 `~/kaitu`，生成 `AGENTS.md` |
| `kaitu doctor` | 检查目录结构、schema、数据源连接 |
| `kaitu validate [path]` | 按 schema 校验 |
| `kaitu agents-md` | 重新生成 `AGENTS.md` |
| `kaitu record add <type> --json ...` | 写入一条记录（生成 id、ts、by，校验后追加） |
| `kaitu status [--json-out]` | 今天的块与待确认、各模块进度和 next、最近 7 天训练 / 睡眠 / 蛋白质及最新体重 |
| `kaitu memory import --file <候选.json> [--dry-run]` | 确认后的记忆数组整批写入，一个版本 |
| `kaitu task add / list / done / cancel` | 新建、查询、完成或取消待办，写操作生成版本 |
| `kaitu photo add` / `list` / `rm` | 添加、查询和删除体态照片及原件 |
| `kaitu memory add|update|rm|list|search` | 记忆操作 |
| `kaitu chats search <q>` | 历史对话全文检索 |
| `kaitu import chatgpt-conversations <file>` | 导入对话到 `chats/` |
| `kaitu import apple-health <export.zip>` | 导入 Apple Health |
| `kaitu import ics <file>` | 导入日历 |
| `kaitu import nut-ai <file>` | 导入 Nut AI 导出 |
| `kaitu sync oura` / `kaitu sync caloriemate` | 拉取数据（密钥读 `.kaitu/secrets.json`） |
| `kaitu feed fetch` | 拉取订阅源到缓存，输出待整理条目 |
| `kaitu history [path]` / `kaitu restore <version> [path]` | 版本历史与恢复 |
| `kaitu snapshot -m <msg>` | 手动生成版本 |
| `kaitu ui` | 打开本地工作台，查看进度与确认建议 |
| `kaitu mcp` | 以 stdio MCP 服务提供上述能力（含 `memory_*`、`search_chats`、`record_add`） |

`~/kaitu/.mcp.json` 预置 `kaitu mcp`，供 Claude Code 读取；Codex 用 `codex mcp add kaitu -- kaitu mcp` 注册。非默认目录通过 `KAITU_DIR` 指定。

---

## 9. 外部依赖

| 用途 | 项目 | 许可证 | 接入方式 |
|---|---|---|---|
| Agent 运行时（阶段 1） | OpenAI Codex CLI / App | — | 读取 `AGENTS.md`、技能、MCP |
| Agent 运行时（阶段 3） | DeepSeek Harness，锁定 `0.2.0-rc.2` | MIT | 自定义 profile + 插件包，不 fork |
| 多模型适配 | pi-ai（DeepSeek Harness 内 `llm-pi-ai`） | MIT | 随 DeepSeek Harness |
| 版本历史 | isomorphic-git | MIT | npm 依赖 |
| 全文索引 | SQLite FTS5（优先 `node:sqlite`，不支持 FTS5 时用 better-sqlite3） | — | npm 依赖 |
| 日历 | CalDAV MCP（如 dominik1001/caldav-mcp）/ Google Calendar MCP | 各自 | MCP |
| 可穿戴 | Oura 官方 API（个人 Token）；可选 Open Wearables | MIT | API |
| 饮食 | CalorieMate（自部署）/ Nut AI（手机 App 导出） | MIT / AGPL-3.0 | 读接口 / 读导出文件；不合并其代码 |
| 订阅源 | RSS 解析库；用户可粘贴 RSSHub 生成的链接 | — | npm 依赖 |
| 日历视图（阶段 3） | FullCalendar | MIT（标准版） | 前端依赖 |
| 图表（阶段 3） | ECharts | Apache-2.0 | 前端依赖 |

AGPL 项目只作为独立程序使用，不复制其代码进本仓库。本仓库许可证：Apache-2.0（待最终确认）。

---

## 10. 分阶段交付

### 阶段 1：Codex 版（无界面）

> 阶段 1 是**内部验证**：验证数据规范与 Agent 工作方式，用户需要装 Node 与 Codex、使用终端，不满足北极星的「任何人」。第一个对外版本是阶段 3 的 WebUI；可考虑把阶段 4 的桌面打包提前，与 WebUI 一起交付。

**目标**：用户装好 Node 22 与 Codex，执行一条命令初始化，在 `~/kaitu` 中打开 Codex，就能完成第 3.3 节的全部核心场景（日程写入除外，阶段 1 只读日历）。

**交付物**

1. `templates/kaitu/`：完整目录模板、内置 `module.json`、空 `STATUS.md`、默认 `rules.md`。
2. `schemas/`：§6 中所有 JSON Schema。
3. `packages/cli`：`kaitu` 命令行（§8.3），TypeScript，Node 22。
4. `AGENTS.md` 生成器与模板。
5. 技能：§8.2 全部技能。
6. `kaitu mcp`：stdio MCP 服务。
7. `kaitu ui`：本地工作台，显示今天、健康趋势、动态简报、目标进度（取代旧 `dashboard`）。
8. 示例数据：Apple Health 导出样例（合成）、`.ics` 样例、ChatGPT 记忆贴回样例、Nut AI 导出样例。
9. README（含免责声明、安装、隐私说明）。

**验收标准**

- [ ] 新机器上 `npx kaitu init` 成功创建目录，`kaitu doctor` 全部通过。
- [ ] 在 Codex 中说「导入 ChatGPT 记忆」，贴入样例后生成候选清单，确认后写入 `memory/`，并可整体撤销。
- [ ] `kaitu import apple-health` 处理合成样例后，`health/data/` 下体重、睡眠、步数记录正确，schema 校验通过。
- [ ] 说「今天深蹲 3×12，60 kg」，写入一条合法 workout，并给出下次加重建议。
- [ ] 说「早上好」，生成合法 `NOW.md`：包含 `.ics` 中的日程、按 `rules.md` 安排的训练建议（训练日 / 非训练日正确交替）。
- [ ] 说「复盘一下」，更新各模块 `STATUS.md`、写入当天日报。
- [ ] 说「加一个读书模块」，生成合法 `module.json`，`kaitu validate` 通过。
- [ ] `kaitu history` 显示上述每一步的版本；`kaitu restore` 能恢复任意一步。
- [ ] 全程没有写入 `~/kaitu` 之外的文件；`.kaitu/secrets.json` 未进入版本历史。
- [ ] `kaitu ui` 打开的本地工作台在浏览器中正确显示上述数据。

### 阶段 2：DeepSeek Harness 验证（约 3 天）

在 `0.2.0-rc.2` 上验证 5 件事，全部通过才进入阶段 3：

1. 建 `kaitu` profile，禁用产品埋点、遥测、终端、shell、浏览器操控、电脑操控、SSH、LSP、DeepSeek 账号登录、Agent Teams、工作流等插件，正常启动。
2. 写一个前端插件：注册「今天」全局页面，替换品牌与侧边栏导航。
3. 能力组合：文件读写限定在 `~/kaitu`，确认 shell 类工具不可用。
4. 用 schedule 跑通早间计划；通过 MCP 接上日历。
5. 新用户首次启动、填写 API Key（DeepSeek 或 OpenAI 兼容接口）的完整流程。

另需确认：我们的插件包以固定 peer 版本发布到 npm 后，能被其插件管理器安装并加载。

**不通过时的退路**：改为自建薄外壳（Node 服务 + WebUI）+ 内置 Pi 引擎（复用 BriefLoop `native-engine` 的会话、工具、压缩与密钥存储代码），数据规范不变。

### 阶段 3：开图 WebUI（DeepSeek Harness 插件）

- 以 `kaitu` profile 发布，DeepSeek Harness 通过 npm 固定版本引用，不 fork。
- 后端插件：`kaitu-workspace`（`~/kaitu` 读写、模块注册、记录校验）、`kaitu-memory`（记忆注入、自动提取、整理）、`kaitu-import`、`kaitu-history`、`kaitu-schedules`（预置定时任务）、`kaitu-agents-md`。
- 前端插件：`ui-kaitu-shell`（品牌、主题、导航）、`ui-kaitu-today`、`ui-kaitu-health`、`ui-kaitu-feed`、`ui-kaitu-me`、`ui-kaitu-settings-memory`、`ui-kaitu-settings-import`、`ui-kaitu-settings-modules`、`ui-kaitu-history`。
- 复用其对话、模型设置、审批组件；先不替换 `ui-layout`（整体框架）。
- 日程建议在「今天」中以虚线块显示，点「确认」写入日历。
- 交付后：今天、健康、动态、我的 4 个页面可用；记忆与导入可在设置中操作；定时任务自动运行。

### 阶段 4：桌面打包

WebUI 稳定后，用 DeepSeek Harness 已有的 Electron 桌面载体打包 macOS 与 Windows 安装包，应用名「开图」。

---

## 11. 隐私与安全

- 默认所有数据只存在本机 `~/kaitu/`。用户可主动开启 Google Drive 模式（`docs/drive-sync.md`）：数据文件同步到用户自己的 Drive，版本库、密钥、索引始终留在本机。
- 不发送任何产品埋点或遥测（阶段 3 必须禁用 DeepSeek Harness 的相关插件）。
- 引导页明确告知：对话、记录与导入内容会发送给用户选择的模型服务（阶段 1 为 OpenAI）。
- 密钥只存 `.kaitu/secrets.json`（权限 600），不进版本历史、不写入任何其他文件、不出现在日志中。
- Agent 写入范围限定在 `~/kaitu/`；阶段 3 禁用 shell 类工具。
- 删除就是真删除：恢复只在版本历史保留期内有效；提供「彻底清除某条数据（含历史）」的操作。
- 健康模块显示提示：不构成医疗建议。

---

## 12. 测试原则

沿用 BriefLoop 的测试约定：测试数量不是交付证据，只为以下行为写测试：

- 导入往返：合成样例导入后数据正确、可撤销。
- schema 校验：合法与非法记录。
- 写入范围：任何命令不能写出 `~/kaitu/`。
- 版本历史：提交、查看、恢复；密钥与索引不进历史。
- 记录追加语义：修改、删除后读取结果正确。
- 时区与日期切分的边界情况。

不写断言提示词文案、复述常量、读源码做字符串匹配的测试。

---

## 13. 成功标准（想法验证阶段）

**北极星指标**：新用户从下载到第一次看到自己的「今天」页面（导入 ChatGPT 记忆、生成第一份计划）所用的时间，以及期间是否需要打开终端。目标：10 分钟内完成，全程不用终端。阶段 3 起每个版本都按此测量。

- 作者本人连续使用 30 天，每天至少一次早间计划与一次复盘。
- 5 名以上早期用户在不看源码的情况下完成阶段 1 的初始化与 ChatGPT 记忆导入。
- 早期用户中半数以上在第 2 周仍在使用。

---

## 14. 风险与待定事项

| 风险 / 待定 | 处理 |
|---|---|
| DeepSeek Harness 为开发者预览版，无正式稳定版，接口会变 | 锁定版本、插件保持薄、数据规范与运行时无关、保留退路方案 |
| DeepSeek Harness 不接受外部 PR | 只通过插件与配置叠加扩展，不 fork |
| Codex 不能定时、自动记忆依赖指令遵循 | 阶段 1 接受手动触发；晚间复盘兜底整理记忆 |
| 饮食照片估算不稳定 | 不自建；对接 Nut AI（数据库 + 误差范围）/ CalorieMate；提供纯文字记录 |
| 第三方项目规模小、可能停更 | 数据源写成可替换的适配器 |
| 使用真人姓名与「薄肌」IP 的法律风险 | 项目名不含真人姓名与「薄肌」；README 写明灵感来源与免责；后续可联系邵艾伦寻求授权 |
| 健康数据发给云端模型 | 引导页告知；阶段 3 支持 OpenAI 兼容接口，可接本地模型 |
| 待定：仓库许可证（Apache-2.0 或 MIT） | 开源发布前确定 |
| 待定：目标用户以国内为主还是海外 | 影响默认模型预置与健康设备支持（华为、小米） |
| 待定：记忆自动提取使用主模型还是单独的小模型 | 阶段 3 前确定 |

---

## 附录 A：ChatGPT 记忆导入提示词

```
请把你记住的关于我的所有信息完整列出来，尽量保持原文，不要总结或省略。包括：
1. 你保存的记忆条目
2. 我设置的自定义指令或个性化偏好
3. 你从我们的对话里了解到的我的情况：工作、目标、健康、作息、兴趣、正在做的项目、重要的人
按下面的格式输出，每条一行：
[类别] 内容 （如果知道记下的时间，写在最后）
```

配套提示：ChatGPT 可能漏掉部分条目，建议同时复制「设置 → 个性化 → 记忆 → 管理」中的列表一起粘贴。

## 附录 B：README 首屏文案

> **人生开图**
> 照孙宇晨 × 邵艾伦访谈里的方法，把你的生活全部 AI 化。
>
> 孙宇晨说，他把吃饭、训练、睡眠、学习全部交给 AI 管：拍照记饮食、Oura 戒指读睡眠、AI 每天出日报。开图把这套做法做成了一个开源工具：导入你的 ChatGPT 记忆，打开就能用。
>
> 灵感来自邵艾伦 × 孙宇晨的访谈。本项目为独立开源项目，与二人及其公司无关联。

## 附录 C：给编码 Agent 的任务拆分（阶段 1）

| 任务 | 内容 | 依赖 | 完成标准 |
|---|---|---|---|
| T1 | 仓库脚手架：pnpm workspace、TypeScript、Node 22、lint、测试框架 | — | `pnpm build`、`pnpm test` 可运行 |
| T2 | `schemas/`：§6 全部 JSON Schema 与校验工具 | T1 | 合法 / 非法样例测试通过 |
| T3 | 目录模板与 `kaitu init`、`doctor`、`validate` | T2 | 初始化后 `doctor` 通过 |
| T4 | 记录读写库：JSONL 追加、按 id 取最新、删除标记、时区切分 | T2 | §12 对应测试通过 |
| T5 | 版本历史：isomorphic-git 自动提交、history、restore、忽略规则 | T3 | 恢复测试通过，密钥不进历史 |
| T6 | 记忆：`memory` 子命令、`MEMORY.md` 生成、`chats` 导入与 FTS5 检索 | T4、T5 | 导入样例后可检索 |
| T7 | 导入：Apple Health、`.ics`、Nut AI、ChatGPT 对话 | T4 | 合成样例往返测试通过 |
| T8 | 同步：Oura、CalorieMate；密钥管理 | T4 | 用录制的响应样例测试通过 |
| T9 | 订阅源：`feed fetch` | T4 | 样例订阅源解析正确 |
| T10 | `AGENTS.md` 生成器与模板 | T3 | 生成内容覆盖 §8.1 全部要点 |
| T11 | 技能：§8.2 全部 `SKILL.md` | T6–T10 | 在 Codex 中走通 §10 阶段 1 验收清单 |
| T12 | `kaitu mcp` | T4–T9 | MCP 客户端可列出并调用工具 |
| T13 | `kaitu ui`（取代旧静态 dashboard） | T4 | 样例数据页面正确 |
| T14 | README、示例数据、隐私说明 | 全部 | 新用户按 README 完成初始化 |
