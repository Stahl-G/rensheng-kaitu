# 必要全量任务的后台执行验收

基于 PR58（`codex/desktop-demand-io`），独立后续分支 `codex/desktop-background-io`；不改 iOS、PR57 的 LearningPage/core learning、Windows PR54。资料格式、搜索覆盖范围、ZIP 内容、备份选择语义不变。所有数据为本任务临时生成，未遍历私人资料、账号或日志；未读取 npm 凭据，复用已装依赖并隔离 npm 配置。

## 已证实的阻塞与改动

| 用户动作 → 实际 IO | 原有规模/复杂度 | 本次处理与保留语义 |
| --- | --- | --- |
| chats search/reindex → `searchChats`/`reindexChats` → 遍历、逐文件 JSONL 解析、SQLite FTS | 首建必须 O(总正文)，同步阻塞事件循环；热查仍需 O(文件数) 元数据核对 | 真实 worker 执行；每索引单独排队，其他资料/写入不等待；CLI SIGINT、MCP progress/cancel、DSH signal；取消在文件间检查，事务回滚。同步兼容 API 保留，产品调用改异步。 |
| 设置 → 导出全部资料 → `exportWorkspace` → 递归读文件、`zipSync` | 必须 O(所选全部字节)，同步压缩 | worker 保持原过滤及 ZIP 内容；start/status/cancel/result，设置页显示读取进度/压缩/下载；离开页面可继续，关闭服务停止。 |
| GitHub 恢复 → inspect/read → 对每个文件 `ws.writeText` | 每次写入刷新 overview，可能 O(文件数 × 总记录数)，请求等待全部恢复 | 复用已有备份 active/progress/cancel；每文件异步临时写入+rename，全部完成后只刷新一次派生 overview。下载/恢复可取消。仅接受新/空目录，取消保留部分目录、不激活，原资料不写入。 |
| native watch 失败 → `workspaceFileStamps` 完整递归 stat | 必须 O(文件数) 元数据盘点，同步启动与重复阻塞 | 异步 opendir/lstat，不读正文、不并发重叠；完整扫描成功后才替换基线；失败重试，关闭/切换取消旧轮；`fileWatchStatus` 返回模式、运行状态和已扫描数。 |

没有引入持久任务数据库、通用任务框架或缓存一致性框架。ZIP 作业只在当前进程持有结果；结果取走即释放。备份恢复复用原有作业状态。

## 可复验数据

先运行仓库 build，再运行本目录 `measure.mjs`、`bundle-smoke.mjs`。记录见同目录 JSON。使用真实 Node 26、真实 SQLite/ZIP/文件 IO 和实际 wall time；没有伪造 Git/时间，没有固定耗时合格线。这是单次本机测量，不是跨机器性能承诺。

600 段合成对话，正文 64,923,395 字节：

| 操作 | 原同步调用返回 | 异步调用返回 | 异步总耗时 | 完整性 |
| --- | ---: | ---: | ---: | --- |
| 首建索引并检索 | 9165.66 ms | 0.39 ms | 9556.56 ms | 第 600 份独有词命中，进度 600/600 |
| 全量 ZIP | 965.26 ms | 0.92 ms | 1184.96 ms | 628 文件，解压后的文件名和逐字节内容一致 |
| 降级元数据扫描 | 16.15 ms | 0.09 ms | 38.50 ms | 两者同为 671 文件 |
| 恢复 600 份收件箱原文 | 无本次前后耗时比较 | 2.03 ms | 870.42 ms | 实际落盘 600/600 |

首次索引期间主线程真实定时器运行 798 次，最大观察间隔 140.93 ms；ZIP 期间 100 次、25.86 ms。异步并不减少必要总工作量。同期机器负载会影响这些数据。

`bundle-smoke.mjs` 使用真实 build-engine 产物，放入桌面 `dist/data-worker.mjs` 布局，验证 bundle 内的 worker URL 寻址、真实检索和 ZIP。不是整套安装包/宿主端到端验证。

`http-export-smoke.mjs` 对仅含合成资料的真实 startUi 发产品 HTTP 请求，验证 start=running，导出期间 library 可响应，ready/result 完整含最后一份 chat/note（224 文件），cancel 后 idle。结果见 JSON。浏览器新建专用 localhost 标签能载入页面，但点击与 Enter 均在 CDP 指令分派前超时，因此没有把新设置按钮的浏览器点击/下载算作通过。旧不透明标签的绑定被自动审批拒绝，随后新建明确 localhost 标签成功；没有读取旧标签内容。

## 检查与测试

- 全仓 build、typecheck、lint 通过。
- 完整测试：96 文件、282 项通过，124.92 秒。
- 新增 2 条实际旅程：一条核心旅程覆盖首建末尾命中、取消重建后原 SQLite 索引保留、下一次搜索增量补齐、取消压缩、ZIP 内容、只读元数据扫描取消；一条真实 HTTP UI 旅程让 fallback lstat 等待真实 Promise 门闩时仍能读取 library，并确认关闭取消扫描。没有假计时器。
- 扩展原恢复测试：第一份文件落盘后取消，原工作区保持不变；部分目标目录保留，非空目录重试明确拒绝。

