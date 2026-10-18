# 交接说明：人生开图（开图 Kaitu）

## CodeBuddy ACP 本地开发（2026-10-18）

独立分支 `codex/codebuddy-acp` 接续 `origin/wip/local-agents` 的 snapshot，本轮只开放 CodeBuddy，保留现有 DeepSeek 入口。仅完整 Agent 模式，用户已有 CLI 登录；未实现反向 `kaitu acp` 服务端。Mac 已通过三次合成模型任务及会话保存、恢复、取消；打包 MCP helper 的合成待办写回通过。独立 Mac App 已通过签名、启动与模拟 ACP 接口验收；受控终止后子进程/端口退出通过，原生 GUI 退出菜单与 Windows 仍待验收。已有草稿 PR #16，未合并、未发布。详见 [验收与交接](acceptance/codebuddy-acp-2026-10-18/README.md)。

## 当前产品裁决（2026-10-16）

以 [PRODUCT.md](PRODUCT.md) 为唯一当前产品定义，首发范围与发布门槛见 [prd/launch.md](prd/launch.md)。
独立 Kaitu.app 四个同级入口：今天、开图、资料、问问；DSH 插件三个入口（今天、开图、资料）加 DSH 原生会话。界面依据 [V2 原型](design/kaitu-v2-prototype.html)。
本文件以下三入口、四页/七板块等描述均为历史实施记录，不作为导航依据。
实现状态及验收见 [prd-completion.md](prd-completion.md)。
独立本地桌面入口和 DSH 插件共用同一套 React 页面；默认不启动 AI Runtime，用户进入问问或开启自动任务时才启动。
新工作区没有私人健康目标和默认自动化，已有配置保留。运行与隔离验收见 [desktop.md](desktop.md)。
轻量方向与尝试见 [第 4 轮验收](acceptance/prd-completion-2026-10-16/run-04.md)：
方向决策由用户保存，AI 通过专用 exploration 工具提议与补资料，通用记录工具不能绕过采纳步骤。
当前隔离桌面包为 `dist/prd-explore-final/Kaitu.app`，锁屏尚未完成原生窗口验收。

## 本轮后端交审（2026-10-16）

第 5 轮来源控制和可恢复批次已提交为 `a38a665`。
自动任务、API Key 引导范围、总览数据和 AI 进程生命周期见 [第 6 轮](acceptance/prd-completion-2026-10-16/run-06.md)。
最终四项检查通过，128 项测试通过；原生启动、设置、单实例与退出已回归。
桌面产物为 `dist/prd-backend-review-fixed/Kaitu.app`。当前分支仅本地提交，交用户审阅，不推送、不合并 main。
本次后端分工不继续修改页面或扩展其他功能。

- 交接日期：2026-10-15
- 最近更新：2026-10-15，本地 Claude Code 会话交给后续 Claude Code / Codex 会话。
- 当前状态：阶段 1 基本完成，已有健康同步、手机通道、DeepSeek Harness 插件；下一步是阶段 2 验证。**先读 §0。**

---

## 0. 当前交接（最新，先读）

### 2026-10-16：健康采集域扩展

- 用户已批准三类独立健康记录：symptom、mood、heart_notification，心率通知不复用日历 event。
- 本分支已接入 KaituSync samples 的 11 类症状、七级心理状态、三类心率通知与 HRV。
- 已同步 schema、PRD §6、内置健康模块、生成的 Agent 说明和旧工作区升级；新域暂不扩展 XML / 并列列表。
- 已合入 main（合并提交 `d2b50d5`）。
- 四个健康专用 MCP 工具仍为提案；已有 record_list 可读新类型。格式入口：docs/proposals/kaitu-health-v2.md。

### 0.0 2026-10-15 晚：开图 App（dsh 插件）进度

