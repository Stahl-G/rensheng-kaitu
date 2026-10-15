# 交接说明：人生开图（开图 Kaitu）

- 交接日期：2026-10-15
- 交出方：云端 Claude Code 会话（产品讨论与调研）
- 接收方：本地 Claude Code（负责开发）
- 当前状态：**只有文档，没有代码。** 仓库内容是本次讨论的全部产出。

---

## 1. 先读什么

1. 本文件：背景、已定决策、调研结论、未核实事项、第一批任务。
2. [`docs/PRD.md`](PRD.md)：完整需求。**数据规范（PRD §6）是整个项目的核心，所有阶段都遵守它。**
3. [`docs/reference/interview-transcript.md`](reference/interview-transcript.md)：访谈全文（docx 原件在同目录）。PRD §4 的每条功能都标了时间戳，需要确认「孙宇晨原话怎么说」时按时间戳搜索。文件开头有使用注意事项，先读。

---

## 2. 项目一句话

照孙宇晨 × 邵艾伦访谈里的方法，把个人生活「全部 AI 化」：数据全部放在本地 `~/kaitu/` 文件夹（Markdown + JSON），任何 Agent 读这个文件夹就知道用户是谁、在做什么、下一步做什么；人通过只显示 4 个页面的 Workbench 看进度、确认建议。

---

## 3. 仓库与命名

| 项 | 值 |
|---|---|
| 当前仓库 | `stahl-g/-`（用户用中文名创建，GitHub 把中文转成了 `-`）。用户可能改名为 `rensheng-kaitu`，以用户为准 |
| 显示名 | 人生开图 |
| 应用名 | 开图 |
| 命令行 / 包名 | `kaitu` |
| 默认数据目录 | `~/kaitu` |
| 本次提交所在分支 | `claude/zen-tesla-n3ot1p`（仓库原本为空）。之后的分支与合并策略由用户决定 |

命名注意：项目名、Logo、包名中**不要**出现孙宇晨、邵艾伦的名字或「薄肌」一词（姓名权与对方内容 IP）。他们的名字只出现在 README 的「灵感来源 + 免责声明」中（PRD 附录 B）。

---

## 4. 已定决策（附理由）

| # | 决策 | 理由 |
|---|---|---|
| D1 | 定位：个人工具，开源、本地优先；不做企业级溯源、评分、审计、多用户 | 用户明确要求；BriefLoop 那套溯源对个人工具过重 |
| D2 | 数据 = `~/kaitu/` 下的 MD + JSON，记录类用按月 JSONL 只追加 | 人能读、任何 Agent 能读；与运行时解耦，换底座不丢数据 |
| D3 | 导航只放 4 个页面：今天、健康、动态、我的；学习、方向与决策、复盘由 Agent 管理；记忆、导入放设置 | 用户：「人看了没意义的模块不要放首页」 |
| D4 | 健康是一个模块，内含 4 个子页（训练、饮食、睡眠与活动、身体指标） | 用户要求合并；同时覆盖访谈中的 4 项功能 |
| D5 | 模块由 `module.json` 定义，`visibility: nav | agent`；支持对话中新建自定义模块 | 用户的写作模块等个人需求通过定制实现 |
| D6 | **阶段 1 先做 Codex 版**：文件夹模板 + `AGENTS.md` + 技能 + `kaitu` CLI/MCP，无界面 | 用户用 ChatGPT 订阅登录 Codex，免 API Key；不写界面就能验证核心价值 |
| D7 | 阶段 3 的底座：**DeepSeek Harness（dsh），锁定 `0.2.0-rc.2`，做成自定义 profile + 插件包，不 fork** | 一切皆插件、插件可加前端页面、自带定时任务 / MCP / ACP / 多模型；不接受外部 PR，fork 会变成独自维护 |
| D8 | 不用 Open Design 当底座，只参考 | 每次运行都带设计师提示词；插件不能扩展界面 |
| D9 | 先 WebUI，稳定后再用 Electron 打包 | 用户要求 |
| D10 | 不做手机端 | 用户：「手机太麻烦，有用户再说」 |
| D11 | 项目专属记忆仿 ChatGPT，存在 `~/kaitu/memory/`；**自动提取默认开启**，可撤销、可暂停 | 用户要求；放在文件夹里所有 Agent 共用，不依赖各运行时自带的记忆 |
| D12 | 导入：v1 ChatGPT（提示词贴回 + 粘贴记忆列表 + `conversations.json`），v2 Claude，v3 Gemini | 用户要求；三家导出记忆都不可靠，「提示词贴回」三家通用，Anthropic 自己的导入功能也是这么做的 |
| D13 | 版本历史用 isomorphic-git，界面不出现 git 字样 | 普通用户不会 git |
| D14 | 饮食拍照不自建：对接 CalorieMate（MIT，自部署）和 Nut AI（AGPL，手机 App 导出 JSON），另提供纯文字记录 | 照片估算不稳定是模型问题，自建无法解决；Nut AI 用营养数据库 + 误差范围，准确度做法更好 |
| D15 | 能用开源不自造；AGPL 项目只作为独立程序使用，不复制代码进本仓库 | 用户要求；许可证兼容 |
| D16 | 日程写入外部日历前必须人确认；日常记录与自动记忆直接写入、可撤销 | 写错日历代价高，记错一条记录代价低 |
| D17 | 定时任务：早间计划、晚间复盘、周复盘、月复盘与现状分析 | 覆盖访谈中的日报与长期复盘；参考 Instinct 的每日记忆整理 |
| D18 | **轻量优先**：默认安装不要求 Docker 或其他服务；能当库嵌入的开源项目直接嵌入，要部署服务的只做可选连接；我们只做现状文件夹 + 本地工作台（见 `docs/GOAL.md`） | 用户裁决（2026-10-15）；与北极星「任何人、尽量简单」一致 |

