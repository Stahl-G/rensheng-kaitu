# 任务：云端接力第二版（白天只追加，夜里整理一次；去掉租约锁）

先读 `docs/cloud-relay.md`（第二版设计已定，按它实现），再看上一版的提交 `git show 2998328 b105d00`，那一版加了租约锁，本次要把它去掉。不联网、不提交、不加依赖。

## 要做
1. **去掉锁**：删除 `packages/core/src/lock.ts`、`schemas/lock.schema.json`、`packages/core/test/lock.test.ts`，以及所有 `withStateLock` / `isStateFile` / `lockUnavailable` 包装和调用（workspace、history、projects、agent-tools、workbench、inbox、doctor 等），恢复成上一版之前的写法。只留下真正需要的改动，不要残留无用的分支；`NEVER_TRACK` 和 `.gitignore` 里的 `LOCK.json` 也删掉。
2. **交接记录平铺**：`handoffs/<YYYYMMDDTHHMM>-<agent>.md`，frontmatter 为 `agent`、`at`，可选 `follows`；新增 `handoffs/daily/<YYYY-MM-DD>.md`（frontmatter `organizer`、`date`）和 `handoffs/archive/<日期>/`。更新 `schemas/handoff.schema.json`，新增 `schemas/daily.schema.json`，`validate` 覆盖这两类文件；`archive/` 下的文件不做校验。
3. **入口文件**：改写 `renderAgentReadme`，按设计 §1–§3 写，短而准，原有的收件箱格式和记录格式两节保留。新增 `renderOrganizer`，生成根目录的 `ORGANIZER.md`（设计 §4），由 `refreshOverview` 与 `AGENT-README.md` 一同写出；init、upgrade 时生成。
4. **OVERVIEW**：保留生成时间；增加「最新每日整理」（路径与日期）；「最近交接」改为读取平铺目录下的最近 3 份。
5. **upgrade 迁移**：把 `handoffs/YYYY-MM/`（包括 Drive 生成的同名副本，例如 `2026-10 (1)`）里的 `.md` 移回 `handoffs/`，删除空的月份目录和 `LOCK.json`；重复运行不出错，`--dry-run` 不写入。
6. **doctor**：保留状态文件冲突副本检查，并扩展为报告任意目录下名字形如 `xxx (1)` 的同名副本，包括文件夹；删除锁相关的检查。
7. **文档**：`agents-md.ts` §11 改为两行：云端规则见 `AGENT-README.md`，整理员规则见 `ORGANIZER.md`。PRD §6.1 把 `LOCK.json` 换成 `ORGANIZER.md`，把 `handoffs/` 的说明改为平铺加 `daily/`、`archive/`；§7.5 删掉持锁那句，改成「云端 Agent 白天只追加；整理员按 ORGANIZER.md 更新状态」。`docs/drive-sync.md` 相应段落同步。

## 测试（只写必须的）
- upgrade 迁移：月份目录和同名副本平铺回根目录、`LOCK.json` 删除、重复运行无变化，一个测试。
- 不写其他测试，不断言文案。删掉为锁写的测试，包括 `workbench.test.ts` 里的锁用例。

## 完成标准
`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 全部通过；`kaitu init --sample` 生成 `AGENT-README.md` 与 `ORGANIZER.md`，`kaitu validate` 通过。汇报用中文，两三行：改了什么、删了什么。不要写免责声明。

## 补充
- 仓库根目录就是当前目录（git worktree），只改这里，不碰 `~/Developer/rensheng-kaitu`、`~/Developer/rensheng-kaitu-runtime`、`~/kaitu` 和 Google Drive。