- 主分支：`main`（2026-10-15 起为 GitHub 默认分支，其余开发分支已合并删除；新功能从 `main` 切分支，做完合回）。本机 `kaitu` 指向 `~/Developer/rensheng-kaitu-runtime`，更新：`git fetch origin && git checkout --detach origin/main && pnpm build`，再重启桌面应用。
- 桌面应用已装 Kaitu 品牌（标志、名称、Powered by DSH 版本）并隐藏无关入口；账号后端必须保留，桌面欢迎页启动时查询登录状态，禁用会导致应用无法启动。
- 板块页面：今天、健康、在做的事、资讯、关于我（含更换头像，头像只在本机）已完成；地图、财务页面进行中，没有设计稿，按现有设计语言与 PRD 1.0 第 12 节做。
- 后端已完成：GitHub 同步（项目）、财务 P0（支付宝 / 持仓 CSV）、资讯（任何 Agent 投递 news_item / trend）、人生地图（离线城市表 `packages/core/data/cities.json`，GeoNames CC BY 4.0，坐标只来自城市表）。
- 真实工作区已 `kaitu upgrade`（新增 explore、finance 模块）。
- 工作方式：Claude 直接 `codex exec` 派任务，一个任务一个 worktree，审查、删无用内容、跑四项检查、合并。不经过中间 Claude 会话。
- 写给 Codex 的规则：测试最多 2 个、只测用户能感受到的行为；不加哈希、免责声明、「待实测」段落；四项检查只跑一次。测试默认超时为 15 秒（vitest.config.ts），机器忙时也不会误报。

### 0.1 现在能用什么（均已真机实测）

| 能力 | 入口 | 实测结果 |
|---|---|---|
| 工作区 | Drive 模式：`~/Library/CloudStorage/GoogleDrive-…/我的云端硬盘/kaitu`；程序状态在 `~/Library/Application Support/kaitu/<uuid>/` | `kaitu validate` 通过 |
| 本机 `kaitu` 命令 | 指向独立 worktree `~/Developer/rensheng-kaitu-runtime`（detached），改完代码要在那里 `git fetch origin && git checkout --detach origin/main && pnpm build` | — |
| Apple 健康同步 | iPhone 快捷指令每晚 22:00 → Apps Script → `inbox/health/` → 工作台或 `kaitu inbox process` 导入；安装页 `docs/guides/apple-health.html`，分享链接 `https://www.icloud.com/shortcuts/3e47eb2c6bae4714a08f340f8f444fd8` | 步数已入库；不戴表睡觉的空睡眠数据直接归档 |
| 手机通道 | `kaitu ui --channels`（前台进程，电脑休眠或关终端即停） | Telegram、微信：配对、「处理中」回执、Codex 写入、版本均通过；飞书、QQ 未实测 |
| DeepSeek Harness | 桌面应用 0.2.0-rc.2；`kaitu dsh --install` 把插件写进 `~/.dsh/profiles/desktop/cordis.patch.yml` 的 `# kaitu:start…end` 段 | 新会话里调用 `kaitu_status` / `kaitu_add_record` 写入饮食并存版本；默认模型是 opencode-go |
| 浏览器导入 | 工作台设置 → 导入 | 预览 → 确认 → 撤销已补验（M4-06） |

仓库：`Stahl-G/rensheng-kaitu`（公开，2026-10-15 由 `Stahl-G/-` 改名），默认分支 `main`；网站在 `gh-pages`；Kaitu.app 打包在 `claude/kaitu-app`（未完成）。访谈逐字稿已移出仓库（`.gitignore`），只在原开发机本地；旧提交里仍可见，是否改写历史未决。

### 0.2 分工与工作方式

- **Codex 写代码**：`codex exec -s workspace-write -C ~/Developer/rensheng-kaitu -o <结果文件> - < <任务说明>`。Codex 沙箱不联网，需要新 npm 依赖时由 Claude 先装好。
- **Claude**：写任务说明（中文、带完成标准）、审查、删无用测试和多余文字、跑 `pnpm build && pnpm typecheck && pnpm lint && pnpm test`、提交推送。
- 用户偏好：回复用中文；不用问，选最简单、最有用户价值的方案；轻量优先、能复用开源就复用。
- 安全：不替用户输入密钥 / token（用户自己粘贴）；Apps Script 脚本属性等密钥存储由用户操作；测试只用临时目录和合成数据，不碰真实工作区和 Drive；分享 / 发布前给用户确认。

