---
name: add-module
description: 用户要求新增自定义模块时，确认用途和导航位置后创建模块定义及状态。
---

# 新增模块

## 步骤

1. 读取现有各模块 module.json，先判断是否已有合适模块。
2. 明确新模块用途、要记什么、下一步如何呈现。
3. 询问是否显示在导航，不能把 Agent 管理模块自动放到首页。
4. 目录与 id 使用同一个小写英文 slug，不与已有目录重名。
5. 在一个简短方案中列出名称、用途、记录类型与 visibility。
6. 用户选定导航方式后创建 <slug>/module.json 和 STATUS.md。
7. module.json 参照已有模块。无结构化记录的读书模块可用下面的最小定义，不需要查找工作区外的 schema 文件。
8. 没有结构化记录需求时不造 schema，records 可为空对象。
9. 有需求时在模块 schemas/ 下写 JSON Schema，引用 record-base.schema.json。
10. 新记录类型与全工作区其他类型不能重名。
11. 记录路径用 data/<type>/{YYYY-MM}.jsonl，不允许 ..。
12. views 只选择 table、kanban、timeline、chart、progress、doc。
13. agent.instructions 写本模块特有的步骤，不重复通用规则。
14. STATUS.md 从真实起点开始，updated 带偏移，next 是能做的下一步。
15. 不把未来计划计入 progress.current。
16. 运行 `kaitu validate <slug>`，修正模块、schema 和状态错误。
17. 运行 `kaitu agents-md`，更新模块入口并同步技能。
18. 用 `kaitu record list <新类型>` 确认记录定义能被发现（有记录类型时）。
19. 运行 `kaitu snapshot -m "Agent 创建了自定义模块"`。
20. 用 `kaitu ui` 设置页检查模块定义与显示方式。

## 最小示例

`reading/module.json`：

```json
{
  "id": "reading",
  "name": "读书",
  "version": 1,
  "visibility": "agent",
  "records": {},
  "views": [{ "type": "doc", "title": "读书笔记", "path": "notes.md" }],
  "agent": { "instructions": "记录读书笔记，把下一步放进 STATUS.md。" }
}
```

`reading/STATUS.md`（updated 替换为用户时区的当前时间，下一步替换为用户选定的行动）：

```yaml
---
updated: "2026-10-15T08:00:00+08:00"
next:
  - id: read-1
    title: 读完第一章并写笔记
    status: todo
---
从第一章开始。
```

## 确认点

先确认模块用途与是否显示在导航；不删除或覆盖已有模块。

## 交付

给出模块路径、记录类型与下一步，说明工作台支持的显示范围。
