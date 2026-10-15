# 任务：阶段 2 第 1 项——早间计划与晚间复盘自动运行（开图 kaitu）

先读 `docs/HANDOFF.md` §0、`docs/PRD.md` §7.4 与 §10 阶段 2、`docs/dsh.md`、`packages/dsh-plugin/src`、工作区模板里的 `morning-plan` 和 `evening-review` 技能。DeepSeek Harness 0.2.0-rc.2 源码在 `<DSH 源码目录>`，必读 `docs/user/guide/schedule.zh.md`、`packages/schedule/README.zh.md`、`docs/user/guide/mcp-memory.zh.md`。不联网、不提交、不加依赖。

## 目标
不用用户开口：每天 07:30 生成今天的计划（`NOW.md`，含日历日程与训练日 / 休息日建议），22:00 复盘（各模块 `STATUS.md`、日报）。时间可改。

## 要做
1. 弄清 rc.2 的 Schedule 机制：怎样启用（插件管理里的「自动化任务」/ schedule bundle）、提醒投递到哪个会话、投递后模型是否自动执行，还是只往收件箱放一条消息。把结论和源码依据写进汇报。
2. 选最简单可靠的方案实现：
   - 首选：`kaitu dsh --install` 顺带启用 schedule，并预置两条每日任务（指令分别是「按 morning-plan 技能生成今天的计划」「按 evening-review 技能复盘今天」，时区取工作区时区）。重复运行不能重复创建。
   - 如果 rc.2 无法用配置预置，就给插件加一个工具 `kaitu_setup_schedule`，在会话里由模型调用 `schedule_create` 完成；`docs/dsh.md` 写清用户只需说「帮我设好每天的计划和复盘」。
   - 早间计划和复盘需要的能力如果插件四个工具不够（例如生成 `NOW.md`、写 `STATUS.md` 和日报），在插件里补最少的工具，复用 core 现有函数，不重写逻辑。
3. 日历：PRD 要求通过 MCP 接日历。先确认开图现有 `.ics` 导入能否满足早间计划；能满足就不接 MCP，在汇报里说明。
4. 文档：`docs/dsh.md` 加「每天自动计划与复盘」一节；HANDOFF §0.4 第 1 项与 GOAL 更新一句。

## 测试（只写必须的）
新增工具最多一个测试（临时工作区上调用，产物通过 validate）。不 mock dsh 内部，不断言文案。

## 完成标准
`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 全部通过；中文简短汇报：机制结论与依据、做了什么、用户还要点哪里、哪些只能真机验证。
