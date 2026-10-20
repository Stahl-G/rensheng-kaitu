# V4：官方记忆模板 → CLI → 手机文件往返

2026-10-19，Linux，Node 24.19.0、pnpm 11.25.0。起点 main `e2d9cd83a176bf2fc6b35bc1dabe7f92f32bc9d6`，独立分支 `codex/v4-phone-e2e`。不连接账号、不建远端，不读取真实资料。合成工作区的根 Git 仓库是真实本地 Git，无 remote。

**通过范围：官方模板接管、实际 CLI、手机文件 schema、资料路径回读、收件箱处理、回执和快照更新、同文件及同操作重投。iPhone UI、原生 Swift 解码、iCloud/真实 GitHub 传输未验证。**

## 可重复执行与移交

在完成构建的本分支运行：

```sh
node scripts/verify-phone-e2e.mjs /tmp/kaitu-v4-new-run
```

目标目录中的 `workspace` 必须不存在。脚本直接复制当前 `docs/guides/agent-memory/template/`，本地 `git init/add/commit`，实际调用构建后的 CLI；只向规定的 `inbox/agents/` 投递合成输入，不手写 phone/NOW/ORGANIZER 等产品输出，不调用另一份投影实现。程序状态通过 `KAITU_LOCAL_STATE_DIR=<目标目录>/state` 隔离，不修改 HOME 或全局 Agent 配置。

本次原始目录 `/tmp/kaitu-v4-final/workspace`；完整命令、退出码和墙钟耗时见 [commands.json](evidence/commands.json.txt)，结果见 [result.json](evidence/result.json.txt)。五个阶段保存的是生成文件的直接副本（证据 JSON 追加 .txt 后缀以保留原始字节，避免仓库格式化器改写）：

1. [01-initial](evidence/01-initial/phone/today.json.txt)：模板接管，`phone run --as V4-cloud` 生成五份文件，`generator.kind=agent`。
2. [02-received](evidence/02-received/phone/today.json.txt)：手机提交一条 task 和一条原文，电脑 `phone run` 后 task 在 Today.mobile.tasks 中为 open，by=user。
3. [03-record-replayed](evidence/03-record-replayed/phone/receipts.json.txt)：同文件名、同内容再次送达，file receipt=duplicate；记录文件字节未变。
4. [04-completed](evidence/04-completed/phone/today.json.txt)：合法 `complete_task(expected_rev=1)` 后 Today 中状态 done、rev=2。
5. [05-final](evidence/05-final/phone/receipts.json.txt)：同 client_id 改用新文件名重投，action receipt=duplicate、target.rev=2；没有第三条修订。

每阶段真实读取 today/week/map/library/receipts，用仓库当前五份 schema 校验。Library 的所有路径检查存在，原文条目路径真实读回为 [received-note.md](evidence/received-note.md)，保留 iPhone 作者、origin、日期和第二行正文。task 的两行分别是首次新增和完成修订，不是两条独立待办。

模板已有 profile 和 .gitignore 字节保持不变，根 Git HEAD 保持模板提交；内部版本仍放工作区 .kaitu/history.git。[validate](evidence/validate.log)、[doctor](evidence/doctor.log) 均通过。空模板的 Library 为空是正确结果，没有填造初始个人数据。

## 实证缺陷与修复

### 手机 records 文件重投重复入账（已修）

复现命令（原始目录保留）：

```sh
KAITU_LOCAL_STATE_DIR=/tmp/kaitu-v4-evidence/state node packages/cli/dist/main.js phone run --dir /tmp/kaitu-v4-evidence/workspace
cp /tmp/kaitu-v4-evidence/payload.records.jsonl /tmp/kaitu-v4-evidence/workspace/inbox/agents/ios-3fa9c1d2-01K7XT00000000000000000001.records.jsonl
KAITU_LOCAL_STATE_DIR=/tmp/kaitu-v4-evidence/state node packages/cli/dist/main.js phone run --dir /tmp/kaitu-v4-evidence/workspace
```

修复前第二次仍返回 applied（[原始输出](evidence/replay-before-fix.log)），[真实记录文件](evidence/duplicate-before-fix.jsonl) 出现两条不同 ID、相同时间和内容的待办。

根因：`inbox.ts` 已将来源文件和生成记录 ID 存入 `.kaitu/inbox-records.json`，却只在 replaces 路径读取；普通重投始终重新 addRecords。修复仅对合法手机 `.records.jsonl` 在应用前查现有持久账本，已有文件移出收件箱并返回 duplicate。沿用现有文件不可变、每次提交新文件名的协议，不加字段，不改数据格式。普通 Agent、replaces、actions 和健康处理保持原有路径。

