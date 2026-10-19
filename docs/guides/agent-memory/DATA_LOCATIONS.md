# 个人内容放在哪里

沿用开图现有模板与 schema，不新增个人记忆格式。模板默认不含任何项目、不带虚构偏好或目标。

| 内容 | 既有位置与规则 |
|---|---|
| 用户愿意保存的低敏感背景、当前情况 | me/profile.md 对应段落；未知留空，不从机器用户名推断 |
| 语言、回答长短、沟通方式等稳定偏好 | memory/preference_<slug>.md，使用 memory.schema.json；MEMORY.md 只加索引，不另复制同一事实 |
| 其他长期事实、上下文、人物、决定 | memory/<type>_<slug>.md，type 仅 preference/fact/context/person/decision；有对应模块的事实优先写模块 |
| 用户明确的目标 | me/goals.json，初始 []；每项既有必填 id/title/status，status 为 active/paused/done/dropped，可选 area/priority/metric/target/due；不猜截止日或量化指标 |
| 作息、可执行约束和时区 | me/rules.md，YAML frontmatter 含 IANA timezone，其他字段只保存用户已设定约束；goal_priority 可空，不预填健康或工作安排 |
| 正在考虑的事 | me/ongoing.json，初始 []；实际添加时遵循既有 ongoing.schema.json，不用它代替目标或项目 |
| 可选项目 | projects/<slug>/STATUS.md、log.md、notes.md，沿用 status.schema.json 与日期日志；零项目时只保留 projects/module.json |
| 还未采纳的内容和接续 | inbox/agents/*.note.md 与 handoffs/，沿用既有格式，不冒充正式记忆 |

记忆条目沿用 YAML frontmatter 必填 type/name/text/created/updated，可选 source/sensitive；created/updated 为真实日期，source 引用用户当前确认或实际资料来源。memory/MEMORY.md 每条一行 `- [类型] 名称 —— 一句话（文件名）`。个人内容写入前的一次合并预览同时覆盖偏好、目标、规则与上传范围；后续修改 goals/rules/ongoing 仍遵守用户确认规则。普通后续 Agent 不擅改这些正式文件。

不要把密码、token、完整证件、金融/健康明细等秘密加入默认共享范围。当前只提供资料子集，不声称未安装的整理器或自动提取已启用。零项目、零目标、零条目也可以完成骨架与入口；用户选择稍后补充时无需反复追问。
