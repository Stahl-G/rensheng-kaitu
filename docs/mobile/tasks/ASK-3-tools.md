# ASK-3：工具

规范：[../ask.md](../ask.md) §4。依赖 ASK-2 的工具协议。仓库：`kaitu-ios`，`KaituKitData`。

## 目标

实现 6 个读工具和 4 个写工具（只生成卡片），名字、参数与电脑 `packages/cli/src/mcp/server.ts` 的 remote 工具一致。

## 做什么

1. 读工具：`status`、`project_list`、`exploration_read`、`life_map` 从快照读；`record_list` 按 `module.json` 找 jsonl 并按 id 取 rev 最大的一行；`read_file` 读工作区文件。数据都经现有 `WorkspaceStore`（iCloud / GitHub）读，带缓存。
2. 边界照 `packages/core/src/agent-tools.ts` 的 remote 规则：只读 `.md` / `.json`（`record_list` 读 `.jsonl`），不读 `.kaitu/`、`.git/`，不跳出工作区，财务模块整块拒绝（财务类型的 `record_list` 返回空，同 `publicRecords`），`memory/` 只读 `sensitive: false` 的单条文件、不读 `MEMORY.md`。单次返回 ≤ 20 KB，超出截断并注明。
3. 写工具：`record_add`、`task_add`、`propose_block`、`note`，执行时只校验参数并返回卡片（用 `schemas/` 里对应的 JSON Schema 校验 `record_add` 的 data），给模型的结果是「已生成卡片，等用户决定」。一轮最多 3 张。
4. 每个工具提供：JSON Schema 参数定义、中文步骤描述、读过的路径。

## 不要做

- 不加删除、改规则或目标、确认阶段、启用方向、写日历、改资料文件的工具。
- 不在每次调用时重新校验已经校验过的快照（快照在读入时已按 schema 解码）。

## 验收

- 单元测试：每个工具一条正常、一条越界（财务、敏感记忆、`../`、`.kaitu/`）、一条截断。
- 用 `schemas/fixtures/phone/` 的样例做快照来源。
