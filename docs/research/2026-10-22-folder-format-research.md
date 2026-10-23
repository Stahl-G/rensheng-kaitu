# 个人记忆文件夹格式调研：开图该长什么样

> 日期：2026-10-22。依据四份调研笔记（论文、纯文本约定、多写者与云盘同步、Agent 记忆系统）和当前草案 `docs/proposals/2026-10-23-folder-format-v1.md（调研时依据的是它的前一版草稿）`。
> 标注沿用笔记：**[已核实]** 本次对照原页核对过；**[未核实]** 只有二手来源或凭已有知识。没标的，按笔记里对应条目的标注理解。文中例子全部是虚构的。

## 1. 一段话结论

成熟做法已经收敛成一个形状，开图照抄就行，不用发明：
**一个短入口文件 + 一页常驻画像（约 1–2k token）+ 每个主题一个 Markdown 文件（YAML frontmatter）+ 只追加的原始记录 + 后台整理。**
Claude Code auto memory、Letta MemFS、Anthropic memory tool 三家都落在“目录 + 短索引 + 主题文件 + frontmatter”上；论文那边（MemGPT、MemoryBank、Generative Agents、Zep、Mem0）也是“小核心常驻、原始记录保留、提炼出的事实是派生层”。改事实不删旧的，只标作废，并记两种时间（Zep/Graphiti、Mem0 v3）。整理放后台做（sleep-time、LightMem、Letta dreaming）。多写者和云盘这一块，论文基本没管，靠工程经验：**每个文件一辈子只有一个写者**；Agent 只新建带唯一名字的文件；只有开图 App 一个进程改写正本。CRDT、锁文件、数据库放进云盘，都不建议。

## 2. 六条硬要求逐条看

### 2.1 最便宜的模型也能很快看懂

| 做法 | 谁在用 | 成熟度 |
|---|---|---|
| 入口用 `AGENTS.md`，`CLAUDE.md` 一行 `@AGENTS.md` | AGENTS.md 官网称 6 万+ 项目、十几家工具支持；Claude Code 规则 [已核实] | 成熟 |
| 入口少于 200 行，“越长越不遵守” | Claude Code 文档 [已核实] | 成熟 |
| 渐进披露：约 100 token 元数据 → <5k token 正文 → 用到再读，链接只深一层 | SKILL.md 规范 [已核实] | 成熟 |
| 索引一行一条，只常驻前 200 行 / 25KB | Claude Code `MEMORY.md` [已核实] | 成熟 |
| frontmatter 里写 `description`，告诉模型这个文件装什么 | Letta block / MemFS [已核实] | 成熟 |
| 目录路由写死在入口，不让模型自己分类 | PerLTQA：分类这一步 LLM 不如专门的分类器 [已核实]；推出的建议是笔记作者的推断 | 推断 |

