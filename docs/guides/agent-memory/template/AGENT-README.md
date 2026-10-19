# Agent 入口

## 接手顺序

1. 本文件、`me/profile.md`、`me/rules.md`、`memory/MEMORY.md`。
2. `handoffs/daily/` 最新一份；没有就读 `OVERVIEW.md`。
3. `handoffs/` 根目录里比它新的交接，按时间读；`inbox/agents/` 里是还没采纳的候选。
4. 用到时再读 `me/goals.json`、`me/ongoing.json` 和相关项目的 `STATUS.md`、`log.md`。

## 写入

只在 `inbox/agents/` 和 `handoffs/` 新建文件，不改别的文件。交接文件 `handoffs/<YYYYMMDDTHHMM>-<agent>.md`：

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

`follows` 有前一份交接时才写。拿不准格式就写 `inbox/agents/<agent>-<时间>.note.md`。

## Git

改之前先 `git pull`；只提交自己新建的文件；冲突保留两边，不强推。
