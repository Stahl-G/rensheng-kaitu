# 交接：用户试用 Kaitu.app 的 8 条反馈（2026-10-16）

试用版本：main `b4e3cc0` 打包的 Kaitu.app。下面每条写了现象、已查到的原因、要做的和验收。
先读 AGENTS.md、docs/PRODUCT.md、docs/prd/launch.md，再动手。

## 约定（必须遵守）

- 测试只用临时目录和合成数据。不碰用户真实工作区
  （`~/Library/CloudStorage/GoogleDrive-…/我的云端硬盘/kaitu`）、`~/.kaitu-app`、
  `~/Library/Application Support/kaitu/current-workspace.json`、真实 iCloud。
  vitest 已经通过 `test/isolate-home.ts` 隔离 HOME，不要绕过。
- PRD §6 数据规范要改时，先停下给用户确认，再同步 `schemas/` 和 `packages/core/src/agents-md.ts`。
  目前已知只有第 7c 条会碰到。
- 不替用户填任何 Key、Token、密码。不使用 Computer Use；界面用 `kaitu ui --dir <临时工作区>` 加浏览器截图验证。
- 每个提交前 `pnpm build && pnpm typecheck && pnpm lint && pnpm test` 逐项通过，要看每条命令的退出码。
- 最多加必要的行为测试；不写文案匹配、快照；不加免责声明和没用的注释；不整文件重排格式；不提交测试日志。
- 避免 AGPL/GPL 依赖；移植 Apache-2.0/MIT 代码要保留版权头，并登记到 THIRD_PARTY_NOTICES.md。
- 提交信息不加署名行。

## 1. 应用名统一为「人生开图」

现在有三个名字：访达/程序坞里是 Kaitu.app，窗口标题是「开图」，页面左上角是「人生开图」。
- 改 `packages/desktop/package-kaitu.mjs` 里的 CFBundleName / CFBundleDisplayName，以及窗口标题和关于页。
- bundle id `ai.kaitu.app` 保持不变，否则日历自动化授权和本机状态都会失效。
- `.app` 文件名能否用中文，要先实测签名、公证和 DMG；不行就保留 `Kaitu.app` 文件名，只改显示名。

## 2. 项目卡片补回 GitHub，并修卡片显示

- 后端已经支持：`packages/core/src/github.ts`、`projects.ts`（STATUS 里写 `github: { repo }`）。
  旧版 `DoingPage.tsx` 有 GitHub 卡片，V2 项目卡片既没有绑定入口，也不显示这些数据。
- 要做：卡片和详情页里提供「绑定 GitHub 仓库」（填 owner/repo，校验后写回）；显示 CI、最新版本、未处理的 Issue/PR、最近推送。
- 顺带修：
  - 日志里的 `<!-- sync:words -->`、`<!-- sync:commits -->` 注释漏到了界面上，要去掉；
  - 一整串提交标题铺开太长，只显示条数和最近 1–2 条，其余放进详情；
  - 「仓库」两个字被挤成两行；
  - 「下一步」全部显示「暂无记录」，要核对是确实没有数据，还是没读到。

## 3. 开图 → 方向是空的，没有入口让 AI 推荐

- 后端允许 AI 提议方向：用 `exploration_write`，先标 `suggested`，用户采纳后变成 `active`，见 AGENTS.md 生成模板。
  但界面上没有任何地方会触发它。
- 要做：方向页加「让 AI 推荐方向」，根据目标、记忆、足迹、资讯给出 2–3 个 suggested 方向，
  每个附「为什么适合你、还有哪些不清楚、一个低成本的小实验」，用户采纳一个才生效。
  定时整理时也可以提议，但同样只进 suggested。
- 没连接 AI 时，给出去连接的入口。

## 4. 资讯卡片不显示图片

- `packages/dsh-plugin/src/client/NewsPage.tsx` 的 `card()` 把缩略图写死成色块加「文章」，没有用 `item.image`。
  用户的 34 条资讯里有 17 条带图。
- 要做：用 `NewsContent.tsx` 里现成的 `NewsImage`（只放行 http/https、no-referrer、加载失败回落色块）。
- Electron 包里的 CSP 要确认允许 `img-src https:`；`kaitu ui` 那边已经允许。

## 5. 财务：没有账户时导入卡死

