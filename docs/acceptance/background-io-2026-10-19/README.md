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
