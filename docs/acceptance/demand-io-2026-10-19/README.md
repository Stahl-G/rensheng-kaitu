# 桌面按需 IO 审计与修复

基线：`origin/main e2d9cd8`（已包含 PR56）。开发分支：`codex/desktop-demand-io`。只审计桌面主仓；没有修改 iOS、LearningPage、core learning 或另一位 writer 的工作树。未运行真实账号、个人资料、历史日志或云盘性能采样。未安装依赖、读取 npm 凭据或迁移用户资料。

## 已证实且已修复的路径

设 C 为对话文件数、I 为原文数、R 为记录修订数、A 为附件目录数、B 为 Git 引用数、V/E 为可达提交图节点/边数。

| 用户动作 → 实际路径 | 原行为与规模 | 本次处理 |
| --- | --- | --- |
| 打开桌面 / `kaitu ui` → `Workspace` 构造 → `refreshOverview` → `readStatus/readWorkbench` | UI 服务启动前读取记录、原文和状态；还递归附件树，O(R+I+A) | UI 打开采用 `deferOverview`；保留状态绑定、安全隔离和必要维护，派生现状由现有后台监听刷新。银行通知隔离只进入其实际支持的 agents/notes/processed 范围，避开 health 原件 |
| 今天页 → `OverviewPage.refresh` | 一个 `Promise.all` 等总览、完整资料库、个人页、日历、引导全部完成才 `setData` | 各请求独立更新；资料库只在进入资料页后读取。挂起个人页不会挡住今天页 |
| 资料目录 → `loadLibrary` → `readLibrary` | 读取全部健康/财务、所有主题、全部归档原文，O(R+I) 后才给导航卡片 | 明确 summary/notes/health/inbox 查询；目录导航 0 工作区正文 IO。尚未查询的数量显示“查看资料”，不把未知当作零。未带 query 的旧 API 保持原完整返回，现有桌面客户端全部传明确范围 |
| 收件箱 → `readLibrary` | 全部原文正文、排序、全部 render | 每页 40 条及一条前瞻；按存放日期目录/文件名倒序续读。继续加载可遍历全部原文；来源筛选在服务端续读，必要时扫描到较旧目录，不只过滤第一页。日期目录仅列名字，未进入的旧目录不读正文；单日目录 `readdir/sort` 仍与该层条目数有关 |
| 点开一份决定/学习主题 → `readLibraryDocument` | 重建整个资料库作 membership 判断，然后再读目标，O(R+I) | 只接受原目录页对应的 `learning/<topic>/STATUS.md`、`decisions/<topic>/STATUS.md`，校验范围与链接，读目标一次。无关损坏记录不再阻断详情 |
| 搜索对话 → `searchChats/syncIndex/listChatFiles` | 为列文件名 `scanText` 全部对话正文，再比较索引 mtime/ctime/size；热查询仍 O(全部正文 bytes) | 列路径只检查可用性与冲突；热查询 0 对话正文读取，新增/修改才解析；仍核对 C 份文件元数据以保留外部改写、删除与完整检索语义 |
| 今天/完成下一步/系统日历 → `statusFiles` | 为找 STATUS 递归进入健康附件和月记录目录，O(A) | 只排除已知的 health/files 附件路径、module.json 声明的记录目录；仍发现自建模块任意深度主题 |
| 今天汇总 → `readOverviewPage/summarizeStatus/workoutSessions` | 对同一 ts 在多次投影/7 天分组中反复换算当地日期 | 仅在单次计算中复用已换算日期；不引入跨请求缓存或失效机制，记录修订/时区语义保留 |
| 问问正文 grep → `agentSearch` | 先遍历所有候选到数组（超过 10,000 直接报错），之后才分批 rg | 边遍历边以 128 个文件执行真实 rg；沿用 250 条结果上限，达到上限即停止遍历；候选仍以 10,000 个为范围保护；未达到 250 条也可能因候选上限返回 partial。grep/glob 显式返回 truncated、scannedFiles 和缩小范围说明，不把零匹配或少量匹配冒充全范围完成；保留取消信号 |
| 项目同步 → 每个本地/远端 ref 各 `git.log` | B 份完整祖先历史先返回后再按 oid 去重，重叠祖先重复 IO，最坏 O(B×V) | 从所有 ref 的 head 开始，一次遍历完整可达提交图，每个 oid 读一次，O(B+V+E)。保留 author 日期与时区；作者日期可倒序，不能用日期提前断开祖先 |
| 后台手机资料快照 → `buildPhoneLibrary` → `inboxNotes` | 先读取所有历史原文，再丢弃 30 天外条目 | 先用该投影原本使用的日期目录筛选，再读取正文。未改手机格式、内容范围或 iOS |
| GitHub 后台同步 → `syncWorkspaceBackup/localFiles/githubBackupRemote` | 必要全量扫描/三方合并；界面只有“正在同步” | 保留完整范围、冲突、云占位暂停、并发写保护和 SHA blob 缓存。显示本机读取/远端读取/核对/上传阶段及实际文件计数；可取消本轮本机读、fetch 和 gh 子进程，之后可重试。进度只轮询同步面板，避免每读一个文件就广播全工作区刷新 |