- `FinancePage.tsx:379` 没有账户时只提示「先在对话里说：帮我建一个支付宝账户」，顶部「导入账单」按钮是灰的。
- 要做：
  - 直接选文件就能导入。按文件格式自动识别支付宝、微信、券商持仓，没有账户就自动建一个；
  - 预览里可以改账户名、改选已有账户，确认后才写入；
  - 沿用 docs/finance.md 现有的预览、确认、去重规则。
- 财务后端是自研的，没有接开源财务引擎。想扩充账单格式（微信、各家银行），可以参考
  [double-entry-generator](https://github.com/deb-sig/double-entry-generator)（Apache-2.0）的解析规则。
  这一项可选，先把导入跑通。

## 6. 手机通道（微信扫码 / QQ / Telegram / 飞书）没有 App 界面

- 代码在 `packages/channels/src/`：weixin 来自腾讯官方 openclaw-weixin（MIT），支持扫码登录；另有 qq.ts、telegram.ts、feishu.ts。
  目前只能用命令行 `kaitu channels setup|pair|start|status`，见 docs/phone-channels.md。
  App 里的「邮件与聊天」只是收件箱采集器，是另一套功能。
- 要做：
  - 在「AI 与连接」加一节「在手机上和开图聊」，每个通道一张卡：未配置 / 待配对 / 已连接 / 出错；
  - 微信在界面里直接显示二维码（`weixin/login.ts` 的 `display` 回调拿到登录链接，生成二维码图片）；
  - 配对码显示在界面上；App 运行时在后台常驻通道，退出时停止。
- 回复后端：现在 `channels/src/agent.ts` 默认调 Codex CLI，要改为使用问问已连接的模型，权限同问问默认模式。
  没连接时，通道回复「请先在电脑上的开图里连接 AI」。

## 7. 在做的事：量化进度、详情页、Agent 自定义视图

- a. 进度为空：`progress` 是项目 STATUS frontmatter 里的 `{current, target}`，没人设置；自动指标只有 words 和 commits 两种。
  要做：建项目或整理时，由 AI 提议一个可量化的目标（字数、版本、次数），用户确认后写入，进度按指标自动计算。
- b. 项目卡片要能点开详情页：目标、下一步、进度曲线、最近日志、GitHub、来源。现在只有底部一个「项目详情与来源工具」链接。
- c. Agent 自定义项目视图（用户希望每个人的项目长得不一样）：
  - 推荐积木式视图：agent 为每个项目写一份 view 文件，从固定积木里组合（进度条、指标曲线、清单、里程碑、链接、备注、表格），App 用统一样式渲染，写错的积木跳过不显示；
  - HTML 沙箱作为后备：iframe sandbox，不能联网，碰不到开图接口。
  - **新增 view 文件属于 PRD §6 变更，先把文件格式给用户确认**，再同步 schemas 与 AGENTS.md 生成器，并提供 MCP 读写工具。

## 8. 资料各页打开慢，重进又重新加载（连「个人档案」也慢）

- 前端没有任何缓存：每页挂载时 `refresh()`，离开就卸载。工作区在 Google Drive 的 CloudStorage 目录。
- **已测**：在用户真实工作区上只读调用 `readMe`，约 15 ms（60 条记忆）。所以「个人档案」慢不在读文件，
  而在请求链路：RPC 排队、被别的长任务阻塞事件循环（同步读云盘、GitHub/行情同步、整理任务、`this.write` 锁等），
  或者每次重建运行时。先在打包的 App 里给每个 Remote 调用记录排队时间和执行时间，找到真正卡住的地方。
- 要做：
  - 前端统一数据缓存：先显示上次结果，后台刷新（stale-while-revalidate），切页不丢；
  - 启动后空闲时预取资料各页；
  - 后端用内存索引，由现有文件监听按变更失效；
  - 把长任务移出请求路径（worker 或异步），不阻塞界面请求。
- 验收：第二次打开同一页 <100 ms 出内容；第一次打开先出骨架，<1 s 出数据。
  拿合成的大工作区实测，并在交审说明里给出前后计时。

## 交付

- 按条分支或分提交，每条附交审说明（docs/acceptance/），写清现象、原因、改动、截图（浅色/深色/窄屏）和手动验证步骤。
- 不推送、不合并，交回审查。全部合并后，再用 `node packages/desktop/package-kaitu.mjs '/Applications/DeepSeek Harness.app' --output <新目录>/Kaitu.app` 重新打包给用户试用。
