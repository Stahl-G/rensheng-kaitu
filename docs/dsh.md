# 用 DeepSeek Harness 对话记录开图

推荐用 DeepSeek Harness 桌面应用（0.2.1-rc.1）：

1. 安装并打开一次桌面应用，在 **设置 → 模型** 配好模型（DeepSeek、opencode-go 或其他 API Key）。
2. 在开图仓库运行 `pnpm build`，然后：

   ```sh
   kaitu dsh --install
   ```

   它把开图插件写进 `~/.dsh/profiles/desktop/cordis.patch.yml`（只维护 `# kaitu:start` 到 `# kaitu:end` 这一段，重复运行会替换）。
3. 退出并重新打开桌面应用，点 **新会话**，说「今天深蹲 3×12 60kg」。
4. 在 dsh 侧栏「开图 → 健康」查看记录；在对话中查询版本。无需另开工作台。

## 不用桌面应用：网页版

1. 安装 Node.js 22.19 以上的 22.x，或 Node.js 24 及以上版本。在开图仓库运行：

   ```sh
   pnpm build
   ```

2. 生成本机插件配置（首次使用会自动初始化工作区）：

   ```sh
   node packages/cli/dist/main.js dsh
   ```

   已配置 `kaitu` 命令时可直接运行 `kaitu dsh`。
   非默认工作区加 `--dir /你的/工作区`，也可设置 `KAITU_DIR`。
   命令只生成状态目录内的 `cache/dsh/cordis.yml`，输出一行启动命令：

   ```sh
   npx @deepseek-ai/dsh@0.2.1-rc.1 web --patch '/本机状态目录/cache/dsh/cordis.yml'
   ```

3. 复制实际输出的命令运行。首次运行 npx 需要联网下载 dsh。
   打开终端给出的本机地址，在 **设置 → 模型 → DeepSeek 卡片** 输入 API 密钥并保存，然后在模型选择器选 DeepSeek 模型。
   操作依据 dsh 的 `docs/user/guide/providers.zh.md`。密钥由 dsh 管理，不填进开图 patch。

4. 在 dsh 对话框输入「今天深蹲 3×12，60kg」。Agent 先查看现状和字段规范，能估算的（份量、热量）直接估算并说明假设，不追问。
   写入成功后，在侧栏「开图 → 健康」查看记录，在对话里查询版本。
   还可以说「校验一下工作区」或「看最近 5 个版本」。

插件注册技能 provider、说明、工作流工具和开图页面。补记时间用带时区偏移的 `ts`。
手动配置参见 [cordis.example.yml](../packages/dsh-plugin/cordis.example.yml)，插件路径必须填 `dist/index.js` 的绝对路径。