---

## 5. 调研结论（开发时会用到的事实）

### 5.1 DeepSeek Harness（阶段 2、3 的底座）

- 仓库：`github.com/deepseek-ai/deepseek-harness`，MIT。我读到的最新提交是 2026-10-14 的 `0.2.1-alpha.3`。
- **没有正式稳定版**，所有标签都带 alpha 或 rc。最接近稳定的是 `dsh-v0.2.0-rc.2`，决定锁定它。官方声明处于开发者预览阶段，会有破坏兼容的变更；不接受外部 PR；未做安全审计（见其 `SAFETY.md`）。
- 架构：基于 Cordis，一切皆插件，注册是可逆副作用，卸载即撤销，支持热重载。核心概念见其 `docs/cordis-primer.zh.md`、`docs/architecture.zh.md`。
- 组合：profile = 具名插件组合；自带 `web`、`headless`、`sdk`、`sdk-minimal`、`acp`。每个插件是 `cordis.patch.yml` 中的一行，可以用 patch 设置 `disabled: true`。查看实际启动的配置树：`dsh --profile web --dump-config`。
- Web 组合的插件清单在 `packages/bundle/web-app/cordis.patch.yml`。**必须禁用**：`dsh-host-product-telemetry-otel`、`dsh-client-product-analytics`。计划禁用：终端、shell、浏览器操控、电脑操控、SSH、LSP、DeepSeek 账号、Agent Teams、工作流、open-in-app 等。
- 前端也是插件。全局页面注册到 root 作用域的 `main` 槽位（`ctx.layout.selectPanel`，见 `packages/client/ui-layout/README.zh.md`）；`ui-schedule` 的「自动化任务」页面就是一个先例。右侧栏页签用 `ctx.sidebarRight`；设置卡片见 `docs/cookbook/adding-a-settings-card.zh.md`。
- 我们会用到的包：`llm-pi-ai`（多模型，底层 pi-ai）、`llm-deepseek-api-key`、`credentials-local`、`schedule` / `tool-schedule`、`mcp-client`、`skill`、`acp`。记忆类 MCP 的接入参考：`docs/user/guide/mcp-memory.zh.md`。
- Open Design 在接 dsh 时专门处理过它版本变化太快的问题（见 `nexu-io/open-design` 的 `apps/daemon/src/runtimes/defs/deepseek-harness.ts`）。

### 5.2 Open Design（只参考）

- `github.com/nexu-io/open-design`，Apache-2.0，读到的版本是 0.25（提交 `14fee23`）。
- 可参考：`apps/daemon/src/memory.ts`（`MEMORY.md` 索引 + 一条一个文件 + LLM 提取，格式与 PRD §7.1 一致）、`apps/daemon/src/live-artifacts/`（模板 + 数据 + 数据源的看板卡片）、`apps/daemon/src/runtimes/`（运行时适配器写成数据定义）。
- 复制代码时保留 Apache-2.0 版权与 NOTICE。

### 5.3 BriefLoop（退路方案的代码来源）