PR58 最新 CI（head `b0b1b5a`，run `39291008801`）已终态：macOS 成功，Windows 失败。两处本分支新增测试的 Windows 路径/造样本问题已修正且不再报错；本轮剩余：`ask-filesystem.test.ts:94` FS_SANDBOX_DENIED，`feishu.test.ts` 找不到 lark-cli，`workbench.test.ts:56` history 长度期望 5 得 4。上一轮备份 timeout 本轮未复现。未无证据标记为“基线已失败”，未提高 timeout 或改版本断言掩盖问题；交由父线程与 Windows writer 协调。

## 尚存界限

- ZIP 仍读取并缓冲完整归档，base64 结果仍经原传输协议，内存随总字节增长；worker 改善主线程可用性，不解决超大归档内存与最终 base64/Blob 转换。没有引入新下载协议。
- 恢复初始化和最终一次派生 overview 刷新仍有同步部分；本样本主线程最大观察间隔 108.34 ms。大记录量下应单独测量，不宣称整个恢复零阻塞。
- SQLite 等待锁和单份 JSONL 解析只能在文件间合作取消；只读 ZIP worker 可直接终止。fallback 已发出的内核 IO 会先结束，结果按代际丢弃。
- fallback 完整元数据盘点不可省；状态接口可查进度，关闭/切换会取消，没有新增手动暂停监听 UI。

## PR57 学习 writer 的只读线索

从 PR57 分支读取到的精确路径（本任务未修改）：

- `packages/core/src/learning.ts:91-120` `readLearning` 枚举全部 source .md、排序、flatMap `scanText` 所有正文，同时读取 notes.md；打开一个 topic 的响应带全部 source.text，O(全部来源字节)。可考虑来源元数据列表和选中来源正文分离；显式教学/AI 所需原文必须保留。
- 同文件 `saved:131-140` 每次保存后再次 `readLearning`，重复读取所有来源正文。
- 同文件 `listLearning:124-130` 调用 `readDoing(ws).learning`，先读取 decisions 后丢弃非 learning 结果。
- `packages/dsh-plugin/src/client/LearningPage.tsx:62-82` `loadLearning(topic)` 整个响应完成后才 setDetail，来源集越大，主题打开越慢。
- topic 列表仍来自 notes 中 learning 项；需结合 PR58 按 section 读取后的列表路径核对，而非再次修改 LearningPage。共享通用 UI/product/service 文件存在合并冲突可能。


## 追加实测：ZIP 内存与恢复尾段

`zip-memory.mjs` 每种规模用独立真实进程和随机二进制附件，防止前一组高重复文本的压缩率掩盖内存代价。RSS 是进程及 worker 的实际采样值，采样峰值只是下界；不是仅 V8 heap，不是内存上限断言。

| 合成附件 | ZIP 字节 | base64 字符 | 导出前 RSS → 采样峰值 | 总耗时 |
| --- | ---: | ---: | ---: | ---: |
| 16 MiB | 16,815,818 | 22,421,092 | 118,058,528 → 347,590,096 bytes | 725.21 ms |
| 64 MiB | 67,164,219 | 89,552,292 | 167,571,144 → 789,827,168 bytes | 1903.04 ms |

必要的全量读取/压缩应保留；残留是全量 entries、压缩结果、base64 和线程消息/前端转换产生的同存副本。最小后续方案：在现有 export job 中用 fflate 的 ZIP 分块接口写一个程序管理的临时 ZIP；原过滤和完整范围不变；结果保存临时文件引用，受保护下载接口用流返回，前端直接下载而非 atob/Uint8Array。取消/关闭清理该作业自己的临时文件。需要同时适配独立工作台与 DSH 的下载入口，不能只修改一个返回值就声称完成。无需持久任务库或新增缓存框架。本轮仅给证据和方案，没有改归档协议。

`restore-tail.mjs` 对真实恢复的最后一份文件落盘后开始计数，范围含 writeAgentsMd、备份状态、一次 setImmediate 和最终 refreshOverview；仅统计自建工作区的应用层同步 fs 调用。

| 原文 / 训练记录 | 恢复文件 | 恢复总耗时 | 尾段 / 最大主线程观察间隔 | 尾段同步 readFile / 字节 |
| --- | ---: | ---: | ---: | ---: |
| 200 / 1000 | 201 | 687.35 ms | 87.86 ms | 271 / 867,350 |
| 2400 / 12000 | 2401 | 1793.24 ms | 346.72 ms | 2471 / 9,349,350 |

两组尾段均 45 次 writeFileSync、150 次 readdirSync；statSync 随原文数由 1449 增至 3649。最小后续方案：复用已有 data worker 增加单次派生 overview 操作，使用目标目录的 fresh Workspace，完成后才发布 restore completed；同一目标仍不并发写派生文件，原文不迁移、不改格式，不引入派生缓存。必要汇总计算保留。本轮仍明确保留同步尾段，未把它描述为零阻塞。