当前按 dsh `0.2.1-rc.1` 源码与同版 npm 类型实现。
对话工具沿用 `tools.register()` 和 `systemPrompt.section()`；总览通过严格生成的 Remote 和 Slots 接入。
已有桌面对话写入结果见 [HANDOFF §0.1](HANDOFF.md#01-现在能用什么均已真机实测)。

## 装上即可用

这里的安装入口是 `kaitu dsh --install`：安装时一次写入桌面 profile，之后打开 dsh 即自动就位。
插件自身不依赖会话 cwd，也不要求运行 `kaitu ui`、CLI、MCP 或手工建立技能链接。
自动收件箱、对话写入与会生成版本的页面操作共用写入队列，避免并行导入时吞掉另一项操作的版本。
首次挂载默认创建 `defaultRoot()` 工作区（采用本机时区）；已有工作区自动执行 core upgrade，保留用户配置与自建技能。
显式 `config.workspace` 优先；非空且未初始化的目录按 core 的保护规则拒绝覆盖。

| 能力 | 状态 | 自动行为 / 依据 |
|---|---|---|
| 全部工作区技能 | 已在本次补上 | host 注册 `kaitu-workspace` provider，读取 `.agents/skills/*/SKILL.md`，与会话 cwd 无关；每秒检查外部文件变化并 invalidate，正文每次加载重新读取 |
| 收件箱自动处理 | 现在可用 | `inbox-loop.ts` 在启动、文件变化后及每分钟调用 core processInbox；不用另开工作台 |
| Agent 说明 | 已在本次补上 | 全局 system prompt 注入写入与确认规则、读取顺序和 CLI → 工具映射；档案与规则通过工具读取，避免把整个私有工作区塞入所有会话 |
| 记录与查询 | 已在本次补上 | 保留原工具，补记录查询 / 修订、对话检索、记忆、待办、项目、导入、文档读写、照片和地点查询；全部复用 core |
| 每日整理、早间计划 | 已在本次补上 | 复用 DSH 内置的 schedule 与其界面；首次启动创建专用持久会话及 03:00 每日整理、07:30 早间计划，使用工作区当时时区；回执存本机 `.kaitu/dsh-setup.json`，重启保留用户对任务的修改和删除 |
| 头像 | 现在可用 | 「关于我」选择文件，经 Remote 存入本机状态目录；不依赖会话目录或 CLI |
| 本机文件 | 已在本次补上 | 文档读写限定开图工作区；导入与体态照片支持用户指定的本机绝对路径，项目链接目录只读 |
| 云端入口 AGENT-README / ORGANIZER | 已在本次补上 | 初始化、升级与 core refreshOverview 自动生成 / 维护，同时生成 OVERVIEW；不依赖用户启动其他程序 |
| Drive 开关与迁移 | 已在本次补上 | 对话调用 core enableDrive / disableDrive，页面、工具与 provider 共用同一 Workspace；重启跟随 core 的 WORKSPACE-MOVED 入口 |
| 模型密钥、外部账号与云端 Agent 授权 | 做不到自动代填 | 密钥与授权属于用户，模型在 dsh 设置填写；Drive 需要用户已安装并登录自己的同步客户端，云端连接器仍需本人授权 |
| dsh 关闭时执行任务、没有模型时生成内容 | 做不到 | 0.2.1-rc.1 schedule 是 Host 内的计时与会话 follow-up；应用关闭没有进程执行，生成内容使用 dsh 配置的模型 |
| 抓取任意联网来源、体检 PDF 的 OCR | 做不到保证所有模型都具备 | daily-feed 依赖会话的联网工具或用户提供正文，lab-import 依赖模型能读附件或用户提供指标；core 没有通用抓取器 / OCR 引擎 |

### 注册层级与安装依据（dsh 0.2.1-rc.1）

以下路径相对于只读参考仓库 `deepseek-harness-rc2`：

- `packages/skill/skill/src/index.ts` 的 `SkillRegistry.registerProvider()` 按调用 context 的 scope 注册，
  host 在 global 层，会话读取 global + 自身 scope chain。开图安装为顶层插件，因此不需要把 provider 塞进各个 preset。
- `packages/bundle/web-app/cordis.patch.yml:475` 明确保留 host skill 注册表，仅禁用默认 host filesystem provider。
  `presets/{standard,ptc,cordis}.patch.yml` 各自挂载 filesystem 与 tool-skill；minimal 未挂载 tool-skill。
  安装 patch 重新启用 base 的 host tool-skill，保证 minimal 也有目录与加载器。
  `packages/skill/tool-skill/src/index.ts` 仅在自己的精确工具注册对当前 Agent 可见时发布目录，
  所以 standard 等 preset 的同名 scoped 工具覆盖 host 工具后，不会重复发布目录。
- `packages/skill/skill-filesystem/{README.md,src/index.ts}` 采用 frontmatter 提供摘要、get 时重读正文、外部更新 invalidate。
  开图 provider 沿用 name / description、调用权限、whenToUse、metadata、resourceBase 语义，使用 core 的 YAML 解析。
  同名技能遵守 dsh 的 scope 优先级，当前会话显式定义的同名技能仍可覆盖 host 技能。
- `packages/bundle/web-app/cordis.patch.yml` 已内置 schedule 与 ui-schedule，桌面 profile 同样使用这个 bundle。
  开图安装器直接复用宿主，不再追加旧版本的定时任务包；自定义 host 需自行提供这两个服务。
- `packages/schedule/schedule/src/index.ts` 的 create 绑定原 sessionId，runtime.ts 用 resolveAgent → followup → sessions.flush 投递。
  开图通过公开 sessionController.create / resolveAgent 创建并保存专用会话，再调用 schedule.create，不自行写 dsh 的任务数据库。
  初始化失败会记录 Host 日志并每分钟重试；已完成的初始化不在重启时重建用户删除的任务。

### 18 个内置技能的 dsh 执行入口

技能正文加载时附带工具映射，原始通用技能仍适用于 Codex / Claude Code。

| 技能 | dsh 步骤所用工具 |
|---|---|
| onboarding | status、workspace 读取 / 写档案、memory、drive；页面直接用侧栏「开图」 |
| import-chatgpt-memory | memory list / import（预览、确认后整批写入） |
| morning-plan | status、tasks、records、projects、workspace 读写 NOW；建议保持待确认 |
| evening-review | projects sync、inbox、tasks、records、memory、workspace 写状态与日报 |
| weekly-review / monthly-review | records、search_chats、photos、projects、workspace 写复盘 |
| look-back | records、search_chats、workspace 读证据 / 写回看 |
| log-workout / log-meal | status 查字段、records 查询 / 修订、add_record 写入 |
| health-import | import 支持 Apple Health、Nut AI、ICS、ChatGPT 对话，默认 dryRun |
| lab-import | 会话读取附件后，workspace 一次写报告 JSON 并按现有 schema 校验 |
| daily-feed | 会话读取来源，workspace 读写简报；缺来源时使用用户提供的正文 |
| learn-topic / decision | search_chats、workspace 创建主题 / 决策文档与状态 |
| add-module | workspace 批量写 module.json / STATUS / schema，校验成功后刷新 Agent 入口 |
| log-photo | photos 保存原件 / 查询 / 删除；健康页读取已有照片 |
| project | projects 建档 / 链接 / 同步 / 日志 / 设置；project-read / project-write |
| build-life-map | memory、search_chats、workspace 读档案，add_experience；life_map 查地点候选和结果 |

新增自动测试仅一项：临时工作区技能跨 cwd 发现、加载正文、外部更新刷新及卸载停止监听。
离线冒烟使用 rc.2 的真实 SkillRegistry / ToolRuntime，确认无关 cwd 可发现 18 个技能、加载 build-life-map，
并完成记录查询、记忆预览及带版本回执的记录 / 文档写入。
完整检查中同时修复：上午项目字数被未来的中午时间戳隐藏、午夜后的旧计划变化未进入接力摘要、
GitHub 内容未变仍生成同步版本。dsh 初始化回执列入本机状态的历史排除项。

## 总览页

构建后运行 `kaitu dsh --install`，退出并重新打开桌面应用，侧栏点「开图」即可查看总览。
页面与对话工具使用同一个插件、同一个工作区；网页版同样在 `kaitu dsh` 生成的配置中加载。

总览显示最近 10 个有意义的改动版本、最新每日整理与未决事项、今天的安排、各模块未完成的前 5 条下一步、活跃项目、健康指标和待整理笔记。
点击行可展开对应记录或文件路径；「刷新」重新读取工作区，「问问开图」返回当前对话。
建议在本页标为待确认，回到对话处理。新工作区显示导入记忆、健康设置与去对话的引导。

健康统计按工作区时区覆盖今天及前 6 天，截止于本次查询时间；睡眠与蛋白质只对有记录日期取日均。
估算数据标「约」，缺失指标显示「暂无记录」，最新体重单独注明测量日期。
项目没有同步提交记录时显示「暂无记录」。版本来源按已有提交说明识别，无法识别来源时留空。维护类版本不在总览显示，完整历史仍保留。
页面顶部提供「今天、健康、在做的事、资讯、关于我」板块，收起状态保存在 localStorage；当前「今天」有内容，其余显示建设中提示。
健康卡片使用 7 天训练方块、睡眠柱图与目标线、蛋白质进度和估算斜纹；缺失睡眠保留虚线框，体重缺失时可点「记一次」去对话。
目标来自 me/rules.md 的作息和营养规则；每天的缺失值为 null，真实零值保留。项目柱图使用每日字数增量或提交数，浅紫槽固定高度。
「需要你处理」仅显示非零项目，全零时隐藏。页面使用局部 `--kt-*` 配色，跟随 dsh 的明暗主题。

## Kaitu 品牌与入口

`kaitu dsh --install` 现在把品牌替换与入口开关一起写入 `# kaitu:start…end`，重复安装只替换该段，保留前后的用户配置。
默认空 profile 的 `[]` 保留，将托管段插入方括号内；网页版 `kaitu dsh` 使用同一组开关。
不另建品牌包：`@kaitu/dsh-plugin/client` 占据 `sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`。
标志取自 [kaitu-mark.svg](design/kaitu-mark.svg)，轮廓用 currentColor，中心点浅色为 `#3D6FE0`、深色为 `#7FA2F0`，名称为 Kaitu。
「开图」导航图标复用同一组件。

`sidebar.footer.action` 在设置上方显示 `Powered by DSH <版本号>`，收起侧栏时显示 DSH，悬停可读完整文字。
版本通过 `kaitu.dshVersion` Remote 从运行 Host 的 `DSH_CLIENT_VERSION` 读取；桌面启动器负责传入已安装应用的版本，
依据 `apps/desktop/src/main.ts:445`，不使用插件版本或 CLI 锁定版本。缺少版本元数据的自定义 Host 仅显示 Powered by DSH。

### 0.2.1-rc.1 入口清单与处理

下表源码路径相对于本机只读源码 `/Users/yihongguo/Developer/deepseek-harness-rc2`。
插件名简写为组合中的 id，通常对应 `@deepseek-ai/dsh-client-<id>`；当前 profile 是否组合实验包决定其入口是否出现。

| 位置 / 入口 | 来源插件与源码 | 建议与本次处理 |
|---|---|---|
| 侧栏品牌、新会话、展开 / 收起；macOS 收起后的顶栏同类按钮 | `ui-sidebar`，`packages/client/ui-sidebar/src/client/{index.ts,SidebarRoot.tsx,HeaderLeadingControls.tsx}` | 保留，替换品牌 |
| 侧栏「开图」 | `@kaitu/dsh-plugin`，本仓库 `packages/dsh-plugin/src/client/index.tsx` | 保留，换为六边形标志 |
| 侧栏插件市场 / 插件页 | `ui-plugin-manager`，`packages/client/ui-plugin-manager/src/client/index.ts:139` | 保留（用户要求） |
| 侧栏「自动化任务」、顶栏任务目录、右栏任务详情 | `ui-schedule`（实验 schedule bundle），`packages/client/ui-schedule/src/client/index.ts:178`、`:210` | 保留，供早间计划与晚间复盘使用 |
| 侧栏会话搜索、分组 / 排序 / 已归档过滤、会话列表、置顶 / 重命名 / 分支 / 归档 | `ui-workspace`，`packages/client/ui-workspace/src/client/index.ts:260`、`:285` | 保留 |
| 侧栏添加、重命名、删除、拖动工作区；首屏工作区选择 | 同一个 `ui-workspace`，`src/client/rows/WorkspaceBrowser.tsx` | 无独立开关；与列表、导航共存，留打包时替换呈现 |
| 工作区目录选择对话框 | `directory-picker` 自动选择 native / browse，`packages/host/directory-picker-auto/src/index.ts` | 保留，`ui-workspace` 必需依赖 `remote.directoryPicker` |
| 侧栏底部动态插件 / Cordis 面板 | `ui-cordis`，`packages/extensions/ui-cordis/src/client/index.ts:86` | 保留（用户要求） |
| 侧栏「设置」 | `ui-settings-general`，`packages/client/ui-settings-general/src/client/index.ts:175`；区段契约由 `ui-settings` 提供 | 保留通用、外观、语言、模型等设置 |
| 设置中的内置插件区与清单 | `ui-settings-plugins`、`ui-settings-plugin-inventory` | 保留（用户要求） |
| 设置账号 / 登录、额度提示与账号引导 | `ui-settings-account`，`packages/client/ui-settings-account/src/client/index.ts` | patch 只禁用界面；三个账号后端保留，桌面欢迎页启动时要查询登录状态（`apps/desktop/src/welcome-backend.ts:117`），禁用会导致应用无法启动 |
| 设置日志上传 | `ui-settings-session-log`，`packages/client/ui-settings-session-log/src/client/index.ts:36` | patch 禁用 |
| 顶栏会话标题、祖先会话跳转、对话视图页签 | `ui-conversation`，`packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx` | 保留 |
| 顶栏子 Agent 目录与谱系菜单 | `ui-subagent`，`packages/client/ui-subagent/src/client/index.ts:76` | patch 禁用界面 |
| 顶栏 Agent preset 标签、首屏 preset 选择、通用设置 preset 行 | `ui-agent-preset`，`packages/client/ui-agent-preset/src/client/index.ts:183` | patch 禁用界面，运行时 preset 注册表仍保留 |
| 顶栏 Team 菜单 | 实验 `ui-agent-team`，`packages/experimental/client-ui-agent-team/src/client/mount.ts` | 默认 desktop 未组合，无需 patch；开图打包不组合 agent-team-profile |
| 顶栏后台任务 | `ui-jobs`，`packages/client/ui-jobs/src/client/index.ts:38` | 保留，用于观察正在运行的任务 |
| 顶栏「Open In…」 | `ui-open-in-app`，`packages/client/ui-open-in-app/src/client/index.ts:103` | patch 禁用界面 |
| 原生应用菜单（关于、检查更新、管理 dsh 命令、隐藏 / 退出）、编辑菜单；macOS 文件 / 窗口菜单 | 桌面主进程与 preload，`apps/desktop/src/main.ts:939`、`preload-menu.ts` | 主进程固定，profile 无法改；打包修改品牌与更新渠道 |
| 顶栏右栏展开 / 收起，右栏新增页签及引导页 | `ui-sidebar-right`，`packages/client/ui-sidebar-right/src/client/index.ts:238` | 保留文档预览容器 |
| 右栏终端、浏览器、工作区文件树 | `ui-sidebar-terminal`、`ui-sidebar-browser`、`ui-sidebar-files` | patch 禁用这三个界面插件 |
| 右栏文档预览 | `ui-sidebar-documentpreview` | 保留 |
| 产品埋点、桌面遥测、会话遥测 | `product-analytics`、`desktop-product-telemetry`、`session-telemetry-otel` | 没有独立侧栏入口，patch 禁用三者；上传日志入口另见上表 |

### patch 能力与官方品牌

用户 patch 在 bundle 之后合成（`packages/boot/app-boot/src/profile.ts:7`）。`insert` 追加插件或组内条目，按 id 的覆盖可设置
`disabled: true` 或替换整个 config；config 不深合并，name 只校验原插件名。此 patch 方言没有 remove 操作，不能把 Loader 的
`EntryTree.remove()` 当作 YAML 操作。格式依据 `packages/preset/agent-preset/skills/cordis-composition-reference/SKILL.md`，
实现为 `vendor/include/src/index.ts` 的 `applyEntryPatches` / `PatchOptions`。

本次使用 `- id: ui-brand-official` / `disabled: true`。官方品牌虽有构建时 `official` 条件，但仍是 profile 中的普通插件行
（`packages/bundle/web-app/cordis.patch.yml:318`）；模块扫描明确跳过 disabled 行
（`packages/client/modules/src/index.ts:983`），所以官方桌面构建也可通过本机 profile 撤掉它，无需改 dsh 源码。
三个插槽声明与官方注册分别见 `packages/client/ui-sidebar/src/client/index.ts:76`、
`packages/client/ui-conversation/src/client/apply.ts:318`、`packages/client/ui-brand-official/src/client/index.ts:17`。

桌面打包待办：

- 替换 `ui-workspace` 的工作区管理呈现，保留会话列表与 `uiWorkspace` 新会话导航服务。
- 将 `DSH_CLIENT_TITLE` 设为 Kaitu（`packages/client/ui-layout/src/client/AppFrame.tsx:233`）。
- 设置桌面 `productName`、应用图标和安装包资源（`apps/desktop/scripts/electron-builder-config.mjs:109`、`:151`）。
- 修改原生关于面板、菜单和首次启动页的品牌资源，接入开图的更新渠道；它们来自桌面主进程 / preload，
  不受 Cordis profile 控制（`apps/desktop/src/main.ts:930`、`:948`、`src/client/welcome.tsx`）。
- 开图构建不组合实验 agent-team-profile；以上运行时 patch 随开图 profile 组合。

本次 build、typecheck、lint 与 102 项测试通过，包括一个安装段回归测试；另核对隔离临时 profile 的安装与 rc.2 原函数合成、品牌组件输出；未改写本机 desktop profile，未重启真实桌面应用验收。

构建仅使用已安装 npm 包：生成严格 Host/Remote codec，再将浏览器 CJS 封装为 dsh module factory。
0.2.1-rc.1 的生成器只识别工作区中的协议声明，因此构建时在临时目录登记已安装的协议声明，结束后清理；不依赖 dsh 源码目录。
第一版已在 dsh 桌面 rc.2 实测加载成功。
总览设计轮次按两份最终设计稿调整，没有新增依赖、提交或改写桌面 profile。

总览设计轮次验证：build、typecheck、lint、101 项测试通过，仅更新已有 overview 测试，覆盖逐日缺失 null、真实零值、同次训练去重、
睡眠按结束日期归日，以及项目字数增量与提交数。隔离预览使用临时合成工作区与 Preact / Button 渲染适配，
检查了有数据、空状态、板块占位与返回、收起状态刷新保留、明暗配色、缺失睡眠框、体重记录按钮、项目产出槽和 375 像素排版。
维护版本过滤与云端 Agent 名称提取通过实际 core 查询检查；没有新增 UI 测试。

## 开图会话

「问问开图」、总览「需要你处理」、空状态「随口说一句」及板块里的对话入口，统一注册插件 workspace 对应工作区，
再新建并切换到该工作区的会话；引导文字只预填，不自动发送。

0.2.1-rc.1 源码依据：`api/workspace-controller/src/client/service.ts` 的 create({path}) 注册或复用工作区，
`api/session-controller/src/types.ts` 的 SessionCreateRequest 支持 workspaceId 或 cwd（不能同时传），
`client/ui-workspace/src/client/navigation.ts` 的 openSession 维护主会话引用并切换对话面板。
`session-controller` 的 Config 只有 nativeOpen，缺省 cwd 固定取 process.cwd()；
`workspace-controller` 的 documentsDirectory 只影响首次初始化，在其下创建 DSH 子目录。
因此 0.2.1-rc.1 没有可在 `kaitu dsh --install` 品牌 patch 中设置的默认工作区或新会话 cwd 配置，不能用 documentsDirectory 替代。
Kaitu.app profile 与 DSH 插件形态均使用显式工作区入口；DSH 自带「新会话」仍遵循原来的当前/最近工作区规则。

### 0.2.1-rc.1 插件更新

新版 plugin-manager 的 README 与 operations 接口已包含显式 bundle 更新，保留 enabled 选择，必要时要求重启。
开图通过本地路径安装的开发插件仍以本地构建为来源；独立 App 的功能包更新通道保持不变。
反射生成时须同时登记 protocol 与 registry 声明；品牌槽位、会话导航与 schedule 调用结构经新版声明核对保持一致。

补充运行复核：在临时 HOME 与合成工作区运行插件版，确认移除旧版重复 schedule 注册后启动无服务冲突。