注意两点反面证据。Gloaguen 等（2026）发现上下文文件写多余要求，会**降低**成功率，成本还多 20% 以上（[arXiv 2602.11988](https://arxiv.org/abs/2602.11988v1)）。Khatri（2026）则测不出影响（[2607.27250](https://www.alphaxiv.org/abs/2607.27250)）。所以入口只写“会写坏数据”的规则。
**建议：** 入口 50–100 行，固定写“先读哪三个文件”；子目录可以有自己的短说明，按“离得最近的优先”。来源：[agents.md](https://agents.md)、[Claude Code memory](https://code.claude.com/docs/en/memory)、[agentskills.io](https://agentskills.io/specification)、[Letta blocks](https://docs.letta.com/guides/agents/memory-blocks)、[PerLTQA](https://arxiv.org/abs/2402.16288)。

### 2.2 占空间少、省 token

- 精简后的记忆每次只用约 1.6k–2k token，准确率就接近全文。Mem0 约 1.8k vs 全文 26k；Zep 约 1.6k vs 115k，而且准确率**更高**（gpt-4o 60.2→71.2）[已核实]。全文能塞下时，全文仍然最准（LoCoMo 72.9 vs Mem0 66.9）[已核实]。
- 小模型读长原文会掉 36–55%（LongMemEval）[已核实]。
- **摘要不能替代原文**：拿摘要或事实去替换原文会掉分；拿事实当“索引键”，召回 +9.4%，准确率 +5.4% [已核实]。
- 格式：扁平记录用 Markdown 键值最准；嵌套数据 YAML 最准，比 JSON 省 token；CSV 最省但最不准（厂商测试，只能看相对高低）。

**建议：** 常驻层合计约 1–2k token（入口 300–600、画像 500–1k、近况 300–500）。这是笔记作者从检索预算推出来的，**没有直接实验**。原始明细（读数、轨迹）放 CSV/JSONL，平时不读。来源：[Mem0](https://arxiv.org/html/2504.19413)、[Zep](https://arxiv.org/html/2501.13956)、[LongMemEval](https://arxiv.org/html/2410.10813)、[improvingagents](https://www.improvingagents.com/blog/best-input-data-format-for-llms)、[嵌套](https://www.improvingagents.com/blog/best-nested-data-format)。

### 2.3 自动整理

两条路线：
- **写时整理**：写入时由 LLM 决定 ADD / UPDATE / DELETE / NOOP。Mem0 论文、LangMem 用这条；Memory-R1 证明这套操作能学出来 [已核实]。
- **只追加 + 后台整理**：Mem0 v3 改成只加不改，矛盾“带时间一起保留”；Graphiti 作废不删；Letta 把 sleep-time 做成后台 dreaming，在 N 步之后或上下文压缩时触发，大改前先备份 [已核实]。

2026 年明显往后一条走。效果证据：LightMem 离线整理，总 token 最多省 38 倍，准确率还更高；sleep-time 测试时算力约省 5 倍 [已核实]。反面证据：ChatGPT 记忆“容易覆盖关键信息”，同一段历史只得 0.577，GPT-4o 离线读是 0.918 [已核实]。
**建议：** 写入只追加；整理由 App 在后台做。合并、去重、标作废、日→月汇总、写带出处的观察，都在后台。原文永远保留。来源：[Mem0 v3 迁移](https://docs.mem0.ai/migration/platform-v2-to-v3.md)、[Graphiti](https://github.com/getzep/graphiti)、[Letta dreaming](https://docs.letta.com/guides/agents/architectures/sleeptime)、[LightMem](https://arxiv.org/abs/2510.18866)、[Sleep-time](https://arxiv.org/abs/2504.13171)。

### 2.4 多个 Agent 写入不打架

- 现有系统没有一个真正解决“不同厂商 Agent 写同一份纯文本”。Letta 共享 block 是后写覆盖；MCP memory server 用锁文件；MemFS 靠 git；Mem0 / Graphiti / MemOS 靠作用域 ID [已核实]。
- 论文里没有讨论多写者冲突（笔记作者没找到）。
- 工程上最稳的是 maildir 式做法：每个写者新建唯一命名的文件，建完不再改，单个进程负责收拢 [maildir 原页 502，未核实]。坚果云官方也建议“每人一个子文件夹、一个人管结构” [已核实]。
- 身份不信 Agent 自己报的名字，由入口打标（LongMemory）[已核实]。

**建议：** 收件箱文件名 = `ULID-写者ID`，写者 ID 要细到“Agent + 机器”。Agent 不改别人的文件，也不改索引。

### 2.5 原生支持消费级云盘

- 没有一家云盘会合并纯文本。要么另存一份冲突副本，要么静默覆盖。冲突以**整个文件**为单位判断。
- 各家冲突副本命名：Dropbox `(xx's conflicted copy 日期)` [已核实]；坚果云 `-冲突` / `-NSConflict` [已核实]；Syncthing `.sync-conflict-` [已核实]；OneDrive `-电脑名`、Google Drive `(conflict)`、iCloud `名字 2` 或静默覆盖 [都未核实]。
- iCloud 在 Sonoma 以后有“无数据占位文件”：看着在、大小也对，其实没下载 [独立分析师来源]。
- SQLite 放进云盘“极可能损坏”（Zotero）[已核实]。
- CRDT 二进制文档 Agent 读写不了，Ink & Switch 自己也列了它的代价 [已核实]。

**建议：** 很多小文件、单写者、不放数据库。先写点开头的临时文件再改名。App 侦测冲突副本，修复办法是“并集 + 按 (id, 版本) 去重 + 重新折叠”，不是挑一个文件留下。读不到的文件跳过、稍后重试，**绝不当成空文件**。
**百度网盘：四份笔记都没调研，冲突行为未知。** 来源：[Dropbox](https://help.dropbox.com/organize/conflicted-copy)、[坚果云](https://help.jianguoyun.com/?p=1129)、[Syncthing](https://docs.syncthing.net/users/syncing)、[Eclectic Light](https://eclecticlight.co/2023/10/25/macos-sonoma-has-changed-icloud-drive-radically/)、[Zotero](https://www.zotero.org/support/kb/data_directory_in_cloud_storage_folder)、[Ink & Switch](https://www.inkandswitch.com/essay/local-first/)、[Joplin 锁](https://joplinapp.org/help/dev/spec/sync_lock)。

### 2.6 本地优先、纯文本、画像在用户手里

- 纯文本目录方案（Claude Code、MemFS、Anthropic memory tool）天然可搬；Mem0、Graphiti、Cognee、MemOS 都依赖数据库。
- Gemini 的“导入记忆”就是让别的 AI 输出一段纯文本偏好摘要 [二手报道]。也就是说，**一页纯文本画像已经是事实上的跨厂商交换格式**。
- Solid（日活不到 100）、Perkeep 门槛太高，没人用 [论坛证据]。

**建议：** Markdown + YAML frontmatter + `[[wikilink]]`，用 Obsidian 的属性约定，这样文件夹能直接当 Obsidian 库打开。日程、联系人、地点用 `.ics` / `.vcf` / `.geojson` [规范未核实]。来源：[Basic Memory](https://docs.basicmemory.com/concepts/knowledge-format)、[Obsidian](https://obsidian.md/help/properties)、[Gemini 导入](https://www.pcworld.com/article/3100804/google-gemini-can-now-import-your-chatgpt-or-claude-chat-history.html)、[Solid 论坛](https://forum.solidproject.org/t/solid-sustainability/7655)。

## 3. 推荐的文件夹形状

```
开图/
├── AGENTS.md            入口，≤100 行            ← AGENTS.md / CLAUDE.md 规则
├── CLAUDE.md            一行 @AGENTS.md          ← Claude Code
├── ME.md                一页画像，≤1k token，App 生成 ← Letta human block / MemoryBank 画像
├── NOW.md               今天 + 这周，App 生成     ← Supermemory profile.dynamic；sleep-time 预算
├── memory/
│   ├── MEMORY.md        一行一条索引，≤200 行，App 生成 ← Claude Code MEMORY.md
│   └── <主题>.md        一主题一文件            ← Claude Code topic 文件 / A-MEM 笔记
├── <领域>/data/<类>/2026-10.jsonl  正本，只有 App 写 ← Joplin 一物一文件 + 单一整理者
├── <领域>/data/<类>/2026-10.md     当前视图，App 生成 ← LongMemEval“当前值放前面”
├── inbox/agents/<写者ID>/<ULID>.md  Agent 只新建  ← maildir / 坚果云每人子目录
├── inbox/_ingested/2026-10/          已收拢的原件  ← 多写者笔记 §5
├── _conflicts/                       冲突副本与修复记录 ← Syncthing / Obsidian Conflict Resolver
└── .kaitu/              本机设置，不同步          ← Zotero：数据库不进云盘
```

**主题文件 frontmatter（虚构示例）：**

```yaml
---
id: 01JB...            # 稳定 ID，与文件名无关 ← Basic Memory permalink
type: user             # user/feedback/project/reference ← Claude Code
description: 居住地与搬家历史   # ← Letta
updated: 2026-10-22T09:12:00+08:00   # App 写 ← Claude Code modified
source: claude-code@laptop-a         # ← Apple Health sourceName / Mem0 agent_id
---
- 住在 杭州 (valid_from 2025-03, recorded 2025-03-02, by claude-code@laptop-a, src [[inbox/.../01J...]])
- ~~住在 南京~~ (valid 2021-07..2025-03, superseded_by 上一行)
```

行内的 `valid_from/valid_to`（现实时间）和 `recorded`（写入时间）借自 Zep/Graphiti 的双时间边；`superseded_by` 借自 Mem0g / Graphiti 的“作废不删”；`src` 借自 Generative Agents 的“观察要引用出处”和 Graphiti 的 `episodes`。“置信度”字段主流系统都没有，首版不加。

**写入协议（给只能读写文件的 Agent，写在入口第一屏）：**
1. 只在 `inbox/agents/<你的写者ID>/` 下新建文件，名字用 ULID；不改已有文件，不删文件。（maildir、Joplin）
2. 本地写者先写 `.<ULID>.tmp`，写完再改名；云端连接器直接一次创建。（Syncthing）
3. 想改某个事实：新写一条，注明它取代哪条。不要去改旧的。（Mem0 v3）
4. 拿不准放哪：照样放收件箱，由整理来分。（论文笔记推断）

**整理任务（App 后台，单一整理者）：**
- 触发：文件变化后，等文件稳定再收拢；另外空闲时做一轮深度整理。（Letta dreaming 的“N 步后”，LightMem 的离线更新）
- 收拢：入口校验一次 → 写进正本 → 原件移到 `_ingested/`；按 ULID 幂等，重复收拢不出问题。
- 合并：对每条候选做 ADD / UPDATE / SUPERSEDE / NOOP。（Mem0 论文）
- 生成：`ME.md`、`NOW.md`、`MEMORY.md`、各 `.md` 视图。超过上限就提示重写。（Claude Code 200 行规则）
- 遗忘：临时事项按 `expires` 清扫；画像和健康事实只作废，不衰减。（Mem0 `expiration_date`；MemoryBank 衰减曲线作者自称“高度简化”，不照搬）
- 大改之前先备份。（Letta）

**冲突处理：**
- 全树扫描各家冲突命名，再加一条结构检查：不符合命名规则的文件都算可疑。
- 正本旁边记一份清单（行数、最后 id、哈希），用来发现静默覆盖。
- 修复 = 并集 → 去重 → 重新折叠。版本排序用 ULID 或 HLC（混合逻辑时钟：物理时间加计数器，保证先后可比），不用整数 `rev`，否则两台机器可能同时写出 `rev: 3`。

## 4. 和当前草案比

**一致的（保留）：** `AGENTS.md` 当入口，`CLAUDE.md` 指向它；`inbox/agents/` 无工具写入；AI 只提议、带 `by`；只追加加墓碑；`ME.md` 作为程序生成的读视图，本身不是数据源（符合“摘要只当索引，不替原文”）；按月 JSONL 配 `.md` 当前视图；可读路径名；本机绝对路径移进 `.kaitu/`；敏感记忆不进画像；拔掉界面的互通测试。

**建议改或补的：**

| 草案 | 建议 | 依据 |
|---|---|---|
| 收件文件名 `<你的名字>-<时间>.md` | 改成 `<写者ID>/<ULID>.md`，写者 ID = Agent + 机器 | 同一 Agent 在两台电脑上会撞名、互相覆盖（多写者笔记 §2） |
| 三个入口合计 8 KB | 再给每个文件单独设上限：`ME.md` ≤1k token，`AGENTS.md` ≤100 行 | Letta `limit`、Claude Code 200 行 |
| `ME.md` 一行只写内容 | 每行带日期和来源；作废的事实不进画像，但在主题文件里保留 | Zep 双时间；LongMemEval 显示知识更新是难点 |
| 视图和索引由程序生成 | 写明只有**一台**设备的 App 负责生成，其余设备只读 | 两台桌面同时生成同一个视图，也会出冲突副本 |
| 修订号沿用整数 `rev`（v1 不改） | v1 可以不改，但要记成已知风险，以后换 ULID/HLC | 多写者笔记 §3 |
| 没提冲突副本 | 加冲突侦测、并集修复、`_conflicts/` | 云盘行为（§2.5） |
| 没提 iCloud 占位文件 | 读不到就跳过重试，不当空文件 | Eclectic Light |
| 20 个技能存两份 | 写进规范已经不错；同时尽量缩短入口里的规则清单 | Gloaguen 2026 |
| 互通测试 10 问 | 按下一节补齐题型 | LongMemEval |

## 5. 怎么测

照 LongMemEval / LoCoMo 的做法，做一个合成文件夹。用一个虚构人物 18 个月的资料，故意埋 3–4 次“改变”（搬家、换药量、换目标）。题型如下：

| 类别 | 例题（虚构） | 来源 |
|---|---|---|
| 单点事实 | 他的血型？ | LongMemEval |
| 跨文件综合 | 哪些目标和睡眠有关？ | LongMemEval 多会话 |
| 时间推理 | 手术前两周在做什么？ | LongMemEval / LoCoMo |
| 知识更新 | 现在的药量？（必须用最新未作废的那条） | LongMemEval |
| 拒答 | 护照号？（没有就说不知道） | LongMemEval |
| 来源 | 这条是谁、从哪记的？ | Zep 引用 |
| 写入 | “记下我现在 70kg”，再 diff 文件夹检查 | MemoryAgentBench 测试时学习 / 选择性遗忘 |
| 多写者 | 两个写者同时写，再塞一个冲突副本，看能否修复 | 多写者笔记 |

- **条件：** 只给入口自己找文件 / 全量拼接 / 有无摘要层。模型分前沿、中档、最便宜三档。
- **记录：** 各类准确率、读了多少 token、读了几个文件。评分用 LLM 判分对照标准答案，写入题用精确检查。
- **重点看小模型。** gpt-4o-mini 用了 Zep 的时间元数据后，知识更新反而从 76.9 掉到 74.4；Llama 8B 会漏掉时间线索 [已核实]。所以要 A/B 测：每条都写绝对日期；“当前值”放在历史前面；入口里写死目录路由。
- 按仓库约定，测量脚本和结果放 PR 描述，不进仓库。

## 6. 没核实的和缺口

- **百度网盘、OneDrive、Google Drive、iCloud 的冲突命名都没有官方文档**（后三者标 [未核实]，百度网盘没调研）。需要逐家实测，延迟上限也要测。
- ChatGPT / Grok 通过 Drive 连接器能不能覆盖已有文件、会不会造出同名文件，没查。“连接器只会新建”这一点不能当前提。
- 常驻层“1–2k token”是推断，没有直接研究画像大小和准确率的关系；中文 token 比例也没研究。
- 没有论文把 Markdown 文件夹和向量库、图库正面对比过，也没有针对“工具都没有的模型读文件夹”的基准。第 5 节的评测是设计推断。
- 格式准确率数据来自厂商博客，用的是小模型、超大数据，只能看相对高低。
- maildir 原页打不开；ULID 规范、MemGPT 的函数名、Reflexion 的数字、CoALA 四分类细节、SKILL.md “30+ 工具”都 [未核实]。
- Letta MemFS frontmatter 的完整字段、dreaming 提示词没有公开；Mem0 开源版是否已完全去掉 UPDATE/DELETE，说法不一。
- 冲突后用 git 当历史层而不当同步通道，是推断，没有来源。
- 改动 PRD §6 数据规范前，按仓库约定要先和用户确认，并同步 `schemas/` 和生成模板。
