---
name: kaitu-workspace
description: 在开图个人资料工作区记录、设目标或推进项目时，按当前任务读取和保存。
---

# 开图：做当前这件事

先按用户这次的请求选一条路径，只读相关摘要。写入、隐私与确认边界见 AGENTS.md；云盘投递见 AGENT-README.md。资料缺口只问一个会影响下一步的问题，已知信息直接用。

- **记餐食**：读 `skills/log-meal/SKILL.md`。字段需核对时只查 meal：CLI `kaitu record schema meal`、DSH `kaitu_status` 带 type，或读 `skills/record-format/meal.md`。只查今天相关餐食防重复，需要营养目标时才读 rules.md 的 nutrition，不先读全部档案或模块。
- **设目标**：只读 `me/goals.json` 和用户提到的相关规则、状态；提出具体改动，用户确认后保存，保留其他目标与正文。没有明确方向时用 onboarding 技能先核对一个下一步。
- **推进项目**：读指定项目的 `projects/<slug>/STATUS.md`、需要的日志，按 project 技能记录进展与下一步；云盘 Agent 只更新自己做过的项目。项目不明确时先列项目供选择，链接的源目录只读。
- **其他任务**：只加载 `.agents/skills/<相关技能>/SKILL.md`（`.claude/skills/` 是同步副本），模块特有规则在相关 module.json。了解现状才读 OVERVIEW.md，需要个人背景时再读档案与相关记忆；整理员按 ORGANIZER.md 执行。

完整字段与合法示例按类型读 `skills/record-format/<类型>.md`，查询方法见 record-format 技能。类型不明确时看相关 module.json.records 或 `kaitu record types`；自定义 schema 改动后运行 `kaitu agents-md` 刷新参考。

摘要可能因云盘文件尚未下载而不完整。遇到 CLOUD_UNAVAILABLE 时说明哪些资料暂不可读，不能当作文件不存在；一次说明缺口后停止读取该文件。一次文件读取超时后说明资料缺口并停止读取该文件；不换工具、别名或扫描整目录重试。用户要求重试或文件已恢复可读后再继续。能独立完成的部分继续，未读到的内容保持未知。

写入以工具回执及实际读回为准；有记录与有版本分别说明。云盘创建文件只确认「已投递」，note 只确认「原文已保存」，结构化 meal 处理并回读后才确认「餐食已记录」。结果未知时报告待确认，不重复投递来试探。
