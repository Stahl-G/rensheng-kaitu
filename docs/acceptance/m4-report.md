# M4 新用户验收报告

日期：2026-10-15。结论：CLI 与已执行的工作台流程通过，记录 8 项问题（含 1 项环境验收阻塞），已修 5 项，剩余 3 项列在末尾。
浏览器文件上传未完成，因此不把工作台「预览→确认」标为通过。

## 环境与范围

- Node v26.11.1，使用已安装依赖，未联网、未加依赖、未提交。
- 先读 GOAL、HANDOFF、PRD，按 PRD §3.3、§10 和 HANDOFF §8 执行。
- `mktemp -d /private/tmp/kaitu-m4.XXXXXX` 得到 `/private/tmp/kaitu-m4.NQlyDI`，数据工作区为其下 `kaitu/`。
- 首次执行 `pnpm build`，再运行 `KAITU_DIR=<临时>/kaitu node packages/cli/dist/main.js init --sample` 和 `doctor`，全部通过。
- 本文以下命令的 `kaitu` 均实际替换为仓库 CLI 绝对路径，设置 `KAITU_DIR` 指向临时工作区。
- 未访问或修改真实 `~/kaitu`、Google Drive、`~/Library/Application Support/kaitu`，未启用外部日历或同步。

## 阶段 1 实跑结果

| 清单项 | 执行与结果 |
|---|---|
| init + doctor | 样例初始化成功，doctor 所有检查通过；随后恢复到初始化版本，从空数据重走导入。离线使用本仓库 CLI，未验证 npm 发布或 `npx` 下载。 |
| ChatGPT 记忆 | 按技能准备 2 条候选；`memory import --file ... --dry-run` 不改记忆或版本；确认替代执行写入 2 条，仅新增 1 个版本；恢复导入前 memory 后整批消失，恢复导入后版本全部回来。 |
| Apple Health | 合成 zip 导入 6 条指标、1 条训练、2 条活动、1 条睡眠，未映射 3 条；体重 `154 × 0.45359237 kg`，睡眠 390 分钟，10 月 1 日步数 400；重导入跳过 10 条，不新增版本，校验通过。 |
| ICS | `import ics ... --from 2026-10-01 --to 2026-10-31` 预览后导入 5 条事件，含全天、循环排除、改期、跨时区；改期训练为 10 月 20 日 11:00（+08:00）。另导入当天合成通话，供计划引用。 |
| 训练 | 按 log-workout 查询 schema、已有训练，再 record add 写深蹲 3×12、60 kg、独立 session_id；当日查询和校验通过。首次建立基线；下次保持 60 kg，组次与动作质量达标再建议 62.5 kg，建议不记成已完成。 |
| 早间计划 | 按技能读取 status、规则、目标、STATUS、日程、睡眠、训练、待办、项目；NOW 含当天 19:30 通话和 20:30 阅读建议（pending）。当天已训练，不重复安排；明天休息、后天训练。校验和 snapshot 通过。 |
| 晚间复盘 | 按 evening-review 执行 project sync、status 和当日 workout/meal/sleep/activity 查询；更新各模块 STATUS.updated，写当天日报，明确通话和阅读未核实、原因待补，未冒认完成；validate、snapshot 通过。 |
| 读书模块 | 默认选择 Agent 管理，创建 reading/module.json 与 STATUS.md，`validate reading`、`agents-md` 通过；新技能示例再次原样落盘校验通过，两处技能副本一致。 |
| history / restore | 空工作区、记忆、健康导入、日历、训练、计划、复盘、读书模块共 8 个阶段逐一完整恢复，核对目标版本中实际文件字节，全部一致；自动重建的 OVERVIEW 与 AGENT-README 单独排除字节比较。最终恢复到读书模块阶段。 |
| 写入范围与密钥 | 跟踪器记录的 1722 次写路径均在临时工作区内，另跟踪重跑 init --sample。遍历验收历史，secrets、index、cache 均未纳入；恢复后密钥不变、权限 600。路径逃逸测试通过。 |
| 工作台替代 dashboard | Chrome 实际打开今天、健康、动态、我的、设置；项目在「我的」下显示，项目同步按钮成功；日程确认后显示「已确认，尚未同步到日历」，在历史恢复后重新出现待确认按钮。无应用页面空白或应用控制台报错。 |

技能替代执行读取了 onboarding、import-chatgpt-memory、health-import、log-workout、morning-plan、evening-review、add-module。
没有启动额外模型会话或注册全局 MCP；结果证明这些命令和文件步骤可执行，不代表已验证 Codex 自动发现或自然语言触发。
写路径跟踪覆盖 CLI 子进程的同步、回调及 Promise 文件写入入口，没有对整机后台程序做全盘监控。

## 浏览器与耗时