### 0.3 已知问题与小待办

- Agent 在 dsh 里有时用 shell 直接读文件而不是开图工具（阶段 2 的 kaitu profile 关掉 shell 后解决）。
- `dsh web` 的 `--no-open` 放在 `--patch` 前会报 `unknown option '--patch'`；直接不加 `--no-open`。
- 本机 dsh 的外部插件 `dsh-vision-toolkit@0.1.2` 与 rc.2 不兼容被跳过（用户自己的插件，与开图无关）。
- `kaitu ui --channels` 没有后台常驻（launchd）方案；电脑休眠消息就没人处理。
- 原生 `window.confirm` 会阻塞浏览器自动化，验收时用 JS 覆盖 `confirm` 或让用户点。
- M4 剩余两项是设计问题（自定义模块导航入口、恢复前预览），留给阶段 3 的 Claude Design。

### 0.4 下一步：阶段 2「DeepSeek Harness 验证」（PRD §10）

> **2026-10-15 暂停**：用户把方向调整为「云端可以独立运行」，阶段 2 先暂停。当前优先级是云端接力：[cloud-relay.md](cloud-relay.md) 已实现，用户已按 [验收脚本](acceptance/cloud-relay.md) 实测通过（第二版：白天只追加、夜间任意 Agent 整理；锁已废弃）。dsh 0.2.0-rc.2 源码已克隆到 `~/Developer/deepseek-harness-rc2`，恢复阶段 2 时直接用。

按顺序做，每项一个 Codex 任务；任务说明草稿在 [`docs/briefs/`](briefs/)：

1. **定时任务**（[stage2-schedule.md](briefs/stage2-schedule.md)）：用 dsh 的 schedule 跑早间计划 07:30、晚间复盘 22:00，通过 MCP 接日历。这是 PRD §13「作者连续用 30 天」的前提，优先级最高。
2. **kaitu profile**（[stage2-profile.md](briefs/stage2-profile.md)）：单独的 dsh profile，禁用埋点、shell、浏览器 / 电脑操控等；文件读写限定在工作区。
3. **「今天」页面插件**（[stage2-page.md](briefs/stage2-page.md)）：最小前端插件，验证能注册全局页面、换品牌与导航；样式不打磨。
4. **npm 安装**：插件以固定 peer 版本发布到 npm 后能被 dsh 插件管理器安装加载（发布前问用户）。
5. 新用户首次启动与填 API Key 的完整流程走一遍。

全部通过后进入阶段 3：Claude Design 设计 4 个页面，直接做成 dsh 插件页面。不通过时按 PRD §10 的退路（自建薄外壳 + Pi 引擎）。

并行：用户开始 30 天自用（健康同步 + Telegram / 微信 + dsh 对话），使用中暴露的问题优先修。

---

> **以下 §1–§10 是 2026-10-15 首次交接时的历史记录，保留作背景；当前状态与下一步以 §0 为准。**

## 1. 先读什么