新增一个回归测试覆盖重开工作区、清空十四天展示回执后重投仍不增加记录，以及新文件名可以保存相同内容。此修复不声称解决首次写入中断恢复或两个独立整理器同时写同一记录的事务问题。

### 大工作区脚本调用断点（已修）

`node scripts/measure-phone-sync.mjs` 的投影阶段曾报 `TypeError: Cannot read properties of undefined (reading 'root')`，堆栈指向 listModules → buildPhoneToday。根因是脚本漏传当前必需的 ws。仅补上第三参数，与产品调用保持一致。

## 耗时与环境断点

本次 CLI 墙钟（含 Node 启动）：init 1915 ms，初次 phone run 803 ms；处理 task+note 2612 ms；无新文件重复运行 864 ms、snapshots=0；记录重投 2315 ms；完成操作 2541 ms；操作重投 2443 ms。处理新文件固定先等待 1500 ms 判断文件稳定，不能当作界面反馈时间。init 超过一次性重活 1 秒目标，且 CLI 接管前无进度输出；本轮记录，不擅加进度功能。

依赖安装首次 `pnpm install --frozen-lockfile` 失败于 `/home/agent/.local/share/pnpm` 不可写；改为 `XDG_DATA_HOME=/tmp/kaitu-v4-data XDG_CACHE_HOME=/tmp/kaitu-v4-cache pnpm install --frozen-lockfile --store-dir /tmp/kaitu-v4-store` 成功。环境无 `/usr/bin/time`，后续脚本使用 performance.now 测实际子进程墙钟。

`gh auth status` 显示 GH_TOKEN 无效；普通 git push 成功，未执行登录。草稿 PR 通过现有 GitHub 连接创建，结果见交审回复。

## Mac / 真 iPhone 接续

交接压缩包 `/tmp/kaitu-v4-mac-handoff.tar.gz`（约 83 KB）包含真实根 Git、当前工作区数据、生成 phone 文件和原文，排除本机 `.kaitu` 状态。或者直接在 Mac 构建本分支后运行上述脚本，得到全新合成目录和当前日期，避免测试 14 天回执过期。

Mac 线程把 `workspace` 传入真实 iPhone 可读取的测试文件夹，用现有 App 打开，验证：

- Today 能读取 task 的完成状态，id 与 result.json 一致，rev=2；空目标、地图和健康摘要不伪填个人数据。
- Library 出现“V4 合成手机原文”，点开能读到第二行“第二行供手机点开回读。”。
- 手机同步能读取 file/action 回执并结束待发送状态；核对 duplicate 的实际处理与乐观显示撤销。
- 做真实手机输入时，观察 App 实际创建的文件，而非复用脚本造输入冒充 UI 通过；电脑在同一合成目录执行 `KAITU_LOCAL_STATE_DIR=<新的隔离状态目录> node packages/cli/dist/main.js init <workspace>` 后 `phone run --dir <workspace>`，再在手机查看结果。init 使用接管路径，勿补写缺失的产品文件。

分阶段比较时可用 evidence 中的原始快照。不要另写手机投影。这里只提供可读取文件与明确预期，设备下载、文件协调、权限、UI 和后台刷新需真机补验。

跨整理器边界需父线程协调：本次 cloud/computer 用不同 CLI 进程但同一受控工作区和本机状态；未模拟独立云整理器丢失 `.kaitu` 账本后再接管，未修改跨端去重契约。V3 安装提示词和安装文档未改。

## 与 V3 的关系

V3 草稿 PR #61 只修首次交接推送和项目 STATUS 说明。本分支从 main 独立验证，不依赖也不修改 #61 的安装文档；此处修的是已实际运行确认的收件箱去重和测量脚本参数。合成流程直接使用官方模板，不代表 #61 冷读安装流程已在这里验收。

## 大工作区与最终检查

复用现有 `measure-phone-sync.mjs`：300 项目、20,000 条记录（含 100 待办）、2,000 篇原文。为避免原脚本重设 HOME，本次在 `/tmp` 副本删去该行并把相对 imports 改为本检出绝对路径，其他测量逻辑不改；[实际测量副本](evidence/measure-executed.mjs.txt)、[原始结果](evidence/large-workspace.log)。该辅助脚本沿用原有内存 inspect adapter 仅启用投影门槛，没有真远端或网络同步；端到端主流程始终使用普通文件与真实本地 Git，不依赖该 adapter。

| 测量 | 结果 |
|---|---:|
| today/week/map 纯投影 | 3.218 ms |
| today / week / map 字节 | 19,796 / 302,060 / 64,143 |
| 内容不变的快照写入 | 0 |
| 100 条 complete_task | 99.773 ms，100 applied |
| 同 client_id 再执行新增修订 | 0 |
| 后台防抖至快照变化 | 3701.660 ms |

