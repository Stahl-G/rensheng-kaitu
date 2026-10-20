# Agent 入口

## 按当前任务读取

开图初始化后按短 AGENTS.md 的任务路由读取；这个共享记忆模板只读取本次目标项目与相关交接，不先读全部资料。
尚未由开图初始化、缺少格式技能时，报告缺口；项目任务仍可只读目标项目的 STATUS.md 与相关日志，了解现状才读 OVERVIEW.md。

## 写入

- 做了某个项目的事，就更新这个项目：`projects/<项目>/STATUS.md` 的正文（做到哪、卡在哪）和 `next`，在 `log.md` 记一条，写明对应哪份交接。只改自己做过的项目。
- 档案、偏好、目标、规则（`me/`、`memory/`）不直接改；想法和建议写进 `inbox/agents/`，等用户确认。用户明确让你改的，照做。
- 结束前新建一份交接；能运行 `kaitu` 就再跑 `kaitu phone run --as <你的名字>` 更新手机内容。

交接文件 `handoffs/<YYYYMMDDTHHMM>-<agent>.md`：

```markdown
---
agent: example-agent
at: 2026-10-19T09:30:00+08:00
follows: handoffs/20261019T0900-previous-agent.md
---
## 做了什么
## 当前下一步
## 未决 / 需要用户
```

`follows` 有前一份相关交接时才写。原话用唯一的 `inbox/agents/<agent>-<时间>.note.md` 保存；保存原文不等于记入餐食。结构化餐食交 `*.records.jsonl`，只能确认投递时说「已投递」，处理结果与 meal 回读核对后才说「餐食已记录」。拿不准字段时先查该类型格式，不猜后续会自动转成记录。

## Git

改之前先 `git pull`；只提交自己改过和新建的文件；冲突保留两边，不强推。