- 用户自己的仓库 `stahl-g/briefloop`。`native-engine/` 基于 `@earendil-works/pi-coding-agent@1.2.0`，已用真实模型跑通过一次完整流程。
- 阶段 2 不通过时，复用其中的 `main.ts`（会话）、`runner-tools.ts`（工具定义）、`compaction.ts`（上下文压缩）、`models.json`，以及 API Key 存储的做法（文件权限 600、不放进工作区）。
- 报告相关的溯源、评分、审计代码不要复制。

### 5.4 其他依赖

| 项目 | 结论 |
|---|---|
| Open Wearables（`the-momentum/open-wearables`） | MIT，约 2.7k star；统一接 Oura、Garmin、Whoop、Apple Health 等，自带 MCP；需要 PostgreSQL + Redis + Celery，较重，v1 不用 |
| CalorieMate（`ignoxx/caloriemate`） | MIT，40 star；Docker 部署；后端是 PocketBase，数据表有自动 REST 接口；README 没写导出功能 |
| Nut AI（`Blueturboguy07/nut-ai`） | AGPL-3.0，55 star，作者标注 alpha；手机 App（Expo），可导出单个 JSON；营养来自数据库，带误差范围 |
| basic-memory | AGPL；有 `import chatgpt` / `import claude conversations` 命令。**不要依赖它**，ChatGPT 对话导出格式简单，自己写解析器 |
| caldav-mcp（`dominik1001/caldav-mcp`） | MIT，TypeScript，npm 发布；支持列出、创建、删除事件 |
| Hermes Agent 记忆 | `~/.hermes/memories/` 下的 `MEMORY.md`（约 2,200 字符）与 `USER.md`（约 1,375 字符），会话开始时读入、之后固定 |
| Instinct（闭源竞品） | 据第三方拆解：git 管理的 Markdown + 关键词搜索 + 每日后台整理；模型可见用户画像、一页记忆摘要、待办板。与本方案一致，可作为 README 的定位参照 |

---

## 6. 未核实事项（使用前必须先确认）

| 事项 | 影响 |
|---|---|
| Codex 技能目录的位置与 `SKILL.md` 格式细节 | 阶段 1 技能放在哪里 |
| `codex exec` 的非交互参数 | 以后定时调用 Codex |
| Codex 能否通过 `~/kaitu/.mcp.json` 或必须用 `codex mcp add` 配置 MCP | 阶段 1 的 MCP 配置方式 |
| `node:sqlite` 是否带 FTS5 | 不带就用 better-sqlite3 |
| Apple Health `export.zip` 的具体格式与大文件处理 | T7 解析器 |
| Oura 个人访问令牌（Personal Access Token）是否仍可用；如已停用需走 OAuth | T8 Oura 同步 |
| dsh 插件包以固定 peer 版本发布到 npm 后能否被其插件管理器安装 | 阶段 2 |
| dsh 的 preset 能否把 shell 类工具彻底关掉，文件读写能否限定在 `~/kaitu` | 阶段 2 |
| ChatGPT 官方数据导出是否包含已保存的记忆（各方说法不一） | 导入引导文案 |
| 用户指定的 Codex 编码模型名称「gpt sol 6.1」 | 仅为用户偏好，未核实名称 |

---

## 7. 第一批任务

按 PRD 附录 C 的 T1–T14 推进。建议第一个合并单元是 **T1–T5**（脚手架、schema、`init` / `doctor` / `validate`、记录读写库、版本历史），因为后面所有任务都依赖它们，而且这部分不需要任何外部账号。

阶段 1 的完成标准是 PRD §10 的验收清单，逐条核对，不以「构建通过」代替。

---

## 8. 开发约定

- 语言与工具：TypeScript，Node 22（与 dsh 的 `^22.19.0 || >=24` 一致），pnpm workspace。
- 文档、界面、提示词默认中文。
- 测试：照 PRD §12。只为导入往返、schema 校验、写入范围、版本恢复、记录追加语义、时区边界写测试；不写断言文案或复述常量的测试。
- 密钥与个人数据不进仓库、不进日志。测试与示例只用合成数据。
- 任何命令都不能写出 `~/kaitu/`（测试中用临时目录）。
- 外部代码保留许可证与来源说明，记在 `THIRD_PARTY_NOTICES.md`。
- `docs/reference/` 中的访谈逐字稿仅供内部参考，**仓库公开前必须移除或确认授权**。

---

## 8.1 进展记录