辅助脚本只测原有三个投影；Library 五阶段 schema 与实际原文回读见主流程，不将这里的 3.218 ms 宣称为四投影总成本。首次试图取消 adapter、仅用 force 生成快照时，后台刷新在 15 秒超时：普通 local 工作区没有启用同步，后台按设计不生成；恢复现有脚本的门槛设置后测得上表，不作为产品故障修复。

最终 `pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `git diff --check` 全部通过。[全量测试输出](evidence/tests.log)：93 文件通过、1 文件跳过；278 测试通过、2 跳过，108.63 秒。跳过项为环境未具备的桌面 providers 测试，未当作通过。手机两份相关测试 15/15 通过，新增真实重复投递回归包含在内。原始构建、类型、lint 和相关测试日志保存在 evidence。

## 独立审查补验：撤回后的延迟重送

PR #62 首版去重仍遗漏同一本机上的现有 replaces 旅程，与跨整理器状态丢失无关。实际 CLI 复现：[执行脚本](evidence/withdrawal-executed.mjs.txt)、[修复前](evidence/withdrawal-before.json.txt)、[修复后](evidence/withdrawal-after.json.txt)。脚本每一步均为独立 CLI 进程，目录、命令、耗时、回执和本机账本原样保存在 JSON 中。

| 旅程 | 修复前任务数 | 修复后任务数 |
|---|---:|---:|
| 手机 A 入账 | 1 | 1 |
| 新文件 B 用 replaces 撤回 A | 0 | 0 |
| 同字节 A 延迟重送 | 1（错误复活） | 0（duplicate） |
| 新文件 C 用 replaces B 提交新内容 | 2（包括错误复活的 A） | 1（C applied） |
| 旧撤回文件 B 延迟重送 | 1（再次执行） | 1（duplicate，C 保持） |

根因是 replaces 成功后删除了旧来源的 `.kaitu/inbox-records.json` 键；首版只查当前键，因而撤回后的 A 没有去重依据。`6513a67` 的第一轮补修在替换来源为合法手机文件时保留原键与来源，把 records 置为空数组；随后独立审查发现它还缺少当前/已被替换来源的区分，最终修复见下一节。普通 Agent 来源仍用原来的删除路径。

新操作必须按原协议使用新文件名；新内容和沿 replaces 链的后续操作仍能应用。同名旧操作不重新执行，不把延迟重送当作恢复任务的意图。新增第二个回归测试覆盖撤回、重开、延迟重送、新文件新内容与旧撤回文件重送。[相关测试](evidence/withdrawal-focused.log) 3 文件、19 项通过。固定提交后的全量检查及 GitHub exact-head CI 状态以本轮交审回复为准，不沿用首版结果冒充复验。


## 陈旧 replaces 目标回归与最终修复

独立审查继续确认第一轮补修会错误接受新的 C 再次 replaces 已过期 A：A 入账 → B replaces A 且包含新记录 → A 旧件重送 → C replaces A，任务数从 1/1/1 变为 2。此问题在同一本机发生，既非跨整理器问题，也不依赖回执过期。前一修复保留了去重依据，却把它继续当作有效替换目标。

最终仅在本机私有 `.kaitu/inbox-records.json` 的旧来源回执中增加可选 `superseded: true`。旧来源仍可用于同文件去重，但 replaces 校验将其视作失效目标，沿用原有拒绝及待整理原文路径。当前来源即使 records=[]（合法撤回）也不带该标记，允许后继新文件替换。新生成来源回执保持 `{agent, records}`；旧正常账本兼容，公开手机文件、phone receipts、记录数据和所有 schemas 均不变。尚未发布的第一轮合成账本不迁移为真实用户数据。

实际 CLI 证据：[脚本](evidence/stale-target-executed.mjs.txt)、[修复前](evidence/stale-target-before.json.txt)、[修复后](evidence/stale-target-after.json.txt)。修复后六阶段任务数全部为 1：A 入账、B 替 A、A duplicate、陈旧 C 替 A rejected、合法后继替 B applied、B duplicate。拒绝 C 时 B 的 ID 与内容保留，没有第二条活记录。

空撤回旅程也在最终实现上重跑：[原始结果](evidence/withdrawal-final.json.txt)，任务数 1 → 0 → 0 → 1 → 1，确保不以空 records 判定失效。第二个行为测试合并覆盖空撤回和非空替换两种情况；相关 19 项测试通过，见 [最新相关检查](evidence/stale-focused.log)。固定最终 head 后重跑全量检查与 exact-head CI，不以 `6513a67` 的检查代替最终结果。
