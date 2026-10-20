---
name: record-format
description: 需要记录字段或收件箱格式时，只查当前记录类型的约束和合法示例。
---

# 查询记录格式

已知类型时，CLI 用 `kaitu record schema <类型>`，DSH 用 `kaitu_status` 带 type。
只能读写云盘时，读 `skills/record-format/<类型>.md`，如 `meal.md`；这些参考由实际 schema 生成。
类型不明确时，先看相关模块 `module.json` 的 records，或用 `kaitu record types`。
MCP 的 `record_types` 返回全部类型的字段与示例，只在没有单类型入口时使用。

CLI `record add --json` 只传该类型示例中 type 以外的字段；云端 records.jsonl 每行保留 type。
记录查询和修改用现有专用工具，ID、修订、时间与来源按返回的格式说明处理。
自定义模块或 schema 修改后运行 `kaitu agents-md` 刷新参考；云端遇到缺失参考时报告缺口，不猜字段。

一次读取超时后停止读取该文件，说明缺少的资料；不换工具或路径重复读取。
