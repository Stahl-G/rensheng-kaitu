# 推进目标（开发用，随进展更新）

## 当前执行目标（2026-10-16）

最新产品裁决见 [PRODUCT.md](PRODUCT.md)：先做减法，默认收拢为总览、开图、记录。

**北极星首批（2026-10-16 定）**：按 PRODUCT.md「本轮优先级与验收」的六项实施：搬进来就看得见、不填 Key 用常用的 AI 整理、资料包、状态如实、英文界面、坚果云存放。
分支 `claude/product-analysis-north-star-z6g5gu`，交审见 [north-star-p0-2026-10-16.md](acceptance/north-star-p0-2026-10-16.md)。
精简重构的三入口、首页三项重点、摘要视图、原文记录与独立桌面入口已实现。
浏览器已验记录回读与日程确认；第 2 轮原生窗口当时因锁屏未完成，当前桌面生命周期验收见第 6 轮。历史证据见 [第 2 轮](acceptance/prd-completion-2026-10-16/run-02.md)。
足迹的文字来源、跨期/区间筛选、未知时间与外部更新已补浏览器验收，见 [第 3 轮](acceptance/prd-completion-2026-10-16/run-03.md)。
轻量方向已补问题、假设、依据、尝试、暂停归档及变化轨迹，浏览器验收与 MCP 写入见 [第 4 轮](acceptance/prd-completion-2026-10-16/run-04.md)。
第 5 轮来源排除、批次撤销与中断恢复已提交，见 [第 5 轮](acceptance/prd-completion-2026-10-16/run-05.md)。
当前仅完成用户指定的自动任务、入口配置、总览数据和桌面进程修复，提交后交审；不推送、不合并 main，不继续增加功能。

用户预览服务已启动：`http://127.0.0.1:4870`，使用本工作树代码和 current-workspace 指针指向的现有个人资料。
保留该服务供用户查看；后续合成数据验收继续使用临时工作区，不写入个人资料。更新接口后协调重启预览服务。

把现有开图桌面 App 迭代到 PRD 1.0 全部功能可用的水平。
需求原件：`/Users/yihongguo/Downloads/Kaitu_PRD_v1.0_Agent.html`，仓库文字版见 [prd-v1.0.md](prd-v1.0.md)。
覆盖 FR-01–FR-27、AC-01–AC-15，包含 P0、P1、P2；阶段排序用于安排实现，不缩减最终范围。

- 分支：`codex/kaitu-prd-completion`。
- 独立工作树：`/Users/yihongguo/Developer/rensheng-kaitu-prd`，起点 `f823b71`。
- [功能差距与验收清单](prd-completion.md)记录实现入口、缺口、验收证据和下一步。
- 使用 Computer Use 反复走真实桌面流程，修复后回归；模型、Dot 可协助研究。
- 只为真实业务错误补必要测试，不写文案匹配、复制实现、常量断言或凑数量的测试。
- 不新增免责声明。保留用户数据、已有功能、记录 ID 与当前数据规范。
- 每项完成须有实际写入、回读及相应界面结果；全量功能和 E2E 通过后再结束目标。

以下为历史方向和里程碑。旧“四页”及“七板块”导航已被 PRODUCT.md 取代，不据此补回入口。

## 北极星

以 [PRODUCT.md](PRODUCT.md)「北极星」一节为准（2026-10-20 起：让 AI 真正了解你，并能持续接着帮你把人生往前推进），指标为每周有效接续人数；这里不另写一版。
旧版「任何人都能用孙哥方法用 AI」保留为灵感来源（PRD §0），不再用于取舍。

## 已定方向（2026-10-15）

- **轻量优先**：默认只装一个开图，不要求 Docker、数据库或其他服务。能当库嵌入的开源项目直接嵌入（fflate、saxes、ical.js、isomorphic-git、SQLite FTS5……）；要部署服务的项目（wger、Miniflux、LibreChat、Vikunja 等）只做「已有就接上」的可选连接，不进默认安装。
- **我们只做两样东西**：
  1. `~/kaitu/` 现状文件夹 + `kaitu` 命令：Agent 读它就知道情况（`AGENTS.md`、`NOW.md`、各模块 `STATUS.md`）。
  2. 本地工作台（WebUI）：人打开就知道情况，只有 4 个页面，加上确认、导入、历史。
- **不自己造引擎**：饮食识别、健康数据、日历、订阅源、对话、记忆提取都用现成项目或交给 Agent。
- **分工**：Codex 写代码；Claude 写任务说明、审查、删无效测试与多余文字、跑检查、提交。

## 里程碑与完成标准

