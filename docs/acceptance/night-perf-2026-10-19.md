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
最终修正后记录在 `/tmp/PERF-1-corrected-probe.log` 和 `/tmp/night-phone-corrected-final/observed.json`。

| 场景 | 基线 wall ms | 修改后 wall ms | 基线父进程读取字节 | 修改后父进程读取字节 |
| --- | ---: | ---: | ---: | ---: |
| 首次预览（note + action） | 3132.5 | 2591.5 | 18709359 | 3353083 |
| 同输入正式运行 | 2665.0 | 2088.3 | 18674197 | 3748750 |
| 重复正式运行 | 737.4 | 352.7 | 18530421 | 3604353 |
| 重复预览 | 1520.7 | 613.3 | 18715868 | 3348373 |
| 加 32 MiB media + 16 MiB cache 预览 | 1641.2 | 651.8 | 119379712 | 3348373 |
| 外部健康 + 重定向 state 预览 | 3490.4 | 2662.7 | 119415875 | 3353162 |

读量包括依赖加载。单次 wall 受机器负载影响，较早一轮重复正式运行甚至为 808.4 ms，不能只挑更快样本。
48 MiB 惰性文件不再造成约 96 MiB 双遍读取，复制顶层耗时最终约 28–31 ms。
首次和外部收件箱预览仍超过 1 秒目标，不能记为性能目标全部达成。

行为验证：原工作区、重定向状态、外部收件箱内容与文件/目录 mtime 不变；note/action 回执和五份 schema 正确；
Agent/电脑 generator 正确；重复正式运行 snapshots=0 且内容/mtime 不变；重复预览 changes=[]。
兼容测试另用有效健康 XML、ZIP、外部快捷指令样本得到 70/71/72 三条体重记录，
并对比五份快照（仅归一化运行时间）、操作结果和原二进制附件。

补查发现重复健康导入会虚报历史变化，已修正：有收件箱时在临时副本建立当前输入的 Git 基线，
用正式保存规则确认是否产生版本，只读原位置的盘点使用 `refresh:false`，不刷新原索引。空收件箱不建立临时 Git 基线。
新增重复健康输入回归，预览不虚报历史、正式快照零写且实际版本列表不变。

检查顺序：core build → typecheck → Biome → CLI build → 相关 Vitest（最终 4 文件 / 25 测试通过）。
日志 `/tmp/PERF-1-correct-{corebuild,typecheck,biome,clibuild}.log` 与 `/tmp/PERF-1-corrected-final-vitest.log`。
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

## PERF-3 启动监听与历史盘点

移除启动时两次无条件 `workspaceFileStamps`。先建立原生监听；仅回退到轮询时建立一份基线，
回退时补查版本和收件箱，避免丢失监听失效期间的变更。首次 Git 盘点在服务监听之后排到后台。
读取接口不进入该后台写队列，敏感忽略规则不变。

`/tmp/night-ui-startup-perf.mjs` 创建相同规模的 10,000 个未跟踪合成文件，实际启动服务并读取首页：

| 模式 | 服务就绪 ms（前 → 后） | 首响应 ms（前 → 后） | 监听前同步 stat（前 → 后） |
| --- | ---: | ---: | ---: |
| 普通监听请求 | 2395.43 → 8.11 | 2413.84 → 132.01 | 20138 → 0 |
| 强制原生监听不可用 | 976.77 → 104.55 | 989.37 → 117.44 | 20138 → 10069 |

普通监听请求本次在首响应前也转入了轮询，建立了 10069 次 stat 的基线，不能称为原生监听成功验收。
修改后两种模式监听时均尚未调用 statusMatrix，后台盘点分别在启动后约 917 / 933 ms 完成。
基线盘点分别在监听前约 2019.97 / 850.24 ms 完成。机器负载差异使两份基线 wall 有明显波动，
不拿两种模式互相比较。记录 `/tmp/PERF-3-{before,after,before-polling,after-polling}.json`。

基线 probe 启动证据写出后，退出保存 1 万个未跟踪文件耗时很长，已仅终止持有这两份专用日志的本任务 Node 进程。
后测 probe 清理自己生成的批量文件后再正常关闭服务，退出保存耗时不计入启动数据。
这不是产品退出性能验收，也未测 Electron 窗口、云盘、真实日历或真实 10 秒启动场景。

检查 core build → typecheck → Biome → CLI build → 相关 Vitest（5 文件 / 17 测试通过）。
新增合成轮询用例验证启动前改动、后续外部编辑、删除及敏感本机状态忽略；现有原生路径、收件箱、历史与安全测试通过。
日志 `/tmp/PERF-3-{corebuild,typecheck,biome,clibuild,vitest}.log`。
