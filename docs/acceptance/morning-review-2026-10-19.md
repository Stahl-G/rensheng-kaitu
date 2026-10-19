# 2026-10-19 晨间收口复核

本轮从干净的 `7b8029ccacfeca7d7bba04455571c4f1993d367a` 接续，仅使用合成资料。
K1–K7 与该基线三项性能工作沿用既有记录，没有重新实现。
当前用户已授权正常提交、推送 `origin/codex/night-1019` 草稿 PR31，取代 GOAL 的旧“不推送”限制。
PR 说明由 supervisor 更新。本轮未合并、关闭 PR、改 PR base、强推、发布、部署、购买或修改 iOS / Mac 启动代码。

## 本轮提交

| 提交 | 内容与验证 |
|---|---|
| `bc3709535e5ef344f5186ef80cfcdf319cc377f2` | 飞书原文进入既有 onboarding；两项新行为回归通过，原有相关 21 项通过 |
| `203db1bb93ae6eeba932f34455879360a16c363e` | 精确补入 PR23 后续文档，Biome 与八文件覆盖核对通过 |
| `359da7dad6c7c5dc819f98f98d6a190263f1284f` | 慢 polling 扫描后让出 I/O 时间；相关 12 项回归通过；10k 一轮对照达到 3.20 秒，最终复测仍失败，时延项开放 |
| `511e7c7a16c9e3baaedd21ddf8b11b8d19af938a` | 补强真实存在的换行文件路径回归，生产实现不变；本轮完整检查绑定此产品 SHA |

末次收据提交仅增加本文，产品文件与上述产品 SHA 相同。
最终分支、远端 HEAD 和干净状态核对保存在 `/tmp/kaitu-supervisor-closure-evidence/delivery.json`。

## 飞书最小兼容方案

- 仅在 `readOnboardingMatter` 与 `isOnboardingTask` 两处复用同一严格文件名白名单，新增 `feishu-[a-f0-9]{64}.md`。
  日期路径与原有 26 位名称继续使用，保留 `findInboxNote`、`kind: capture` 和来源日期一致性检查，不接受任意路径。
- 生产 `openFeishuInbox` 写入的普通、空字符串、100005 字符正文，修复前均可被 generic inbox 列出、正文完全一致，但 onboarding 返回 BAD_ARGS。
  复现用原始 `7b8029c` 的 `onboarding.ts` 编译进其余源码相同的 core dist 副本，方法与结果完整保留。
- 修复后同三种正文可读取、起草、采纳、归档、按原来源完整回读，并能完成下一步。
  原文件字节与首尾空白不变；ULID 原文采纳/完成、伪造路径、同名换行文件、错误 kind/date 的拒绝均有行为回归。
- 没有套用 `captureNote` 的 trim / 非空 / 100k 人工输入限制，没有截断、改名迁移或改共享 schema。
  现有 revision 去重、失败恢复、不覆盖和路径保护沿用原实现，原有 CLI 回归通过。
- 四个既有持久化键 `title`、`source`、`feishu_document_id`、`feishu_revision_id` 保持不变。
  **它们仍需产品数据规范裁决**；本次兼容补丁不把实现现状当作 PRD §6 的批准，不擅改 PRD §6、schemas 或生成模板。
- [入口说明](../guides/feishu-folder-import.md)已明确：实际 CLI 导入本身不调用 snapshot。
  历史由随后正常运行的监听或手动 `kaitu snapshot -m` 保存；落盘回执不冒充历史已保存，入口不等慢活完成。

证据：`/tmp/kaitu-supervisor-closure-evidence/feishu-before-matrix-fixed.log`、
`feishu-regression-final.log`、`feishu-related.log` 与最终全套测试日志。

## PR23 文档覆盖及祖先关系

只 fetch 所需 main、当前分支和 PR23 refs。核对时 main 为 `6e5ca015d8344b5770ab0511630b08f3d0ac045c`，
PR23 head 为 `b8a99cae2e698d0f900b3b268621f5880f83c4b5`。
已核实源提交 `a148e99dee0a92ea6a18711276ca4439d6438b80`、
`b84abc460d2d5c814abe9a7958f9add6b02d7468`、`b8a99cae2e698d0f900b3b268621f5880f83c4b5`。