## 逐路径核实后保留的行为

- **系统目录选择**：`local.mjs` 调 Electron `dialog.showOpenDialog(openDirectory/createDirectory)`，Web 调现有原生 picker。`findDriveDirectory` 只读 CloudStorage 账号层和选定账号顶层各一次，不递归账号内容；本仓桌面没有 Google Drive 远端账号全树选择器。
- **文件候选**：已安装的 DSH `WorkspaceFileSearch.list` 对空查询或带 `/` 的查询直接 `listDirectory`，只列当前层；不重复修。无路径的首次模糊搜索须建立路径索引以作完整候选排序，只有路径元数据，最大 50,000 entries、10 秒取消信号；有旧索引时后台刷新。
- **记录聚合**：`readRecords` 仍需跨月份折叠 id/rev 和删除标记，再过滤日期；不能因“最近七天”直接跳过旧月份，跨月修订/改日期会变错。现有 `scanParsed` 按真实文件状态复用解析；没有新增索引一致性框架。
- **版本保存**：UI 原本就 `deferSnapshots` → 定时 `snapshotNow/statusMatrix`；保存结果不阻塞接口。保留完整状态盘点与真实 git，未改 PR56 的虚拟 marker。版本列表已有 HEAD/limit/path 缓存；总览只查最近 100 个提交。
- **文件监听**：优先 recursive fs.watch；事件只调度后台现状/版本/收件箱。事件不可用时 `workspaceFileStamps` 全量元数据轮询用于发现遗漏，按扫描耗时留同等空档，关服务后停止后续轮询。这条必要 fallback 仍是同步元数据扫描；超大附件树的降级场景没有本次性能验收，不能宣称恒定延迟。
- **后台手机快照**：`startPhoneSnapshots` 防重入、2 秒合并事件、每分钟兜底；不在页面请求里生成。健康/财务目录标题和记录总数仍完整聚合；只缩小明确的 30 天原文窗口。
- **图片/附件**：HealthPage 的 Photos 只挂载所选两个日期，readPhoto 只返回所选记录图片且校验真实路径；Ask 只并发处理用户本次选中的附件，未发现“进入页面先下载全部照片”的路径。未碰权限检查或引入全盘媒体预读。
- **必要全量的显式操作**：首次全文索引、完整导出 ZIP、恢复备份、稿件字数统计仍须处理所选全集；不能以分页截断。现有导出/恢复的前台调用及首建全文索引没有新增独立后台作业/逐文件取消界面，本次取消/进度覆盖的是工作区 GitHub 同步；这是仍可继续拆分的重任务，不等同于日常资料浏览已恒定开销。
- **学习 writer 交接**：`readDoing.topics` 仍读取所有 `learning/<topic>/STATUS.md`；通用状态发现仍会进入 learning 的未知子目录。LearningPage/core learning 的列表、sources 解析请 PR57 writer 一并核实，本分支未重复修改。`readLibraryDocument` 是通用详情边界修复；若 PR57 扩展可打开文档种类，需同步这个入口白名单。

## 实测与可复现证据

同一台 Mac、Node 26.11.1，真实文件和 SQLite；主分支对照从 `git archive e2d9cd8` 单独展开并编译。没有伪造文件时间、git、时钟或测试超时。只有脚本自建临时资料：600 份对话、2,400 份原文、12,000 条训练、2,000 个附件子目录；正文搜索另用 11,000 份文本和真实 ripgrep。

原始结果见 [measurements.json](measurements.json)，复现脚本见 [measure.mjs](measure.mjs)。先构建本分支及可选的基线目录，然后 `node docs/acceptance/demand-io-2026-10-19/measure.mjs <已构建基线目录>`。结束删除自己的合成目录。

