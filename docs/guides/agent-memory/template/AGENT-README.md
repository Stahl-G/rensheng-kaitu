# 开图 Agent 入口：纯 Git 初始模板

## 接手顺序

1. 本文件和 me/profile.md、me/rules.md、memory/MEMORY.md。
2. handoffs/daily/ 最新每日整理；没有则读 OVERVIEW.md。
3. handoffs/ 根目录里比它更新的交接，按时间排序；再看相关 inbox/agents/ 候选，候选不等于已采纳事实。
4. 按需读 me/goals.json、me/ongoing.json、me/STATUS.md 和记忆索引链接的条目。
5. 有相关项目时才读 projects/<slug>/STATUS.md、log.md、notes.md；没有项目直接跳过。

这是跨设备、系统和 Agent 的个人共享记忆。空 goals/ongoing 数组、空记忆索引和无项目目录都是有效初始状态。偏好存 memory/preference_<slug>.md 并加入 memory/MEMORY.md，目标存 me/goals.json，规则存 me/rules.md；不要另建 USER.md 或根 MEMORY/PROJECTS 平行体系。

## 两个角色与文件

任何 Agent 都只在 inbox/agents/ 和 handoffs/ 根目录新建唯一文件，不覆盖、删除、移动原文件，不擅改个人档案、正式记忆、目标、规则、STATUS/log 或初始摘要。初始化助手仅在新仓库中、一次内容确认后创建初始个人档案、记忆、目标/规则及可选项目 STATUS/log；这不是后续 Agent 的持续写权限。没有指定整理员就保留候选与交接，通过接手顺序接续；不自动整理、不生成手机快照。

用户指定的整理员应遵守既有 ORGANIZER.md 的权限；此最小模板未安装或启用整理员。正式记忆提炼、收件箱转换、手机快照、App 派生索引和自动归档都不在本轮承诺内。

## 交接记录

沿用开图已有格式，在 handoffs/<YYYYMMDDTHHMM>-<agent>-<唯一后缀>.md 新建：

```markdown
---
agent: example-agent
at: 2026-10-19T09:30:00+08:00
follows: handoffs/20261019T0900-previous-agent-a1b2.md
---
## 做了什么
- 改动、失败尝试、实际结果；引用具体来源文件、提交或用户确认内容。
## 当前下一步
- 写完整清单，注明对应项目；建议与已确认任务分清。
## 未决 / 需要用户
- 阻塞、冲突、尚未授权或尚未验证的事项。
```

follows 可省略；有前序交接则填真实相对路径。两份交接接续同一前序时，两份都读，不静默丢弃一方。时间使用实际时区偏移，不照抄示例日期。格式不确定的候选原文写 inbox/agents/<agent>-<时间>-<唯一后缀>.note.md；不改变原文或假称已转成记录。

## Git 与隐私

只使用用户指定的私人记忆仓库。创建、首次连接和更换远端时用官方 GitHub 工具核对 PRIVATE；后续同步沿用已确认政策，不反复索要或扩大授权。先检查 git status，有未提交修改则保护并说明；干净时安全拉取。只暂存明确列出的新增记忆文件，检查暂存 diff，不 git add 整个代码项目。正常推送并核验远端提交；冲突保留双方，不强推、不 hard reset、不删除重来。

不索取、读取或打印 token、密码、验证码、Cookie、钥匙串内容或私钥；登录由用户在 GitHub 官方流程完成。不读取其他项目、浏览器资料或整盘目录。项目代码和已有 AGENTS/CLAUDE/README 保持原状；不改全局 Agent 或 Git 配置。