1. 本文件：背景、已定决策、调研结论、未核实事项、第一批任务。
2. [`docs/PRD.md`](PRD.md)：完整需求。**数据规范（PRD §6）是整个项目的核心，所有阶段都遵守它。**
3. `docs/reference/interview-transcript.md`（不进仓库，只在原开发机本地）：访谈全文。PRD §4 的每条功能都标了时间戳，需要确认「孙宇晨原话怎么说」时按时间戳搜索。文件开头有使用注意事项，先读。

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
| D19 | 体态照片：健康模块新增 `photo` 记录，照片原件存在 `health/files/photos/`，只在本机，进版本历史；身体指标页提供按日期并排对比 | 用户确认（2026-10-15）；覆盖访谈中「6 个月、一年的体态对比照片」 |
| D20 | Google Drive 模式：数据进 Drive，版本库 / 密钥 / 索引留本机；云端 Agent 读 OVERVIEW.md、写 inbox/agents/（见 `docs/drive-sync.md`） | 用户选择先服务 Grok Bot / ChatGPT Dots 用户（2026-10-15） |
| D21 | 新增内置模块「项目」（`projects/`，个人项目与工作）：每个项目一个子目录（STATUS / notes / log），`kind: work|personal` | 用户认可（2026-10-15） |
| D22 | workout 扩展有氧，旧力量兼容；me 新增 task 待办 / 提醒，沿用追加修订与版本。提醒先在早间计划与今天页列出，推送留 M5 | 用户 2026-10-15 确认；来源：ChatGPT Dot 收件箱实测跑步与生日礼物待办 |

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
| Codex 技能目录：模板使用 `.agents/skills/<name>/SKILL.md`，frontmatter 为 name / description；CLI 0.162.1 在临时工作区执行 `codex exec --ephemeral -s read-only` 时于初始化阶段报 `Operation not permitted`，`debug prompt-input` 同样受限，尚不能确认实际注入 | 已实现模板与双目录复制；待可运行 Codex 的环境完成发现验证 |
| `codex exec` 的非交互参数 | 以后定时调用 Codex |
| Codex 能否通过 `~/kaitu/.mcp.json` 或必须用 `codex mcp add` 配置 MCP | 阶段 1 的 MCP 配置方式 |
| `node:sqlite` 是否带 FTS5 | 不带就用 better-sqlite3 |
| Apple Health `export.zip` 的具体格式与大文件处理 | T7 解析器 |
| Oura 个人访问令牌（Personal Access Token）是否仍可用；如已停用需走 OAuth | T8 Oura 同步 |
| dsh 插件包以固定 peer 版本发布到 npm 后能否被其插件管理器安装 | 阶段 2 |
| dsh 的 preset 能否把 shell 类工具彻底关掉，文件读写能否限定在 `~/kaitu` | 阶段 2 |
| ChatGPT 官方数据导出是否包含已保存的记忆（各方说法不一） | 导入引导文案 |
| 用户指定的 Codex 编码模型名称「gpt sol 6.1」 | 仅为用户偏好，未核实名称 |
| 坚果云桌面端的默认同步目录（代码依次找 `~/Nutstore Files/我的坚果云`、`~/Nutstore Files`、`~/我的坚果云`、`~/坚果云`、`~/Nutstore`）和冲突副本命名，官方帮助里没查到；代码目前只认通用冲突写法，不猜坚果云专有后缀 | launch L11：两台电脑真机核对后修正 `sync-location.ts` 与 `sync-files.ts` |

---

## 7. 第一批任务（历史记录，已完成；当前任务见 §0.4）

按 PRD 附录 C 的 T1–T14 推进。建议第一个合并单元是 **T1–T5**（脚手架、schema、`init` / `doctor` / `validate`、记录读写库、版本历史），因为后面所有任务都依赖它们，而且这部分不需要任何外部账号。

阶段 1 的完成标准是 PRD §10 的验收清单，逐条核对，不以「构建通过」代替。

---

## 8. 开发约定

- 语言与工具：TypeScript，Node 22（与 dsh 的 `^22.19.0 || >=24` 一致），pnpm workspace。
- 文档默认中文。界面和提示词以中文为默认，同时提供英文：前端用 `client/i18n.tsx` 的 `t(中文, English)`，core 用 `locale.ts` 的 `pick`；用户写的内容不翻译。新增文案两种语言一起写。
- 测试：照 PRD §12。只为导入往返、schema 校验、写入范围、版本恢复、记录追加语义、时区边界写测试；不写断言文案或复述常量的测试。
- 密钥与个人数据不进仓库、不进日志。测试与示例只用合成数据。
- 数据只写工作区，程序状态由本机可信工作区映射决定，工作区配置的 state_dir 仅用于首次迁移；Drive 迁移另写本机工作区指针与旧位置说明。测试用临时目录。
- 外部代码保留许可证与来源说明，记在 `THIRD_PARTY_NOTICES.md`。
- `docs/reference/` 中的访谈逐字稿仅供内部参考，已加入 `.gitignore`，不要重新提交。

---

## 8.1 进展记录

### 2026-10-16：读取缓存与朱砂配色