| # | 内容 | 完成标准 | 状态 |
|---|---|---|---|
| M1 | 数据层（T1–T7）：格式、校验、记录、版本、记忆、对话检索、导入 | 构建、lint、测试全部通过；样例导入可撤销 | T1–T7 完成 |
| M2 | 本地工作台 MVP：`kaitu ui` 启动本机网页，4 个页面读 `~/kaitu`，文件变化实时刷新；确认日程建议、导入（预览→确认）、版本历史与恢复都能在界面里做 | 不打开终端以外的任何服务；用样例数据走通 PRD §3.3 场景 1–3 的界面部分 | 实现与必要自动测试、CLI / 浏览器冒烟通过；完整界面验收见 M4 |
| M3 | Agent 侧：`AGENTS.md` 完整版（T10）+ 核心技能（onboarding、导入 ChatGPT、早间计划、晚间复盘、记录训练 / 饮食、加模块） | 在 Codex 里走通 PRD §10 阶段 1 验收清单 | 实现完成（含体态照片与提前的 MCP）；自动检查通过，Codex 技能发现受执行环境权限限制，实际工作流验收待补 |
| M4 | 验收：Codex 用电脑操控实际打开工作台，按脚本走一遍新用户流程，报告问题 | 问题清单清零或已记录为后续任务 | 已执行：8 项问题已修 5 项，M4-06 浏览器导入已补验，2 项设计待办留阶段 3；四项检查通过，见 [验收报告](acceptance/m4-report.md) |

| M5 | **开图 App = DSH 外壳 + 手机通道**：阶段 2 验证 DSH（换品牌、关埋点与 shell、挂页面、定时任务）；工作台页面迁为 DSH 插件（React）。手机通道**不运行 OpenClaw**，新建小模块 `kaitu-channels`，统一「收消息 / 回消息」接口：微信抽取腾讯官方 `@tencent-weixin/openclaw-weixin`（MIT）的扫码登录、接口、媒体、发送模块并去掉 OpenClaw 依赖（记录抽取版本，定期对照上游）；QQ 用官方 `@tencent-connect/qqbot-nodejs`（MIT）；飞书用官方 `@larksuiteoapi/node-sdk`（MIT，长连接）；Telegram 用 `grammy`（MIT）。只监听本机、只回复本人。DSH 前由本机 Codex 在 `~/kaitu` 续接会话回答；DSH 后包成 DSH 插件 | 手机上说「今天深蹲 3×12 60kg」→ 工作台实时出现记录与版本 | 手机通道：Telegram、微信真机通过，飞书、QQ 待实测；dsh 插件已装进桌面应用 0.2.0-rc.2 并实测写入；阶段 2 其余验证见 HANDOFF §0.4 |

**界面（2026-10-15 定）**：M2 的 Preact 工作台只作为后端验证工具，不再打磨样式。后端（数据层、MCP、Drive、手机通道）完成后，用 Claude Design 从头设计，直接实现为 DSH App 的插件页面；工作台的接口与 core 函数保留复用。

延后：Oura / CalorieMate 同步（T8）、桌面打包。MCP（T12）已提前实现。旧 T13 静态 dashboard 由 M2 工作台取代。

## 后端补充进度（2026-10-15）

dsh 插件已在桌面应用实测：`kaitu dsh --install` 写入桌面 profile，四工具复用 core，见 [dsh.md](dsh.md)。下一步见 HANDOFF §0.4。

状态目录、`.git` 迁移与 Google Drive 模式已实现：本地历史放 `.kaitu/history.git`，Drive 模式下程序状态全部留在本机。
CLI / 工作台提供开关与状态，云端 Agent 通过收件箱写入；入口与现状文件自动维护。
临时目录迁移往返、历史恢复、只读降级、收件箱与工作台防循环已验证；真实 Drive / Grok Bot / ChatGPT Dots 待实测。

项目模块（D21）已实现：本机只读链接、字数 / 提交同步、CLI / MCP / 工作台与项目技能；
验证结果见 HANDOFF §8.1。

工作区升级与健康收件箱已实现：`kaitu upgrade` 补齐内置类型、模块和技能，保留用户配置，支持预览与重复运行不写入。
工作台与 `inbox process` 可导入官方健康导出和快捷指令原始样本；共用映射、按自然键去重，合成自动导入已验证。
实际快捷指令文件与真实 iPhone / Drive 同步待实测；完整检查结果见 HANDOFF §8.1。

## 工作台技术选择（M2）

- 前端：Vite + Preact（轻、MIT），图表 ECharts（Apache-2.0），全部打包进本地静态文件，不用 CDN。
- 后端：`kaitu ui` 用 Node 自带 `http`，只监听 127.0.0.1；接口全部调用 `@kaitu/core`，不另写读写逻辑。
- 实时：监听 `~/kaitu` 文件变化，用 SSE 通知页面刷新；同一进程里实现 PRD §7.3 的「外部修改 30 秒防抖自动存版本」。
- 对话面板：M2 不内置对话；页面提示「在这个文件夹里打开 Codex / Claude Code」。内置 Agent（DeepSeek Harness 或 LibreChat）在 M4 之后再评估。

## 待核实

- ~~Codex 的电脑操控能力~~：已确认本机 Codex CLI 0.162.1 的 `computer_use`、`browser_use` 功能为 stable 且已开启。
- Node 22 上 `node:sqlite` 是否带 FTS5。
