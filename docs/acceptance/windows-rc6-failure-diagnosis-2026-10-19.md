# RC6 十二项失败的定位与精简

原始安装包来源 main `62a28fca521a62e4b587f3e8e18bc58d5c4c11ff`。用户随后要求查清十二项失败、删除逐文件重算摘要、清理冗余测试。本轮在 PR #54 继续，未改真实资料、系统权限、数据格式或发布状态。

## 十二项分别是什么

| 数量 | 原失败 | 实际原因及处理 |
|---|---|---|
| 7 | map-evidence、security-records、DSH security-files、ask-filesystem、MCP 敏感资料、security-finance、security-state | 均在 `symlinkSync` 准备合成夹具时 EPERM，未到安全断言。本进程没有有效符号链接创建能力；不是七个已经证实的安全漏洞，也不能当作安全测试通过。保留这些有效边界测试，不改变系统设置 |
| 2 | workspace-backup 往返、记录并发冲突 | 恢复批量文件时，`Workspace.writeText` 每次触发 `refreshOverview`，技能安装也逐文件重算摘要，Windows 文件元数据调用被放大。删除该低层副作用，保留同步、恢复、存版本和监听的操作边界刷新；原两项回归默认超时下已通过 |
| 1 | developer-memory 的纯 Git 模板接管 | 已有模板带 OVERVIEW，初始化补技能时触发同一重复扫描；不是仅因 15 秒设置小。无监测改动的合成接管初始化 7,617ms，隔离诊断中只推迟派生刷新为 1,073ms，原文保留与手机快照断言均通过 |
| 1 | ui-watching 的 startup 等待 | 失败发生在等待首个后台版本的 poll 截止前，未执行到改写断言；单独运行通过。原用例还伪造 ctime。删除单独伪造 stat 的用例，将真实同长度且保留 mtime 的外部编辑合入已有监听/保存/删除用例，保留原超时、保存与敏感状态断言 |
| 1 | feishu | 两层问题：原 Unix shebang 夹具 Windows ENOENT；产品直接 execFile 启动 npm `.cmd` 也 EINVAL，是实际兼容缺陷。复用已有安全 npm shim 解析，按 PATH 找入口后直接运行 Node，不引入 shell；替换无效夹具，保留导入、去重和更新原文的一个业务用例 |

没有以删除安全断言、提高超时或新增 skip 来得到通过结果。ui-watching 从三个用例合并为两个；清理 history 测试中已无引用的 stat/mtime 及失效函数 import。

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

原始日志及 CPU profile 在 `.kaitu/rc6/diagnosis/`：`profile-backup.log`、`backup-control.log`、`backup-deferred.log`、`backup.cpuprofile`、`profile-adopt.log`。飞书合成复现 `feishu.log` 确认：extensionless ENOENT、npm `.cmd` EINVAL、原产品调用 FEISHU 错误、已有安全解析器成功。

## 提交与检查

- `7d6ed08`：删除 Workspace 逐文件摘要重算，在同步、恢复、冲突处理完成点刷新。
- `6d595e9`：合并外部编辑回归，删除伪造 ctime 的重复用例和废弃 import。
- `c9d680d`：飞书使用已有安全 CLI 解析；支持 PATH 名称和显式 Windows npm shim。
- 备份与监听定向：8 项通过，39.05 秒，原断言与默认超时不变。
- 飞书与本机 Agent 定向：9 项通过，11.16 秒。
- developer-memory 和 history 在首轮修复定向中通过；完整修复后的 build、lint、typecheck 和全量检查进行中。

当前已安装包仍是前一份 rc.6/main 基线，不能冒称包含这些后续修复。新包及安装验证完成后再更新。没有正式 Release、官网部署或合并；Computer Use 初始化阻碍及真实 Agent 未验的边界不变。