- 读取缓存：`Workspace.scanParsed` 按文件状态缓存解析结果（记录、记忆、原文笔记、项目状态、时区），版本列表按 HEAD 缓存；总览与状态摘要先按时间粗筛再换算当地日期。大工作区上今天页 855 → 约 120 ms，开始使用状态 405 → 约 95 ms。缓存里的记录已冻结；要改项目请用 `readProject`，它每次读新的。实测见 [交审说明](acceptance/north-star-p0-2026-10-16.md)。
- 品牌色由深青换为朱砂（用户反馈「AI 绿」审美疲劳），只改颜色：主按钮、链接、问问底色、开图与地图、标志与桌面图标底块；状态文字改中性色。见 [配色验收](acceptance/palette-cinnabar-2026-10-16/README.md)。

### 2026-10-16：北极星首批（P0 四项 + 英文 + 坚果云）

- 用户采用新北极星与「每周推进人数」，只在 PRODUCT.md 保留一份；GOAL.md、PRD §0、§13 改为引用。launch 加 L10（英文）、L11（坚果云）与 §9 第 6–8 项。
- 搬进来就看得见：搬记忆预览里目标、项目、在考虑的事一屏确认后进 goals.json、项目和方向；今天页新增「你带来的规划」，每个目标可定下一步、记结果；个人档案目标在先。来源写在目标 id（`<来源>-<日期>-<摘要>`）和待办 notes 的 `目标编号：`，未改 PRD §6 与 schemas。
- 剪贴板协议（`handover.ts`）：整理提示词 → 任意 AI → 贴回解析成草稿；方向页同样可贴回待采纳建议；「AI 与连接」的资料包（L3.1）可勾选、修改后复制，排除健康、财务、敏感记忆、密钥与路径。
- 状态如实：没开每日整理时只显示「已保存 N 条原文」，已采纳的原文归档。
- 英文：本机 `preferences.json` 记界面语言，首次按已有资料与系统语言定一次；首次价值路径的页面、提示词与解析已双语，其余页面见 L10 第二批。
- 坚果云：`kaitu sync enable nutstore`、设置页「同步方式」；通用冲突副本不进版本，坚果云专有命名真机核对后再补（§6）。
- 新增 4 个行为测试（坚果云迁移往返、搬入路由与规划、剪贴板解析与采纳、资料包范围与方向贴回）。中英文浏览器走查与大工作区实测见 [交审说明](acceptance/north-star-p0-2026-10-16.md)。

### 2026-10-15：财务 P0（数据层与 dsh Host）

- 新增 finance 四类记录、原币定点计算、支付宝 / 券商 CSV 预览提交与幂等对账；旧工作区通过 upgrade 补齐。
- 四个财务视图携带记录 ID、统计区间与缺失原因；独立 kaituFinance Remote 提供四视图及预览 / 提交 / 放弃。
- MCP remote 的 record_list / read_file 屏蔽财务明细；原件只留本机状态目录，提交或放弃后删除。
- 说明见 [finance.md](finance.md)。

- dsh 插件：四工具、提示注入、`kaitu dsh [--install]`；桌面应用 0.2.0-rc.2 中真实对话写入已实测，见 [dsh.md](dsh.md)。

### 2026-10-15：M5 第一部分——手机通道

- `@kaitu/channels` 实现四通道文本收发、一次性本人配对、按会话排队的本机 Agent 与 CLI / `ui --channels`；凭据、配对及会话留本机。操作见 [channels.md](channels.md)。
- 微信抽取 `@tencent-weixin/openclaw-weixin@2.4.10`，保留 LICENSE 与差异说明，无新增外部依赖；四项检查全过（99 项）。
  假 Codex resume / CLI / 本地工作台冒烟通过；四平台真实登录、收发与 Codex 续会话待实测，DSH 未开始。

### 2026-10-15：工作区升级与健康收件箱

