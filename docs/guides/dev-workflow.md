# 开图开发流程

生效：2026-10-19。这是唯一的流程文件，取代之前的三份提案（Codex 双角色版、Grok Bot 版、Claude 审批稿）。
适用：在本仓库干活的所有 Agent。产品规范仍以 AGENTS.md 列出的文件为准。

## 1. 原则

1. 现在速度优先。main 可以直接推；不配云端 CI，不开分支保护。什么时候再配，见 §9。
2. 只在三处从严：
   - 可能弄坏或泄露用户资料的改动；
   - 碰真实设备和外部服务的代码；
   - 发版。
3. 所有检查都能在本机用一条命令跑完。
4. 同一类错误第二次出现，就写成测试或脚本，而不是多加一句规则。

## 2. 角色

| 角色 | 谁 | 做什么 |
|---|---|---|
| 你（dot） | 用户 | 定任务先后；数据规范、隐私、发版的决定；「要验收」的改动由你点头后合并；随时可以说停 |
| 开发 | Codex 为主；并行任务可交给 Claude Code、Cursor、CodeBuddy | 写代码、自测、推送或开 PR、按验收意见修改 |
| 验收 | 和作者不同家的 Agent：Codex 写的由 Claude Code 验，其他 Agent 写的由 Codex 验 | 只验「要验收」的改动；不改代码 |
| 派单和汇总 | Grok Bot | 把你的要求写成任务卡；每天 07:30 汇总；把你的「停」转给所有在干活的 Agent |

Grok Bot 不当验收人：验收要跑很多命令，而它每条命令都要你批准。

## 3. 改动分两类

默认是**普通改动**。碰到下面任何一类，就是**要验收的改动**：

| 类别 | 路径或情形 |
|---|---|
| 数据格式与迁移 | `schemas/`；PRD §6；`docs/guides/phone-contract.md`；`templates/`；`packages/core/src/` 下的 `agents-md`、`records`、`record-*`、`inbox`、`inbox-formats`、`phone-actions`、`upgrade`、`sync-location`、`sync-files`、`drive`、`workspace-backup`、`github` |
| 隐私与安全 | `packages/core/src/` 下的 `secrets`、`state-binding`、`local-state`、`workspace`、`agent-file-policy`、`memory`；`packages/desktop/` 下的 `sdk-filesystem`、`sdk-search`、`sdk-credentials`、`sdk-host`、`sdk-runtime`、`environment`；`packages/cli/src/mcp/`；`packages/channels/src/state.ts`；`docs/site/privacy*`；以后的「不发给 AI」开关 |
| 真实设备与外部服务 | `packages/core/src/` 下的 `system-calendar`、`calendar`、`health-import*`；`packages/desktop/calendar-executor.mjs`；`packages/channels/src/collectors/` |
| 发版与对外 | `packages/desktop/` 下的 `package-*`、`payload-*`、`launcher.c`、`repack-asar.mjs`；`scripts/package-*`；任何 `package.json` 的版本号；官网（gh-pages）上的下载链接、「已签名」、隐私说明、版本状态 |
| 依赖 | `pnpm-lock.yaml`；任何 `package.json` 的依赖增减 |
| 检查和规则本身 | `biome.json`、`vitest.config.ts`、`test/isolate-home.ts`、`AGENTS.md`、`CLAUDE.md`、本文件、`scripts/needs-review.mjs`；新增 `.skip` 或 `.only` |

拿不准时问自己三句，有一个「会」就按要验收处理：

- 会不会弄坏或泄露用户资料？
- 会不会碰真实设备或外部服务？
- 会不会对外发布？

开发在推送前运行 `scripts/needs-review.mjs`（§10 C4），它按上表判断。

## 4. 普通改动：直接推 main

1. 开工前读 AGENTS.md 要求的文件，以及 HANDOFF §4 的决定表。
2. 写完运行 `pnpm check`：依次 build、lint、typecheck、test，约三分半钟。全部通过再推；只改文档的可以不跑。
3. 推之前拉最新 main。拉下来的提交里有别人改的代码，就再跑一次 `pnpm check`。
4. 提交说明写清改了什么、为什么：
   - 推翻已有决定的，写明推翻哪条、谁同意的（§6）；
   - 涉及 AGENTS.md 耗时三档的，写上在合成大工作区实测的数字。