## 完整覆盖账本（截至本轮）

| 范围 | 分类与残留 |
| --- | --- |
| 冷启动/首屏 | 已修：构造推迟 overview、请求独立呈现。必要迁移/安全入口保留。完整 overview 聚合仍有同步成本（PR58 大样本约 310ms），不是所有页面请求恒定耗时。 |
| 资料列表/搜索 | 已修：导航零正文 IO、40+1 分页、单文档一次读、热搜索零正文读、首次完整索引 worker。保留完整元数据核对；SDK grep 10k 候选/250 结果明确 partial。 |
| 目录选择 | 已核实：原生 picker、云盘账号层及顶层单层枚举；没有桌面远端账号全树选择器。首次无路径模糊候选索引仍有有界元数据建库，属于已安装 DSH 行为，未修改。 |
| GitHub 同步/恢复 | 必要完整备份及三方冲突语义保留；进度/取消、恢复逐文件异步已修。尾段与 ZIP 协议残留见实测；PR54 与本分支共享 workspace-backup/打包文件，合并需协调。 |
| 版本保存 | 原本后台排队，保留完整 Git 状态盘点。Windows 状态缓存遗漏已有 PR54 对应修复，本任务不复制实现或放宽版本断言。 |
| 文件监听 | native 保留；fallback 异步逐项 metadata、防重入、完整成功后替换基线、关闭切换取消已修；进度接口可查，没有新手动暂停 UI。 |
| 手机快照 | 已修：30 天原文窗口在读正文前筛选。完整记录修订折叠仍必要，后台快照调度保留；不改 iOS。 |
| 图片/附件 | 已核实只读当前选中日期/附件，无进入页面预读整库图片路径；ZIP 全量附件内存另列残留。 |
| 学习页 | 明确残留并交 PR57：来源全集正文、保存后重读、列表读入无关 decisions；精确行号见上节。未重复修改 LearningPage/core learning。 |
| 项目同步/稿件统计 | Git 图单仓单遍、跨仓仅计数去重，并尊重各自 shallow；仅 main 同 HEAD 的浅/完整真实 clone 正反顺序均覆盖。显式稿件总字数必须读所选全集，当前同步解析与无逐文件进度仍是后续残留，未分页截断。 |

此账本区分代码路径审计、合成验收和平台缺口，未声明全仓所有残留已完成。

## 首轮 PR59 CI 与 PR54 对照

首轮 head beeb733、run 39292316251 已终态 failure：macOS 279 通过 / 1 失败 / 2 原有跳过；Windows 271 通过 / 4 失败 / 7 原有跳过。新后台核心旅程在 macOS 通过，Windows 两条新增旅程 timeout 必须由本任务跟进，不能都归给基线。

- macOS 唯一失败是 ui-watching 原有“同秒同长度恢复 mtime”用例（期望 after，读到 before）。PR54 diff 明确删除该固定 ctime 的伪造夹具，将真实外部编辑合入原监听旅程；本分支未修改该用例/版本实现，不复制 PR54 的清理。
- Windows ask-filesystem 的 FS_SANDBOX_DENIED 与飞书 lark-cli 失败，分别对应 PR54 的 native realpath/8.3 身份修复和安全 npm shim/Windows 夹具修复；PR54 诊断文档记录了 #55 同两项 CI 失败。不是仅凭文件名相同推断。
- PR58 前轮 workbench 版本计数失败，对应 PR54 4f08f1c 的 Workspace 写入后按路径失效 Git 状态缓存；PR59 本轮未复现，不声称已由 PR59 修复。
- 新 fallback UI 用例的门闩比较了 sync realpath 短名与 async realpath 长名，Windows 无法进入等待点。已将合成根目录/门闩路径用 realpathSync.native 统一物理身份；不改产品权限。
- 新核心旅程（多次索引/导出同一 150 份正文）在 Windows 超过默认总 15 秒；首轮无阶段日志，具体等待点尚未证实。正确性夹具改为 80 份较短正文，末尾命中/取消回滚/完整 ZIP 断言全部保留，新增失败阶段输出；规模证据仍用独立 600 份 / 64.9MB 脚本。此项是缩减重复正确性夹具成本，尚待新 Windows CI 确认，未提高 timeout、未改时间/Git。
- 修正后定向 3 文件 / 11 项本机通过，9.97 秒；其中含 PR58 新的真实 clone 顺序回归。
- GUI 现有授权下只重试一次：新建仅指向合成 localhost 的标签，菜单点击仍在 CDP 分派前超时；新按钮点击/下载验收缺口保留。合成服务器已停止并清理。

PR54 对照来源：该 PR head 4cc51db6c912ab6b4f5ed0ff819c84065109c7d6 的公开 diff，以及 docs/acceptance/windows-rc6-failure-diagnosis-2026-10-19.md、windows-rc6-ci-fix-2026-10-19.md。未读取 Windows 用户机器或私人日志。