### 2026-10-15：T1–T5 完成（分支 `feat/t1-t5-foundation`）

- 结构：`packages/core`（全部逻辑）、`packages/cli`（`kaitu` 命令，只做参数解析与输出）、`schemas/`、`templates/kaitu/`。阶段 3 的 dsh 插件直接依赖 `@kaitu/core`。
- 实现时补的约定（PRD 未写明，均不改变 §6）：
  - 补充剂记录放 `health/data/supplements/{YYYY-MM}.jsonl`。
  - `module.json` 中 `records.*.schema` 先按模块目录解析（自定义模块放 `<模块>/schemas/`），找不到再用内置 schema；不允许 `..`。
  - 修改记录时，新版本写进新 `ts` 所在月份的文件；读取时跨所有月份按 `rev` 取最新，所以改日期不会留下旧版本。删除标记写在删除时刻所在月份。
  - `record add` 的 `ts` 可由调用方给出（补记昨天的训练），必须带时区偏移；不给就用当前时间。
  - 恢复前先自动存一个版本，恢复本身也生成一个版本，所以恢复可以撤销。密钥、索引、缓存除 `.gitignore` 外还在代码里硬排除。
  - 对话放在 `chats/YYYY/MM/<id>.jsonl`，月份按创建时间在用户时区切分。首行是
    `{type:"chat",id,title,source,created,updated}`，之后每行是
    `{type:"message",id,role,ts,text}`，`role` 为 `user|assistant|system|tool`。
    时间为带偏移的 ISO 8601，原消息无时间时 `ts` 为 `null`；按 `chat.schema.json` 校验。
- 外部文件变化的 30 秒防抖自动提交（PRD §7.3）需要常驻进程，留到阶段 3；阶段 1 用 `kaitu snapshot -m`，AGENTS.md 已写明。
- `AGENTS.md` 生成器先做了基础版（读取顺序、模块清单、写入与确认规则、安全），记忆规则已在 T6 补齐，T10 再补日常节奏、技能清单。
- 已核实：Node 26 的 `node:sqlite` 带 FTS5。Node 22 上尚未验证（HANDOFF §6 一项仍待确认）。

### 2026-10-15：T6 记忆与对话检索

- 记忆增改删后重写 `MEMORY.md` 并自动生成版本；更改名称或类型会重命名条目文件，保留正文和来源。
- ChatGPT JSON / zip 导入按 `current_node` 选择显示分支，同一更新时间跳过，整次导入仅生成一个版本；`--dry-run` 不写入。
- 对话全文索引使用 `node:sqlite` FTS5 trigram，少于 3 字符改用 LIKE。索引可重建，搜索时同步文件变化与恢复操作。

### 2026-10-15：T7 结构化导入

- Apple Health 用 fflate 流式解压、saxes 解析；活动跨本地午夜按时长分摊，同日各来源分别求和后取最大值。
- 睡眠同来源间隔不足 60 分钟合并、重叠时段只计一次；按醒来前移十二小时的本地日期分组，取总睡眠最长的来源。
- 共用导入层按来源与自然键去重：metric 为 kind + ts，sleep 为 start，activity 为 date，meal 为 ts，event 为 external_id；整批先校验，有改动只存一个版本。
- 日历用 ical.js 展开，缺省窗口为今天前 30 天至后 180 天（含首尾）；仅删除同来源、同日历、开始日期在窗口内且文件已缺失的事件，窗口外保留。
- Nut AI 按 portion 缩放营养与误差，保留毫秒时间；无明细餐食及有氧热量条目只计跳过，不写照片路径。

## 9. 用户偏好（从讨论中总结）

- 能用成熟开源方案就不自己做，商品化的功能（饮食识别、健康数据接入）直接对接。
- 先做出来再考虑品牌、授权、发布。
- 首页要少，人只看有进度、需要看的东西。
- 用户本人已经把很多信息告诉过 ChatGPT，导入 ChatGPT 记忆是第一优先。
- 用户自己维护 BriefLoop，熟悉多运行时、Pi 引擎、ACP，可以直接讨论技术细节。

---

## 10. 仍待用户裁决

1. 仓库许可证：Apache-2.0（倾向，便于参考 Open Design）还是 MIT。
2. 目标用户以国内为主还是海外：影响默认模型预置、健康设备支持（华为、小米）。
3. 记忆自动提取用主模型，还是单独配置一个便宜的小模型。
4. 仓库是否改名为 `rensheng-kaitu`。