5. 不允许：为了通过检查而跳过、删除或放宽测试；强推 main。

## 5. 要验收的改动：PR → 验收 → 你点头

1. **开发开 PR，不直接推 main。** PR 说明写：
   - 任务卡：目标、完成标准；
   - 改了什么；
   - 怎么验证：从哪个入口进入、在测试环境里怎么跑；
   - 哪些没验证、为什么。
2. **验收人另开环境。**
   - 新建一个工作树，检出 PR 的最新提交。
   - `KAITU_DIR`、`KAITU_APP_HOME`、`KAITU_LOCAL_STATE_DIR`、`HOME` 都指向临时目录，绝不碰真实工作区。
3. **验收做三件事。**
   - 跑 `pnpm check`。
   - 按完成标准实际操作一遍受影响的路径：用 CLI 命令，或运行 `kaitu ui --no-open`（默认端口 4870）后在浏览器里操作。
   - 读 diff，重点找四类问题：
     - Agent 能不能越权（信任边界）；
     - 旧资料还能不能读（兼容）；
     - 有没有新的地方把资料发出去（隐私出口）；
     - 会不会动到真实设备。
4. **真实设备的路径在测试环境里实跑。**
   - 系统日历：用测试日历（§10 C3），验完删掉，绝不对你的「开图」日历运行。最好在 Mac 上另建一个不登录 iCloud 的系统账户，在那里跑。
   - iCloud、健康、邮件：用测试账户和合成资料。做不到就在结论里写「没实跑」，由你决定合不合。
5. **结论写成 PR 评论：**

   ```text
   验收人：<工具>（没参与编写）
   提交：<完整 SHA>
   pnpm check：<通过 / 失败及原因>
   实际操作：<走了哪些路径、结果、截图位置>
   读 diff：<发现了什么；没发现写「无」>
   结论：通过 / 不通过
   问题：<编号、复现步骤、期望和实际>
   ```

6. **不通过就退回。** 问题一次列全，验收人不改代码。开发修完推新提交后：
   - 只修了提出的问题：验收人看增量 diff（`git diff 旧提交..新提交`），没问题就在新评论里写新的提交 SHA。
   - 改了别的逻辑：重新走第 3 步。
7. **合并。**
   - 验收通过后由你点头，你或你指定的 Agent 合并。
   - 合并前核对：评论里的提交 SHA 等于 PR 当前最新提交。
   - 数据规范的改动必须你点头（AGENTS.md 第 2 条）。

## 6. 决定记录

- HANDOFF §4 的决定表是唯一来源。已经过时的条目（例如 D3 导航、D10 不做手机端）标「作废」，并写明被哪条取代。
- 你做了新决定，接到的 Agent 当天补进决定表：日期、决定、出处（对话、PR 或文档）。
- 要推翻表里的决定，或推翻验收、监管提过的要求：先问你；提交或 PR 说明里写明推翻哪条、谁同意的。

## 7. 发版

对外发布（Kaitu.app、Windows 包、npm、TestFlight、官网下载链接）是现在唯一会直接影响别人的事，在这里从严：

1. 在要发布的那个提交上跑 `pnpm check`，全部通过。
2. 验收人在干净环境里按 `docs/release-smoke.md`（§10 C5）安装一遍，走一遍核心流程。
3. 官网改动在真浏览器里核对下载链接、版本说法和隐私说明。
4. 你确认后再发布。发 release、发 npm、提交 TestFlight、推送官网都不可撤回，只有你确认后才能做。
5. 发布说明里记下：版本号、提交 SHA、谁验的、冒烟结果。

## 8. 第二次犯就写成结构

同一类错误第二次出现，修复时一并补上测试、lint 规则或脚本检查中的一样。实在写不成，才在 AGENTS.md 加一句，并附一个反例。

## 9. 什么时候上云端 CI

满足任一条就配：

- 有你之外的人在日常使用开图；
- 有第二位人类开发者，或开始接受外部 PR；
- main 因为并行改动坏过两次（拉下来 `pnpm check` 不过）；
- 打算让 Agent 无人值守地合并。

