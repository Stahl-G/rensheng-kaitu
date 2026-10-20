# 交接：底层架构升级与 iPhone 端（2026-10-18）

给接手的本地 agent。云端会话写完了规范与格式定义，代码一行未写，由你分派 Codex 实现。
分支 `claude/product-analysis-north-star-z6g5gu`（基于 main `119a3b9`，比 main 多两个文档提交）。按 AGENTS.md 开发约定执行。

## 1. 已完成、可直接用

| 文件 | 内容 |
|---|---|
| `docs/proposals/2026-10-18-data-spec-v2.md` | 底层架构升级规范：投入、阶段、尝试与打卡、手机读写。用户 2026-10-17 已确认概念 |
| `docs/mobile/product.md` | iPhone 端产品规范：合上管今天、展开看人生；窄屏 / 宽屏；记一下；问问；版本与验收 |
| `docs/mobile/architecture.md` | iPhone 端架构：电脑生成 `phone/` 快照，手机只新建收件箱文件；存储层；电脑端 D1–D5、iOS 端 I1–I9；时间表 |
| `schemas/phone-{today,week,map,receipts,action}.schema.json` | 手机读写格式（契约） |
| `schemas/fixtures/phone/` | 样例；`packages/core/test/phone-contract.test.ts` 校验样例符合 schema。iOS 端用同一批样例做解码测试 |

## 2. 用户已拍板的决定

- 投入：领域工作 / 学习 / 个人（爱好放个人资料，不单列入口）× 形式长期投入 / 项目；工作日常算长期投入；记录统一可标所属投入。
- 尝试可挂在任何地方（方向、任一投入、或都不挂）。
- 贝叶斯曲线只算「按计划做到的比例」及区间（Beta），不算效果、不下因果结论。
- 不做每日心情打分；阶段由 AI 从资料变化中发现后提议，用户回一句回顾才算数。
- 手机 v0.6 是电脑的伙伴，但架构要留出以后独立使用（界面只依赖快照与写入格式）。
- 手机要做问问（自带 Key，可产生费用），预留付费版接口；v0.6.1 交付。
- 存储：GitHub 与 iCloud 都要支持（GitHub 备份已在 main，PR #9）。
- 折叠屏布局进 v0.6，赶 2026-10-23 iPhone Duo 发售（已核实：10-16 预购、10-23 发售；多数订单交货排到 1 月）。

## 3. 待实现（按顺序）

### A. 数据规范升级（本仓库）——规范 §1–§3、§5 第 1 项

- 项目 `kind` 加 `learning`（`schemas/status.schema.json`、`projects.ts` 映射、所有显示「工作 / 个人」的地方）。
- `me/ongoing.json` + `schemas/ongoing.schema.json`；与 `me/goals.json` 同等（用户维护，Agent 先提议）。
- `record-base.schema.json` 加可选 `investment`（`project:` / `learning:` / `ongoing:` 引用）；待办 `project` 视为 `project:<slug>`；原文 frontmatter 可带 `investment`。
- core `listInvestments`、`investmentOf`；`kaitu doctor` 提示悬空引用；CLI `kaitu investments`；MCP / DSH 只读工具。
- `phase` 记录（me 模块 `data/phases/{YYYY-MM}.jsonl`），写入入口检查：Agent 只能建 suggested、不能确认或写 reflection；带预期修订号。本次不加 Agent 指引和界面。
- `exploration_experiment.direction_id` 改可选、加 `investment`；新记录 `exploration_checkin`（explore 模块 `data/checkins/{YYYY-MM}.jsonl`），`writeExploration` 加 `create_checkin`；修好所有假定有 `direction_id` 的地方。
- 纯函数 `completionRate(checkins)`：Beta(1+做到, 1+没做到) 的 10% / 90% 分位，放浏览器可用的 core 子路径导出（参照 `./experience-time`）。
- PRD §6、模板 `module.json`、AGENTS.md 生成模板（投入标注、尝试挂投入、ongoing 需确认）同步；提高模板版本，验证 `kaitu upgrade`。

### B. 手机同步的电脑端（本仓库）——架构 §3、§4、§6 D1–D3

- D1：把 `progressRows`、`journeyRoutes` 从 dsh-plugin 前端移进 core（浏览器可用子路径）；`buildPhoneToday/Week/Map` 纯函数投影已有读数；`writePhoneSnapshots` 后台防抖、只在手机能读到时写、内容不变不写；`phone/` 加入 `NOT_MODULES`、排除本机版本历史、Agent 只读；不含财务明细、敏感记忆、Key、绝对路径。
- D2：`workspace-backup.ts` 连接后始终同步 `phone/`（上传）与 `inbox/agents/`、`inbox/health/`（拉下手机新文件；电脑处理后删远端），不受开关影响；照片（二进制）暂不做。
- D3：`inbox/agents/ios-<8位>-<ULID>.*`：`.note.md`（`kind: capture`）收作原文；`.records.jsonl` 的 `origin` 映射 `by`；新 `.actions.jsonl` 执行 `complete_next`、`decide_proposal`、`complete_task`、`cancel_task`（其余预留 op 记 rejected），先核对前提、按 `client_id` 去重；写 `phone/receipts.json`。
- 文档：`docs/guides/phone-contract.md`、PRD §6 新增小节、`docs/github-workspace-backup.md`、必要时隐私页；在合成大工作区实测耗时，结果写在 PR 描述里。

A 与 B 可并行，注意都会改 PRD §6、`agents-md.ts`、`index.ts`；B 不依赖 A。

### C. iOS（`~/kaitu-ios`）——架构 §7

v0.6.0（10-22 提交 TestFlight）：I1 KaituKitData（按 schema 的 Codable + 样例解码测试、`WorkspaceStore` iCloud / GitHub、缓存、离线队列、回执叠加）→ I2 size class 布局（窄屏 TabView、宽屏 NavigationSplitView、展开合上保留状态、MapKit 进度图）→ I3 今天 / 开图 → I4 记一下（文字、语音）→ I6 设置 → I7 发布（先 `xcrun simctl list devicetypes` 核对 iPhone Duo 模拟器）。I5 操作（完成下一步、确认日程）争取进 v0.6：确认日程由手机用 EventKit 写进「开图」日历再交 `decide_proposal`，电脑只记状态（已实现电脑端）。
v0.6.1：I8 问问（`ChatProvider`，OpenAI 兼容、DeepSeek 默认，Key 存钥匙串，`ProProvider` 占位）、I9 App Intents 与小组件。
I1 现在就能开始，不必等 A、B。

## 4. 验收要点

- 全量 `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test`；已知 root 环境下 `packages/cli/test/status.test.ts` 一条失败，需确认是原有的。
- 旧工作区不改动直接可用；升级后得到新记录类型与新 AGENTS.md。
- 快照与样例都符合 schema；手机原文与操作经收件箱处理后写回执；同一操作只执行一次。
- 只加防真实错误的测试（HANDOFF §8）。只用合成资料，不碰真实工作区与凭据。
- 数据规范改动需用户在 PR 里点头。

## 5. 其他未完事项

- 用户自己的 `.git` 不被接管：已在 main（PR #9）。
- 官网：iPhone 端发布后在 kaitu.si 加 iPhone 介绍（gh-pages，`tools/stamp.py` 后推送）；当前站点已按系统区分 Windows / macOS 入口。
- 产品功能（一周近况、尝试回看、阶段对照的界面）待用户继续讨论，不在本次范围。
