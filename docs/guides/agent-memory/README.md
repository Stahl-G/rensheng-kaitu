# 开图项目记忆：复制一次，由 Agent 完成

把 [短初始化入口](COPY_TO_YOUR_AGENT.md) 交给能操作文件和终端的 Agent；它会自动检查工具与现有登录、发现项目候选、读取所选项目上下文并生成带来源的摘要。已经指定项目就不再问。上传前只合并确认一次目标和文字范围，不让你填写项目现状或逐项批准普通只读。

[完整初始化规则](INSTALL.md) · [新 Agent 接入](ADD_DEVICE.md) · [实际使用顺序](USER_TEST.md)

默认 PRIVATE `kaitu-ai-memory` 和新的本机记忆目录，可接入多个选中项目。已有任何仓库或非空目录都保留，不覆盖、不自动迁移。官方新增授权、工具安装和系统权限正常处理，不绕过审批。已有实际可用 kaitu 入口就复用，没有则用普通 Git 和官方 gh；不要求 App、Node、Python、MCP 或新 runtime，不假设 npm/npx 已发布，不改全局配置。

## 同一份资料

[template/](template/) 只使用开图已有目录与字段：AGENT-README、OVERVIEW、projects/<slug>/STATUS.md/log.md/notes.md、memory/MEMORY.md、inbox/agents/、handoffs/ 和薄入口。选中的每个项目有自己的 slug；只保存确认的文字摘要与来源，不复制代码目录，不建立根 USER/MEMORY/PROJECTS 平行体系。kaitu-backup.json 沿用 kaitu-workspace v1、text=true/records=false。

初始化助手创建初始项目快照。普通 Agent 按既有格式追加候选和交接，不擅改正式现状、目标或规则。没有整理员时，较新进度从 handoffs 读取；不宣称自动整理记忆、归档、手机快照或 App 索引已经更新。项目内技能是可选的薄适配，保留现有 AGENTS/CLAUDE/README，不作为接入前提。

新 Agent 自动读取上下文并继续用户已给的任务；接入不要求先做合成测试或理解考试。只有实际读取、执行、写回和远端回读才能证明接续结果，文件存在或命令成功不能代替。

## 来源与许可

安装、第二设备与薄适配思路参考并改写自 [Cody Qin / shared-ai-memory](https://github.com/CodyQin/shared-ai-memory)：[INSTALL](https://github.com/CodyQin/shared-ai-memory/blob/main/prompts/INSTALL.md)、[ADD_DEVICE](https://github.com/CodyQin/shared-ai-memory/blob/main/prompts/ADD_DEVICE.md)、[shared-memory skill](https://github.com/CodyQin/shared-ai-memory/blob/main/skills/shared-memory/SKILL.md)。其 MIT 署名与许可完整保留在 [LICENSE.shared-ai-memory](template/LICENSE.shared-ai-memory)。目录、权限及 handoff 内容适配开图现有 `overview.ts`、`status.schema.json` 与 `projects.ts`，没有变更数据规范。