- 快捷指令 iCloud 链接（3e47eb2c…）已填入安装页。重新分享前：清空「文本」动作与导入问题的「默认回答」——默认回答会随链接一起分享，曾因此泄露密钥（已轮换）。分享后在 Mac 打开链接核对无密钥。
- 健康同步改为一页三步安装：Apps Script 自动生成密钥，仅本人设置页显示同步地址与收件状态，`showSyncUrl()` 供编辑器备用；个人 Gmail 身份识别待实测。
- 改 `.gs` 后运行 `pnpm guide:health` 更新安装页内嵌代码，一项一致性测试防遗漏。
- 快捷指令新增换行字符串并列列表（type / values / starts），与 samples 数组并存；复用健康映射，支持每日累计更新、分类型活动合并与中文睡眠阶段。
- 并列列长不一致时整文件附原因转待整理笔记；格式见 `docs/guides/health-shortcut-format.md`。
- `kaitu upgrade [--dry-run]` 按模板哈希升级：补内置模块与新增 records / views / sources / tabs，保留用户字段与自建技能。
- 两处内置技能覆盖更新，重新生成 AGENTS / AGENT-README / OVERVIEW；整次升级一个版本，随后 validate 与 doctor。当前版本重复运行不写入。
- 初始化记录 template_version；旧模板在 doctor 与工作台提示升级，预览不执行工作区迁移或维护写入。
- `inbox/health/` 支持官方 export.zip / export.xml 和快捷指令 *.health.json，工作台自动处理或 inbox process 手动处理。
- 两种入口共用样本映射：单位、来源聚合、跨午夜分摊与睡眠合并保持一致；Apple 体能训练均记 cardio，中文活动名，力量组次仍手记。
- 健康原件成功归档且不进版本历史，失败转附件笔记；整理记录按自然键追加修订，重复投递不存新版本。
- 合成旧模板与健康文件测试已覆盖升级保留、幂等、时区与跨夜、文件稳定、工作台自动 zip 导入。build、typecheck、lint、test 全过（94 项）；测试并发上限 4，保留原超时时间。
- 构建后 CLI 临时工作区冒烟通过：旧 .git 历史保留、预览不迁移、整次升级一个版本、重复升级 / 导入无改动。
- 快捷指令原始格式见 docs/guides/health-shortcut-format.md；实际 iPhone 快捷指令与真实 Drive 同步仍待实测。

### 2026-10-15：项目模块（D21）

- core / CLI 支持项目建档、链接、日志与阶段，工作台「我的」与「今天」汇总项目和下一步。
- 正文与普通仓库只读；字数按天修订，提交按作者日期同步已结束的日期，首次回看最近 7 天；只保存计数与最多 10 条、80 字的标题。
- build、typecheck、lint、test 全过（80 项，仅新增 3 项）；临时 CLI / sample、工作台接口与 MCP 冒烟通过。真实 Drive、真实链接目录、浏览器与完整 Agent 工作流待实测。


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

### 2026-10-15：M2 本地工作台

- `kaitu ui [--port 4870] [--no-open] [--dir 目录]`：只监听 127.0.0.1，提供 web 构建产物与功能接口。
- 页面：今天、健康（4 个子页）、动态、我的；设置提供导入预览 / 确认 / 撤销、ChatGPT 记忆提示词、版本恢复和模块清单。
- 聚合读取、frontmatter 更新与上传暂存都在 core。接口写入串行，写前先保存尚未入版本的外部修改。
- 首选递归 `fs.watch`，300ms 刷新、静默 30 秒自动版本。当前运行环境文件监听报 EMFILE，自动改为每秒检查元数据。
- `init --sample` 复用 examples 与已有导入器，按今天生成近 30 天合成记录、计划、模块状态、简报、记忆与目标。
- 必要测试覆盖 Host / 写请求来源、确认 / 完成的正文与字段保留、外部自动版本 / 接口去重、样例校验。
- 根目录 build 按 core → web → cli 执行。完整电脑操控验收留给 M4，尚未验证 Node 22、其他操作系统和大型导出文件。


### 2026-10-15：状态目录与 Google Drive 模式

