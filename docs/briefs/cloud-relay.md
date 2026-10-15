# 任务：云端接力协议（租约锁 + 记录只追加）

先读 `docs/cloud-relay.md`（设计已定，按它实现）、`docs/drive-sync.md`、`packages/core/src/overview.ts`、`inbox.ts`、`agents-md.ts`、`doctor.ts`，以及写 `NOW.md` 和 `STATUS.md` 的地方（`agent-tools.ts`、`projects.ts`、`workbench.ts` 等，用 `grep -rn 'STATUS.md\|NOW.md' packages/core/src` 找全）。不联网、不提交、不加依赖。

## 要做
1. **AGENT-README**：改写 `renderAgentReadme`，按设计 §2–§4 写清三类文件、锁的步骤、接手时的读取顺序和交接记录格式。保持简短、路径写全，原有的收件箱格式和记录格式两节保留。
2. **锁**：在 core 加 `lock.ts`，提供 `acquireLock(ws, holder, purpose)`、`releaseLock`、`readLock`，有效期 15 分钟，写入后重读确认。只在 Drive 模式下生效，本地模式直接放行。凡是本机写 `NOW.md` 或 `STATUS.md` 的入口都包一层，`holder` 为 `kaitu-local`。被他人持锁时：后台处理（inbox process、自动维护）推迟到下一轮；工作台或 CLI 操作抛出可读错误「<holder> 正在更新，稍后再试」。
3. **交接记录**：`init` 和 `upgrade` 创建 `handoffs/`；`OVERVIEW.md` 开头写明生成时间，再加「最近交接」一节，列最近 3 份（agent、时间、「下一步」第一条）。
4. **doctor**：报告状态文件的 Drive 冲突副本（同目录下名字形如 `STATUS (1).md`、`NOW (1).md` 的文件），以及 `LOCK.json` 格式错误；锁过期但还写着持有人的，只提示，不算失败。
5. **规范**：新增 `schemas/lock.schema.json`，以及 `schemas/handoff.schema.json`（只校验 frontmatter 的 `agent`、`at`）；`validate` 覆盖这两类文件。PRD §6.1 加 `LOCK.json`、`handoffs/`；§7.5 加一句「状态文件须持锁修改」；`agents-md.ts` §11 同步改写；`docs/drive-sync.md` 中「云端 Agent 怎么写」一节指向 `cloud-relay.md`。

## 测试（只写必须的）
- 锁：取锁、他人持锁时被拒、过期后可以接管，共一个测试文件。
- 本机写 STATUS 时遇到他人持锁被拒：一个测试。
- 不断言文案，不 mock 文件系统，用临时目录。

## 完成标准
`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 全部通过；`kaitu init --sample` 生成的 `AGENT-README.md` 包含新规则，`kaitu validate` 通过。中文简短汇报：改了哪些写入入口，有没有遗漏的状态写入点，哪些只能真机验证。