下面八文件均逐 blob 与 PR23 head 核对一致。A/M 是相对上述 main 的文件差异：

| 文件 | 相对 main | 本轮处理 |
|---|---|---|
| [夜间计划](../plan/2026-10-19-night.md) | A | a148 内容已经存在，原样保留 |
| [电脑端任务](../tasks/desktop-next.md) | A | 保留 K6/K7，追加 K8/K9 |
| [架构评估](../research/2026-10-19-architecture-review.md) | A | 精确带入 b84 |
| [Photos 设计](../design/iphone/Photos.dc.html) | A | 精确带入 b8 |
| [设计索引](../design/iphone/README.md) | A | 补 Photos 索引 |
| [手机产品定义](../mobile/product.md) | M | 补 Photos 产品入口 |
| [Photos 任务](../mobile/tasks/PHOTOS.md) | A | 精确带入 b8 |
| [手机任务索引](../mobile/tasks/README.md) | A | 补 Photos 索引 |

本分支 `docs/PRODUCT.md` 保持原样，SHA256 为 `53ee47726a26d78d205867f9782f4d7c71ac42a14f480f1c6c7fbbbac3336f9a`。
没有实现 K8/K9/Photos，没有修改 iOS 代码。
main 是本分支祖先；三个源提交自身都尚不是该 main 或本分支的祖先，本轮采用精确内容整合。
**文档覆盖不等于 PR23 已合并或可以关闭**，没有关闭 PR23 或修改 PR base。
逐文件 blob、diff 与祖先检查见 `/tmp/kaitu-supervisor-closure-evidence/pr23-coverage-product.json`。

## 10k 高频 polling：部分改善，6 秒时延项仍开放

诊断约 02:20–02:29 UTC，少于 15 分钟。先读指定独立验收报告并定位其 `readonly-regressions/racefix/large-probe.mjs`。
复用其 10000 个合成 Markdown 夹具的独立副本，未改原夹具；没有用 3000 文件结果替代。

证据指向**同步扫描成本与后台盘点排队叠加**，不是持续空事件反复重置 debounce：
保存计时器已触发，旧高频扫描每轮约 84–108ms，50ms interval 下几乎连续运行。
初步样本 6 秒内扫描累计约 5.64 秒；只读队列计时另显示初始化盘点、保存与刷新排队。
该队列计时仅在临时编译产物中插桩，用于诊断，没有留入产品源码或最终产物。

改法只涉及 fallback polling：每轮扫描结束后才安排下一轮，空档取 `max(原间隔, 本轮扫描耗时)`。
保留请求 30ms 时的 50ms 最小间隔，慢扫描会相应延后下一轮；默认 1000ms 继续作为最小空档。
没有全局新锁、删功能、放宽观察窗口或修改原生 watcher。慢扫描行为回归在旧实现约 4ms 就重入下一轮时失败，修后通过。

为消除夹具歧义，正式前后对照复制后先同样刷新 Git 索引 stat；每组用 `snapshotNow` 重置并核对真实 HEAD blob 为 `SYNTHETIC 0\n`，再写同长度 `SYNTHETIC X\n`。
旧探针复用关闭 UI 的 Workspace 后调用 `snapshot`，可能仍走延期回调，不能假定重置已入历史。
校正后旧生产调度仍复现高频失败，故没有把它归为单纯夹具问题。

| 配置 | 修前 6 秒内新 HEAD | 初次修后对照的新 HEAD | 修前/后含 close 总耗时 |
|---|---|---|---|
| 1000ms | 2454.4ms | 1984.0ms | 3414.1 / 2868.4ms |
| 请求 30ms，最小 50ms | 否，close 后才追上 | 3204.3ms | 8940.6 / 3659.7ms |

两组前后真实最终 blob 均正确，pending 为空，其他 9999 份正文读取均为 0。
修前/后高频目标正文读取为 4/3 次。含 close 时间不冒充后台保存时间，也不是 Mac 首窗或普遍性能承诺。
正式对照：`polling-original-verified-baseline.{log,results.json}` 与 `polling-balanced-verified-baseline.{log,results.json}`。
最初复制索引尚未刷新的样本、固定 50ms 空档仍失败的尝试，以及其余中间实验全部保留，不作为最终通过依据。