- core 统一解析状态目录；版本库改为 `history.git` 并传独立 gitdir，打开旧工作区自动迁移 `.git`，保留完整历史。
- `drive enable/disable/status` 与设置页完成；个人数据进入本地 Drive 同步目录，版本、密钥、索引与暂存留在本机，迁移后检查。
- 自动维护 `AGENT-README.md`、`OVERVIEW.md`；收件箱支持简报、记录、记忆、建议，稳定后校验，每份一个来源版本并归档。
- 必要测试覆盖迁移恢复、只读版本库降级、Drive 往返、收件箱与 OVERVIEW 防循环；真实 Drive、云端连接器和跨系统运行待实测。

## 9. 用户偏好（从讨论中总结）

- 能用成熟开源方案就不自己做，商品化的功能（饮食识别、健康数据接入）直接对接。
- 先做出来再考虑品牌、授权、发布。
- 首页要少，人只看有进度、需要看的东西。
- 用户本人已经把很多信息告诉过 ChatGPT，导入 ChatGPT 记忆是第一优先。
- 用户自己维护 BriefLoop，熟悉多运行时、Pi 引擎、ACP，可以直接讨论技术细节。

---

## 10. 仍待用户裁决

1. ~~仓库许可证~~：已定为 **MIT**；npm 包名 **`rensheng-kaitu`**（命令行仍为 `kaitu`）。裸名 `kaitu` 与 `@kaitu` scope 已被他人占用。
2. 目标用户以国内为主还是海外：影响默认模型预置、健康设备支持（华为、小米）。
3. 记忆自动提取用主模型，还是单独配置一个便宜的小模型。
4. 访谈逐字稿是否从 git 历史中彻底清除（需改写历史并强推）。


### 2026-10-15：体态照片、M3 实现与 MCP

- 照片由 core 按文件头识别 JPEG / PNG / WebP，macOS HEIC 调用系统 sips 转 JPEG；原件和 photo 记录一起进历史。
  CLI 与身体指标页支持添加、删除，工作台提供日期对比；图片接口只按记录 id 读取，上传限制 25MB。
- 16 个技能正本在模板 `.agents/skills/`，init / agents-md 同时复制到 `.claude/skills/`，两处均进历史。
  AGENTS.md 补齐日常节奏、技能、工作台和 MCP。status 汇总今天和最近 7 天；memory import 整批一个版本。
  训练次数按日期与 session_id 去重；睡眠按醒来日、蛋白质按记录日先汇总，均只平均有记录的日期。
- MCP 使用 SDK：stdio 默认 all，HTTP 默认 remote，只监听 127.0.0.1，Bearer token 与 Host 校验。
  HTTP 每会话独立绑定 initialize 的客户端名，所有写操作串行，版本说明带 MCP 来源。
  token 权限 600，轮换后后续请求立即拒绝旧值；不内置隧道，接入方法见 remote-agents.md。
- 必要自动测试覆盖照片与读取范围、整批记忆恢复、sample status、SDK stdio 调用和 HTTP 认证。
  Codex 技能发现实测受当前执行环境权限限制，详见 §6；不把技能结构校验当成实际 Agent 工作流验收。

- 本轮最终检查：`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过（73 项，新增 7 项必要用例）。
  另用 SDK HTTP 客户端冒烟调用 all 集合的 15 个工具，核对客户端来源版本、token 权限及双目录技能进历史。
  浏览器看到照片墙、上传和对比入口；浏览器未授予上传文件权限，界面上传 / 双日期切换 / 删除闭环未完成。
  HEIC 的真实文件转换、Grok Bot / ChatGPT Dots、公网隧道与 PRD §10 的完整 Agent 行为验收未验证。

### 2026-10-15：实测结论（Claude）

- **Codex 技能目录已核实**：在 `kaitu init` 生成的工作区里运行 `codex exec`，16 个开图技能（`.agents/skills/`）全部被识别，并成功按 log-workout 技能记录了训练。
- **Codex 沙箱会把 `.git` 设为只读**：Codex 调 `kaitu` 时记录能写入，但版本保存报 `EPERM`。解决：版本库改存到状态目录（本地模式 `.kaitu/history.git`，Drive 模式在本机状态目录），与 `docs/drive-sync.md` 一并实现。

