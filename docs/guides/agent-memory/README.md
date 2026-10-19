# 开图开发者记忆：先用提示词

保留 `my-ai-memory` 作为基准，新建 PRIVATE `kaitu-ai-memory`，由用户亲自启动 Agent 执行。先展示指定真实项目的读取范围，确认后读取并预览摘要，再由用户确认精确目标与文字范围后建库；不复制旧库冒充初始化，不自动迁移。其他 Agent 只接入新库，各用全新会话与独立目录，先比较理解，再做用户指定的真实小任务。

复制 [首位 Agent 的短初始化入口](COPY_TO_YOUR_AGENT.md)，后续使用 [新 Agent 短接入入口](COPY_TO_NEXT_AGENT.md)。完整规则见 [INSTALL](INSTALL.md)、[ADD_DEVICE](ADD_DEVICE.md)，验收顺序见 [USER_TEST](USER_TEST.md)。这里只交付提示词，没有读取或上传真实资料、创建新库或启动模型测试。下面的模板只用于明确确认后的新库，不能覆盖现有私人库。

开图 App、kaitu CLI、特定操作系统、Node、Python、MCP 和后台服务均不是独立模板路径的安装条件。Git/gh 缺失时，由 Agent 说明官方来源，经用户确认后处理；不安装自制 runtime。GitHub 登录只由用户在官方页面/设备流程完成。

已有源码环境则优先复用实际可用入口：先核 `kaitu --help` 或仓库根 `pnpm kaitu --help`；已有编译产物时也可核 `pnpm --dir packages/cli exec node dist/main.js --help`。只使用返回正确帮助的入口，不猜 npm/npx 已发布，不增加另一套 CLI，不自动安装依赖、改锁文件或全局配置。后者依赖用户已经具备的源码工具链；没有它时直接走普通文件＋Git 路径。

## 同一份资料

[template/](template/) 只使用开图已有目录和字段：

- `AGENT-README.md`：接手顺序、两个角色、既有 handoff 格式与只追加边界。
- `OVERVIEW.md`：初始项目摘要；之后读取更新的 `handoffs/`。
- `projects/<slug>/STATUS.md`、`log.md`、`notes.md`：用户确认的初始项目快照，沿用现有 frontmatter 和日志格式。
- `inbox/agents/*.note.md`、`handoffs/<时间>-<agent>-<唯一后缀>.md`：普通 Agent 新建的候选与接续记录。
- `memory/MEMORY.md`：既有索引位置，不自动收集个人记忆。
- `AGENTS.md`、`CLAUDE.md` 和可选项目技能：指向相同事实来源的薄入口，不改用户全局配置，不覆盖已有文件。
- `kaitu-backup.json`：既有 `kaitu-workspace` v1、text=true/records=false 标记；这不是新同步协议。

不创建根 `USER.md`、`MEMORY.md`、`PROJECTS.md` 平行体系，不复制代码目录或扫描所有项目。模板只在全新目标中填入用户确认的一个项目，已有目录或仓库先停下核对。`my-ai-memory` 保留，默认新名 `kaitu-ai-memory` 可改，任何真实建库/上传都须精确确认。

## 已能做与尚未承诺

纯 Git 路径能初始化上述普通文件、同步到用户确认的私库、在另一设备读取项目快照及更新的 handoffs，再追加一份带 follows 的接续；无需运行开图整理器。既有开发检查只用合成资料、fake gh 和本地 bare Git 远端，没有创建真实私人仓库；它不能作为当前真实环境的最终验收。

普通 Agent **不会**自动把 note 候选变成正式记录/记忆，也不持续回写初始 STATUS/log/OVERVIEW、不重算手机快照、不自动归档或刷新 App 索引。这些是既有整理员或 App/CLI 的工作；未启用它们时，最新进度从 handoffs 读取。初始化助手经用户确认在新仓库中写初始 STATUS/log，不代表所有后续 Agent 有权改写它们。可选的 App 导入和视觉结果未由本纯 Git 验证覆盖。

本轮自动验证是文件与 Git/gh 合成业务链，不能替代两个模型 Agent 在用户设备上的真实审批与接续。新 Agent 应引用具体日志/交接复述阻塞和下一步，用户确认后才继续实际任务；不能把技能文件存在或 CLI 成功算成完整接入。

## 来源与许可

安装、第二设备与薄适配思路参考并改写自 [Cody Qin / shared-ai-memory](https://github.com/CodyQin/shared-ai-memory)：[INSTALL](https://github.com/CodyQin/shared-ai-memory/blob/main/prompts/INSTALL.md)、[ADD_DEVICE](https://github.com/CodyQin/shared-ai-memory/blob/main/prompts/ADD_DEVICE.md)、[shared-memory skill](https://github.com/CodyQin/shared-ai-memory/blob/main/skills/shared-memory/SKILL.md)。其 MIT 署名与许可完整保留在 [LICENSE.shared-ai-memory](template/LICENSE.shared-ai-memory)。目录、权限及 handoff 内容适配开图现有 `overview.ts`、`status.schema.json` 与 `projects.ts`，没有变更数据规范。
