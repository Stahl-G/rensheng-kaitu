# RC6 Windows CI 两项失败与本机旧基线诊断

## 以 #55 的 CI 为准

用户纠正后已核对 [Windows 原始 CI 日志](https://github.com/Stahl-G/rensheng-kaitu/actions/runs/39258742103/job/118080568381)：**269 通过 / 2 失败 / 7 原有跳过**。PR #55 head 是 `7e46e0705803186b4bf9c4c5a902f2645aeb7f5a`，工作流检出合成 merge `3f3c03d70308aa20273d1d2c558e0cb0ba941335`；合入后的 main 为 `60ba38d052148d50039bced016dfb742f7585d67`。本分支已合入该 main 的 CI 工作流。

后文十二项是此前 main `62a28fc` **在本机**的历史结果，不是最新 main 的 GitHub CI 结果。本机七项 symlink EPERM 也不是 hosted runner 的失败。

- **问问真实 SDK 写入**：Windows 8.3 短名与长名身份不一致。`realpathSync` 保留短名，SDK 的异步 `realpath` 展开长名，路径入口误拒绝同一个工作区；相对路径计算也必须统一物理身份。在本机将现有 SDK 测试根目录改为真实短名后，修复前复现相同的 `FS_SANDBOX_DENIED`；修复后通过。原测试继续覆盖 STATUS 用户决定/Agent 建议、旧版本与取消写入，并补充越界、`.kaitu`、`.git` 拒绝断言。物理身份统一用 `realpathSync.native`，保留词法目录检查与物理链接边界。
- **飞书 CLI**：无后缀 Unix 夹具在 Windows 无法执行，真实 npm `.cmd` 也不能直接交给 `execFile`。本分支已有安全 shim 解析与 Windows 合成夹具修复，详见下文。

最终源码 `c4d069db40c8fa01fa5f4ec92147b4df591bcdb9` 已重新构建、检查、打包并本地安装 `windows.4`；实际安装包内 SDK 的短路径写入与安全边界、打包 CLI 的飞书合成导入通过。首轮 PR CI 原两项通过，另发现一个工作台版本缓存遗漏并修复。最终 CI 结果因诊断服务连接失败尚未确认，不能写成全绿。见 [最终修复包与完整边界](windows-rc6-ci-fix-2026-10-19.md) 和 [机器可读证据](windows-rc6-ci-fix-2026-10-19.json)。下文 `windows.2` 为历史产物，不含本次短路径及后续修复。

原始安装包来源 main `62a28fca521a62e4b587f3e8e18bc58d5c4c11ff`。用户随后要求查清十二项失败、删除逐文件重算摘要、清理冗余测试。本轮在 PR #54 继续，未改真实资料、系统权限、数据格式或发布状态。

## 本机旧基线十二项分别是什么

| 数量 | 原失败 | 实际原因及处理 |
|---|---|---|
| 7 | map-evidence、security-records、DSH security-files、ask-filesystem、MCP 敏感资料、security-finance、security-state | 均在 `symlinkSync` 准备合成夹具时 EPERM，未到安全断言。本进程没有有效符号链接创建能力；不是七个已经证实的安全漏洞，也不能当作安全测试通过。保留这些有效边界测试，不改变系统设置 |
| 2 | workspace-backup 往返、记录并发冲突 | 恢复批量文件时，`Workspace.writeText` 每次触发 `refreshOverview`，技能安装也逐文件重算摘要，Windows 文件元数据调用被放大。删除该低层副作用，保留同步、恢复、存版本和监听的操作边界刷新；原两项回归默认超时下已通过 |
| 1 | developer-memory 的纯 Git 模板接管 | 已有模板带 OVERVIEW，初始化补技能时触发同一重复扫描；不是仅因 15 秒设置小。无监测改动的合成接管初始化 7,617ms，隔离诊断中只推迟派生刷新为 1,073ms，原文保留与手机快照断言均通过 |
| 1 | ui-watching 的 startup 等待 | 失败发生在等待首个后台版本的 poll 截止前，未执行到改写断言；单独运行通过。原用例还伪造 ctime。删除单独伪造 stat 的用例，将真实同长度且保留 mtime 的外部编辑合入已有监听/保存/删除用例，保留原超时、保存与敏感状态断言 |
| 1 | feishu | 两层问题：原 Unix shebang 夹具 Windows ENOENT；产品直接 execFile 启动 npm `.cmd` 也 EINVAL，是实际兼容缺陷。复用已有安全 npm shim 解析，按 PATH 找入口后直接运行 Node，不引入 shell；替换无效夹具，保留导入、去重和更新原文的一个业务用例 |

没有删除安全断言、提高超时或新增 skip。ui-watching 最终从三个用例合并为一个真实流程：启动前写入、持续编辑中自动存版本、同长度且保留 mtime 的最终原文读回、退出保存删除、敏感状态不入历史。删除精确版本数量的短 poll 和伪造 ctime 夹具；清理 history 测试中已无引用的 stat/mtime 及失效函数 import。

平台行为核对：[Node 官方 child_process 文档](https://nodejs.org/download/release/v22.23.3/docs/api/child_process.html)说明 Windows 的 `.cmd` 不能直接用 execFile 执行；[Microsoft CreateSymbolicLink 文档](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createsymboliclinka)说明符号链接创建的权限条件。本次分别用合成 CLI 与失败栈实证，没有调整系统权限。

## 性能证据

使用本工作树忽略目录内独立合成 HOME、状态与工作区；备份远端为进程内 mock，无真实网络授权。直接运行完整往返和去重断言，用 CPU profile 与 fs 计数定位，而非仅增加 Vitest 超时。

| 阶段 | 原代码耗时 |
|---|---:|
| 新工作区初始化 | 975ms |
| 连接备份 | 158ms |
| 首次同步 | 15ms |
| 恢复到第二个工作区 | 13,564ms |
| 后续单次同步 | 13–386ms |

恢复阶段计数：109,056 次 statSync、12,226 次 realpathSync、17,432 次 existsSync、6,206 次 readdirSync；实际上仅 122 次 writeFileSync。CPU profile 指向 `writeText → refreshOverview → readStatus/readWorkbench`，其中 `writeAgentsMd` 在恢复路径中消耗约 8.9 秒。

同一机器、相同往返断言的隔离因果实验：仅暂时推迟派生摘要刷新到恢复结束，恢复 1,023ms；随后原逻辑对照恢复 10,786ms。两次的备份、恢复、往返、原文及重复同步断言全通过。实验不进入产品，不改安全检查；正式修复直接删除低层刷新调用，不保留临时抑制开关。

正式修复重新构建后，不启用任何诊断抑制开关，同一脚本的恢复为 **932ms**、普通资料准备写入为 **7ms**（原 515ms）；恢复中的 statSync 从 109,056 次降为 5,128 次，实际 writeFileSync 仍是 122 次；全部往返、原文和去重断言通过。日志 `backup-fixed.log`。

原始日志及 CPU profile 在 `.kaitu/rc6/diagnosis/`：`profile-backup.log`、`backup-control.log`、`backup-deferred.log`、`backup.cpuprofile`、`profile-adopt.log`。飞书合成复现 `feishu.log` 确认：extensionless ENOENT、npm `.cmd` EINVAL、原产品调用 FEISHU 错误、已有安全解析器成功。

## 提交与检查

- `7d6ed08`：删除 Workspace 逐文件摘要重算，在同步、恢复、冲突处理完成点刷新。
- `6d595e9`：合并外部编辑回归，删除伪造 ctime 的重复用例和废弃 import。
- `c9d680d`：飞书使用已有安全 CLI 解析；支持 PATH 名称和显式 Windows npm shim。
- 备份与监听定向：8 项通过，39.05 秒，原断言与默认超时不变。
- 飞书与本机 Agent 定向：9 项通过，11.16 秒。
- developer-memory 和 history 在首轮修复定向中通过；完整修复后的 build、lint、typecheck 和全量检查进行中。
- 首轮完整复跑：262 通过 / 8 失败 / 7 原有跳过，381.46 秒；三个原性能超时与飞书失败消失，剩七项 EPERM 与一个版本数 poll。随后将监听三个用例进一步合成一个真实操作流程，单独通过（7.03 秒）；最后完整复跑进行中，不隐去首轮失败。

最后完整复跑（默认参数、无新增 skip）：**262 通过 / 7 失败 / 7 原有跳过（276 项）**，85 个文件通过 / 7 失败 / 2 原有跳过（94 文件），441.75 秒。失败全部在合成 symlink 夹具创建时 EPERM；没有性能超时、飞书启动失败或监听时序失败。日志 `final-full-test.log`。运行机器的并发负载不同，不用全量耗时替代前述同场景性能对照。

修复包已用官方脚本重新生成，安装器修订为 `windows.2`，功能版本与共用后端仍是 `0.1.0-rc.6`。

| 项目 | 结果 |
|---|---|
| 检查及打包源码 | `a8b64f66d2e9bab30489163c67afc06921d5d32a`（最新功能代码在 `c9f1c5a8da83aeb4a40e3c23dd0c13b0c0733e80`，之后仅测试与文档） |
| 本地安装器 | `D:\test\rensheng-kaitu-windows-night-1019\dist\windows-rc6-fix\Kaitu-Setup-0.1.0-rc.6-windows.2-x64.exe` |
| 大小 | 300,077,183 bytes |
| SHA-256 | `4cfaedcce5515423d172d21d996de56a0c2061e82d02db4869a8d3e01621f5fe` |
| 本地安装与检查 | 安装 exit 0；九项文件哈希与新包一致；已安装 EXE 的 20 个合成检查事件通过 |

## 修复包实际验证

本机原安装位置已更新到修复版（功能版本仍 rc.6，安装器 windows.2）。原版本、旧包与诊断日志保留作历史证据，不把旧安装包描述为已包含修复。

- 已安装应用返回 rc.6；独立中文空格工作区保存和重启读取通过，RC4 新建合成资料及 RC5 来源合成原文均保留。
- 合成 ACP 首次失败重试、切换及进程重启恢复通过。完成后已结束本轮测试进程；这些是接口和进程验证，不是正常 UI 退出或真实模型服务实跑。
- 实际执行 **已安装 EXE 的打包 CLI**（ELECTRON_RUN_AS_NODE），通过 PATH 中的合成 npm `.cmd` 调用飞书导入：首次 1 篇/新增 1 条原文，再次新增 0/未变 1，读回合成正文成功。没有使用真实飞书授权或联网服务。
- CLI 补验脚本初次误用了 `--json`（该参数要求值），改为项目已有 `--json-out` 后通过；错误日志保留，未算作产品失败。
- 完整版本、来源、安装哈希、原始合成运行结果见 [修复产物与证据](windows-rc6-cleanup-2026-10-19.json)。

没有正式 Release、官网部署或合并；Computer Use 初始化阻碍及真实 Agent 未验的边界不变。涉及 Workspace 与备份入口，合并前仍需非作者独立验收，作者自测不替代。