先后用 `ui --no-open --port 0` 监听空闲端口 60238、62082、62729，仅绑定 127.0.0.1。
初始样例用于看页面与确认／恢复，随后 CLI 重走真实空工作区流程，最后浏览器复核修复。

选择 Apple Health 来源和本地文件后，浏览器上传权限门禁拒绝 `fileChooser.setFiles`，给出的原因是未获得上传授权。
没有尝试其他浏览器、CDP、curl 上传或写接口来绕过；此后的 CLI 导入是任务中独立要求的本地文件导入。
工作台上传的预览、确认、撤销仅阅读了前后端实现，未取得浏览器运行成功证据，见 M4-06。

86 条 CLI 验收命令中位耗时 420 ms，最慢 `agents-md` 为 2041 ms；导入命令 360–680 ms，恢复 465–886 ms。
最终只读接口抽测：`/api/state` 27 ms、`/api/history` 8 ms，均为 HTTP 200。
合成数据下未观察到明显等待；构建仍提示约 676 kB 前端 bundle，未用大规模真实数据测性能。

## 问题清单

| 编号 | 严重度 | 复现步骤 | 现象 | 期望 | 处理 |
|---|---|---|---|---|---|
| M4-01 | 低 | 对合成 export.zip 运行 Apple Health 预览，查看 workout 分组 | CLI 显示 `undefined`，前端类型映射也缺 workout | 显示「训练」并保留正确数量 | 已修 CLI 与前端标签；CLI 实跑确认，不新增文案测试，前端上传实跑受 M4-06 限制 |
| M4-02 | 中 | NOW 放 kind: task、status: done / skipped 的块，打开今天 | 两项均显示空框 | 显示已完成／已跳过状态 | 已修；Chrome 确认勾选与跳过状态，数据未变 |
| M4-03 | 中 | 按阶段 1 清单寻找 ChatGPT 记忆贴回样例 | examples 中没有该样例，需要自行编造输入 | 提供合成贴回文本和候选文件 | 已补 examples/chatgpt-memory.md 与候选 JSON、README 入口；实际导入、整批恢复通过 |
| M4-04 | 低 | 执行 PRD §10 原先指定的 dashboard 命令 | CLI 无此命令，与 GOAL 中工作台替代决定不一致 | 验收清单使用现有 ui 入口 | 已同步 §10 与 T13 为 ui，实际浏览器打开通过 |
| M4-05 | 中 | 新工作区按 add-module 第 7 步找 module.schema.json | 工作区没有该文件，说明未给最小合法定义，需要猜字段 | 工作区技能直接给可落盘校验的读书模块与状态示例 | 已补完整最小示例；原样落盘后 validate、doctor、技能双目录同步通过 |
| M4-06 | 中 | 设置→导入→Apple Health→选择合成 XML | 浏览器授权门禁拒绝文件上传，未到应用预览 | 获得授权的浏览器里完整验证预览、确认及撤销 | 未修：环境验收阻塞，不是已证实的应用 bug；没有绕过门禁 |
| M4-07 | 中 | 将 reading.visibility 设 nav，validate 后查看设置和主导航 | 设置标为「导航」，主导航仍固定 4 项，没有读书入口 | 定义自定义模块如何进入工作台，并使展示与能力一致 | 未修：涉及固定四页与自定义模块入口的设计取舍，留 Claude Design 重做时处理 |
| M4-08 | 低 | 查看含多次恢复的版本历史，再点恢复 | 只有说明、时间和整区恢复确认，需猜恢复影响 | 恢复前可判断影响范围与内容 | 未修：交互设计问题；恢复及撤销已实测通过 |

## 最终检查与可恢复状态

- `pnpm build`、`pnpm typecheck`、`pnpm lint` 全部通过。
- `pnpm test`：24 个文件、98 项测试全部通过，21.31 秒；未增加依赖或测试。
- 两处运行时修复均为显示逻辑，采用 CLI／浏览器实际复核；没有断言文案或镜像实现的测试。
- `git diff --check` 通过，PRD §6、schemas/ 数据规范未修改。
- 临时材料保留在 `/private/tmp/kaitu-m4.NQlyDI/`：`cli-log.json` 为命令、退出码和耗时，`checkpoints.json` 为阶段版本，`writes.jsonl` 为写路径记录。
- `run.mjs`、`doc-check.mjs` 是本次临时验收执行记录，不纳入仓库测试。工作台验收服务结束后关闭。

## 已修

M4-01、M4-02、M4-03、M4-04、M4-05，共 5 项。

## 未修（原因）

- M4-06：浏览器上传授权被拒，需在允许文件上传的环境补跑「预览→确认→撤销」；当前未完整验收。
- M4-07：自定义模块导航入口需产品与界面设计决策，本次按要求只记录。
- M4-08：历史改动预览属于交互设计，留待界面重做；恢复行为本身通过。
