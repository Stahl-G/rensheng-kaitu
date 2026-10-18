# 2026-10-19 夜间性能修复

仅使用合成工作区。分支 `codex/night-1019`，不改 schemas 或 PRD §6。

## PERF-1 手机预览

- CLI 薄入口动态加载手机命令，预览 worker 只加载手机处理链路。
- 临时副本不复制历史对象、本机运行缓存和健康照片目录。原工作区历史只读元数据，预览在临时副本维护派生文件及版本摘要。
- 复制按工作区、本机状态、外部收件箱区分范围。保留合法的 files/cache/chats 项目、自定义 cache 模块、收件箱全部格式及附件。
- 差异先比较文件 stamp，仅对变化文件读内容。二进制差异报告字节数。
- 保留 `processInbox` 默认 1.5 秒文件稳定等待。

同一 probe 的基线与修改后均为 159 文件、约 214 KB，少量状态时间字段有差异。
基线 `f551124` 使用 `/tmp/night-phone-perf.mjs`，原记录在 `../PERF-1-before.log`。
修改后记录在 `/tmp/PERF-1-probe-final.log` 和 `/tmp/night-phone-final/observed.json`。

| 场景 | 基线 wall ms | 修改后 wall ms | 基线父进程读取字节 | 修改后父进程读取字节 |
| --- | ---: | ---: | ---: | ---: |
| 首次预览（note + action） | 3132.5 | 2396.5 | 18709359 | 3351587 |
| 同输入正式运行 | 2665.0 | 2196.0 | 18674197 | 3746114 |
| 重复正式运行 | 737.4 | 808.4 | 18530421 | 3602407 |
| 重复预览 | 1520.7 | 1216.6 | 18715868 | 3346877 |
| 加 32 MiB media + 16 MiB cache 预览 | 1641.2 | 902.1 | 119379712 | 3347073 |
| 外部健康 + 重定向 state 预览 | 3490.4 | 2523.0 | 119415875 | 3351842 |

读量包括依赖加载。单次 wall 受机器负载影响，重复正式运行本轮更慢，不据此声称所有路径提速。
48 MiB 惰性文件不再造成约 96 MiB 双遍读取，复制顶层耗时本轮约 45–53 ms。
首次和外部收件箱预览仍超过 1 秒目标，不能记为性能目标全部达成。

行为验证：原工作区、重定向状态、外部收件箱内容与文件/目录 mtime 不变；note/action 回执和五份 schema 正确；
Agent/电脑 generator 正确；重复正式运行 snapshots=0 且内容/mtime 不变；重复预览 changes=[]。
兼容测试另用有效健康 XML、ZIP、外部快捷指令样本得到 70/71/72 三条体重记录，
并对比五份快照（仅归一化运行时间）、操作结果和原二进制附件。

检查顺序：core build → typecheck → Biome → CLI build → 相关 Vitest（4 文件 / 24 测试通过）。
日志 `/tmp/PERF-1-{corebuild,typecheck,biome,clibuild,vitest}-final.log`。
未安装依赖。首次新增测试的依赖解析与旧 dist 问题已修复并重建验证，不能引用旧运行作为通过证据。

## PERF-2 桌面复用工作区

`startDesktop` 把已打开的 Workspace 传给 `createLocalAsk`，取消后者重复构造及同步维护。
保留启动时一次正常维护、会话工作区 key 与 `getWorkspace` 的迁移读取方式。

`/tmp/night-desktop-reuse-perf.mjs` 在相同 20,000 条合成训练记录上实际构造本地问问服务：

| 阶段 | 修改前 ms / statSync | 修改后 ms / statSync |
| --- | ---: | ---: |
| 一次必要 Workspace 维护 | 298.04 / 1526 | 237.51 / 1526 |
| createLocalAsk 首次 | 259.85 / 1526 | 1.70 / 0 |
| createLocalAsk 重开 | 263.27 / 1526 | 0.84 / 0 |

服务创建、创建会话、关闭和重开回读同一会话均通过，不启动 AI 或访问凭据。
记录在 `/tmp/PERF-2-{before,after}.json`。
检查 core build → typecheck → Biome → 相关 Vitest（3 文件 / 12 测试通过），
日志 `/tmp/PERF-2-{corebuild,typecheck,biome,vitest}.log`。
未测 Electron 原生整机冷启动，不把这段节省宣称为解决全部启动延迟。