最终完整构建后，在产品 SHA 上又于 close 前读取所观察新 HEAD 的真实 blob：
普通配置约 2925.8ms 观察到正确的 `SYNTHETIC X\n`，高频配置 **6 秒内仍没有新 HEAD**，
含 close 总耗时约 7474.7ms，关闭后 blob 才确认正确，pending 为空，其余 9999 份正文读取仍为 0。
补充探针因此退出 **1**，原始失败保留在 `polling-final-product.{log,json,results.json}`，不能被前一次 3204.3ms 的通过覆盖。

**验收判断：高频 6 秒时延仍开放。** 已定位同步扫描饱和和后台盘点排队，但本轮只验证了让出空档的行为改善，
没有证明它能稳定消除时延。限时诊断后不再追加修复，也不以普通配置或更小工作区通过关项。
下一步仍使用同一 10k 夹具与真实 blob 基线，分别计时初始化盘点、pending 盘点、Git 状态盘点和提交，
确认主导阶段后再减少重复盘点或拆分扫描，并保持 6 秒观察上限。
该复测与全套检查串行；补充命令的 start/end SHA、diff、UTC 和 exit 见同名 JSON。

## 最终产品 SHA 完整检查

产品 SHA：`511e7c7a16c9e3baaedd21ddf8b11b8d19af938a`。
以下命令严格串行；每条 start/end SHA 均为该 SHA，working diff SHA256 均为
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`（干净树）。

| 命令 | start UTC | end UTC | exit | 日志 |
|---|---|---|---|---|
| `pnpm build` | 02:31:06.852148 | 02:31:28.745110 | 0 | `product-final-build.log` |
| `pnpm typecheck` | 02:31:35.598446 | 02:31:49.774433 | 0 | `product-final-typecheck.log` |
| `pnpm lint` | 02:31:52.946396 | 02:31:54.310671 | 0 | `product-final-lint.log` |
| `pnpm test` | 02:31:59.704555 | 02:35:04.283158 | 0 | `product-final-test.log` |

完整测试：**295 passed / 2 skipped（297）**，92 个文件通过、1 个文件跳过。
两个 skip 都是既有可选宿主测试。四项全绿不代表上节高频性能验收通过。

已核对根 `package.json`，没有 `pnpm check` 脚本，没有把未执行的命令记为通过。
全部使用合成 HOME / KAITU / XDG 状态目录，仅复用已核实的 `test-boundary.cjs` 隐去 `/Applications/`。
除既有两个可选宿主 skip，没有隐藏测试、放宽 timeout 或同时运行多个 full suite。
build 保留既有 Vite 大于 500kB chunk 的 warning，退出 0。

所有日志及逐命令 start/end SHA、working diff hash、exit、UTC 时间与日志路径在
`/tmp/kaitu-supervisor-closure-evidence/command-ledger.json` 及各同名 `.json`。
首次失败均保留：原飞书阻断、初次 Biome 的断言/格式问题、测试编写时把单个 next 当数组、临时副本模块路径错误、旧 polling 行为回归。
初轮 Feishu typecheck 与 Biome 曾误重叠约 1.5 秒，最终交审依据使用上表严格串行的完整检查。
换行文件边界探针已通过，未发现所猜测的 JavaScript 正则问题，仅保留实际文件回归，没有修改正确的正则。

## 保留的边界

- 四个飞书持久化键仍需产品规范裁决。
- 本轮没有读取真实用户资料、凭据、日历或 CLI 隐藏会话；真实设备、真实日历与真实飞书账户未验。
- Mac 原生首窗沿用交接的 **1.19–1.65 秒，仍未达到 1 秒目标**，本轮未重测；init 已在窗口后，未改 Mac 启动代码。
- [既有性能记录](night-perf-2026-10-19.md)中的首次手机预览等未达标边界继续保留；本轮 10k 合成结果不代表所有历史时延、真实设备体验或整个 PR 获得验收批准。