**配法已经验证过：**

- 内容：GitHub Actions 上跑 `pnpm install --frozen-lockfile` 和 `pnpm check`。
- 实测：在 2026-10-18 的干净副本上全程约四分钟，DSH 插件能构建。
- 配好后再开分支保护：对管理员也生效；Agent 改用没有管理权限的 token。

## 10. 落地任务

**Codex：**

- **C1：加 `pnpm check`。** 根目录 `package.json` 加 `"check": "pnpm build && pnpm lint && pnpm typecheck && pnpm test"`。build 必须在 typecheck 前，否则 `packages/channels` 找不到 `@kaitu/core`。
- **C2：修 root 下必然失败的测试。** `packages/cli/test/status.test.ts` 用 chmod 设只读，对 root 无效；云端会话都是 root。改成 root 下也能测；做不到就只在 root 下跳过，并写明原因。属于要验收。
- **C3：日历名可配置。** `packages/desktop/calendar-executor.mjs` 支持环境变量 `KAITU_CALENDAR_NAME`，默认仍是「开图」，供验收在测试日历上实跑。属于要验收。
- **C4：`scripts/needs-review.mjs`。** 读 `git diff --name-only origin/main...HEAD` 和新增的 `.skip` / `.only`，按 §3 输出「普通」或「要验收」，以及命中的路径。路径表写在脚本里。
- **C5：`docs/release-smoke.md`。** 发版冒烟清单，不超过十步。至少包括：
  - 首次打开；
  - 选存放位置；
  - 今天页记一条；
  - 问问没有 Key 时的提示；
  - 生成手机快照；
  - 退出再打开，资料还在。
- **C6：PR #15。** 按审查意见改两处：
  - 第一次找到 iPhone 写的那条时，不改动它；
  - 查找出错时，下次再找。

  然后把它作为第一个走 §5 的 PR，验收人 Claude Code 用 C3 的测试日历实跑。
- **C7：AGENTS.md 加指引。** 第 4 条加一句「开发流程见 `docs/guides/dev-workflow.md`」。属于要验收，由你点头。

**Grok Bot：**

- **G1：更新决定表。** 在 HANDOFF §4 把 D3、D10 标为作废，写明取代者；补进附录里的决定。
- **G2：写任务卡。** 把正在进行的工作写成 GitHub issue，至少包括 PR #15、iPhone v0.6、CodeBuddy ACP（`codex/codebuddy-acp` 分支）。
- **G3：每天 07:30 汇总。** 内容：
  - 昨天推进或合并了什么；
  - 哪些 PR 在等验收、哪些在等你点头；
  - main 上 `pnpm check` 是否通过。
- **G4：转达「停」。** 你在任何地方说「停」，转告所有在干活的 Agent：停止推送，报告各自的分支和未提交的改动。

## 附：待补进决定表的决定

| 日期 | 决定 | 出处 |
|---|---|---|
| 10-16 | 私有项目整体删除；10-18 确认不恢复 `local_only` | 提交 `d00584f`；10-18 对话 |
| 10-18 | 小说等资料可以放在云盘。首次使用时说清数据存在哪、哪些内容会发给 AI。加按文件夹的「不发给 AI」开关：经过开图的出口统一拦截；直接读云盘或磁盘的 AI 拦不住，要如实说明；开关只有用户能关；字段规范待定 | 10-18 对话 |
| 10-18 前 | 做 iPhone 端（取代 D10），细节见该文件 §2 | `docs/handoff-2026-10-18-architecture.md` |
| 10-18 | 手机确认的日程由 iPhone 写进 Apple 日历，电脑只记状态；Mac 在日历里找到那条后，可以在电脑上改时间 | PR #14；PR #15 |
| 10-18 | 旧版手机操作账本的兼容代码不加回（该格式从未发布） | 10-18 对话 |
| 10-18 | Apple Watch 排在 v0.7 之后，只做手腕上的快捷操作 | `docs/mobile/product.md` §8 |
| 10-18 | 现在不配云端 CI，满足本文件 §9 的条件再配 | 本文件 |