| 路径 | main 正文 readFile 次数 → 本分支 | main → 本分支耗时 |
| --- | --- | --- |
| 热对话搜索 | 600（28,926,380 bytes）→ 0 | 64.32 → 24.00 ms |
| 资料导航 | 3,614 → 0；本分支也不列工作区目录 | 301.74 → 0.26 ms |
| 收件箱首屏 | 2,402 → 41（40 + 前瞻） | 171.86 → 4.36 ms |
| 单份文档 | 2,403 → 1 | 159.46 → 0.51 ms |
| 发现状态 | 目录 readdir 2,023 → 19 | 80.58 → 2.21 ms |
| UI 工作区构造 | 1,235 → 11；目录 2,044 → 7 | 315.42 → 4.46 ms |
| 完整总览投影 | 仍保留完整汇总 | 839.67 → 309.92 ms |
| 手机资料投影（已热身） | 正文 0 → 0，元数据 stat 2,566 → 566 | 41.29 → 14.89 ms |
| 11,000 文件 grep | main 扫到原 10,000 候选上限而未执行搜索；本分支实际搜索 2 批 256 文件，返回原上限 250 条 | 2,379.71 ms 报范围过大 → 670.58 ms 返回结果 |

计数统计应用的工作区 readFileSync/readdirSync/statSync/lstatSync 调用；不是操作系统物理磁盘计数，SQLite 自身内部 IO 不在这个计数器中。各路径顺序执行，缓存热身不同，尤其 recent-note-input 的正文次数不能直接比较；其有效范围由 1,200 份缩到 200 份的 stat 数可验证。表中耗时是实际一次观测，不能据此承诺任意规模固定耗时。完整总览在该大样本约 310ms，首次重活小于 1 秒，但没有宣称满足所有日常请求 300ms；大范围首次 grep 仍超过 300ms，界面应保持查找反馈。

## 用户旅程与正确性

- 自动测试：新增一个合成资料旅程，验证导航 0 正文 IO、首屏 41 次、全部续页无缺失/重复、旧目录邮件筛选、单份文档 1 次、拒绝越界链接、保留自建模块嵌套状态、手机窗口外正文不读。
- 扩展现有对话搜索测试：121 份真实对话热搜索 0 正文读，改一份只读一份；中短英文查询、删索引重建和索引不进历史仍成立。
- 扩展现有备份往返测试：受控等待远端时阶段计数可读，取消后无上传、本地原文保留，重试成功；冲突/修订/删除与 PR56 测试仍通过。
- 扩展现有真实 Git 项目测试：多个本地/远端引用共享三份提交对象，一轮只读三次；跨时区日期、去重、原仓库字节不变仍成立。
- 真实本机 HTTP 产品接口：6 个资料分类，95 份合成原文按 40/40/15 读完，95 个唯一文件；单份决定正文返回。
- Chrome GUI：故意挂起 `me` 请求，今天页仍显示“已保存 95 条原文”“你的数据”“合成决定”；资料目录显示全部分类，未知数量不显示为零；收件箱可见正文数 40 → 80 → 95，最后无更多按钮；打开“合成决定”看到唯一正文。浏览器连接曾超时，恢复并核实页面后才记录通过。

## 检查

构建、typecheck、lint 通过。全仓 95 个测试文件、280 项通过；最后的项目提交图修改另用原真实 Git 旅程回归 3 项。检查只复用现有依赖；pnpm 使用空 user/global npm 配置，并关闭会自动安装依赖的 verify-deps-before-run。localhost 集成测试在允许监听的执行环境运行。

## 审查补正

- 状态隔离入口补回根目录 lstat/realpath 边界；外部目录符号链接不读取、不隔离、不删除。
- 项目提交图尊重每个仓库的 .git/shallow；真实 file:// depth-1 clone 和完整仓库可混合统计。
- 搜索说明已纠正：10,000 候选保护仍在。稀疏匹配/零匹配到达保护上限均返回显式 partial，保留已经找到的结果。复现脚本 sparse-search.mjs 使用 11,000 份真实合成文件和真实 rg，不提升资源上限。

- 状态发现仅跳过已知 health/files，不按 basename 排除 files；合法 learning/files 与 custom/nested/files 的下一步仍可读取和完成。
- gh stdin 错误有独立 listener：取消映射 AbortError；非取消写管道错误仍拒绝为 GH_REQUEST，不吞真正的传输失败。cancel-gh-stdin.mjs 在真实 gh 2.101.0 + Node 26 上用暂停的 localhost 代理回归；取消时真实 stdin 缓冲仍有 16,777,228 bytes，进程正常收尾。未读取已有 gh 配置，使用临时配置和合成授权。
