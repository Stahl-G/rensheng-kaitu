---
name: project-review
description: 每天收工或用户问「这个项目今天怎么样」时，按代码仓库的 PR、issue、提交、Star 和路线图整理项目日报，写进项目日志并更新项目页视图。
---

# 项目日报

只整理绑定了 GitHub 或关联了代码仓库的项目。代码仓库只读：不改代码，不评论 PR / issue，不改目标。

## 1. 读事实

1. `kaitu project sync <slug>`：拉 Star、Fork、开放 PR / issue、默认分支 CI 和最近提交；`kaitu project show <slug> --json-out` 读 STATUS、日志和现有 view.json。
2. 有 `gh` 且已登录时，按用户时区的今天（YYYY-MM-DD）读明细；仓库名用项目绑定的 owner/repo：
   - `gh pr list --repo <repo> --state merged --search "merged:>=<今天>" --json number,title,url,labels`
   - `gh pr list --repo <repo> --state open --json number,title,url,isDraft,updatedAt`
   - `gh issue list --repo <repo> --state all --search "updated:>=<今天>" --json number,title,state,labels,url`
   没有 `gh` 或没权限时只用 sync 的快照，并在日志里写明「未读 PR 明细」。
3. 路线图：读仓库里已有的路线图或交接文档（如 ROADMAP、HANDOFF、README 的里程碑），只用文档里写明的里程碑和完成情况，不自己编阶段。
4. 架构图：仓库里有用户指定工具生成的架构图文件时，看今天的提交是否改过它；改过就在日志里写一句改了哪里，并在视图里放它的链接。没有就跳过，不自己画。

## 2. 写一条日志

`kaitu project log <slug> --text '…' --by agent`，一条，分四段，每条都带 PR / issue 号或提交作为出处：

- 今天：合了哪些 PR、修了哪些 bug、新开了什么；
- 变化：Star / Fork 增减、CI 由绿变红或由红变绿、架构图变化；
- 卡点：还开着的阻塞问题、红着的 CI；
- 明天：建议先做什么（只是建议，不写进 STATUS 的 next）。

当天已经写过日报时，用同样的四段补充新内容，不重复已有的条目。

## 3. 更新项目页视图

在 `projects/<slug>/view.json` 里只更新 id 以 `daily-` 开头的积木，保留用户和别的 Agent 已有的积木与顺序；没有 view.json 时新建，标题用项目名。

- `daily-today`（note）：今天的一句话总结，结尾写日期；
- `daily-roadmap`（milestones）：路线图里程碑，`done` 按文档；
- `daily-fixes`（table）：列 `number` 编号、`title` 标题、`kind` 类型（bug / 功能 / 文档）、`state` 状态，只放今天合并或关闭的；
- `daily-open`（table）：同样的列，放还开着的 PR，草稿标「草稿」；
- `daily-links`（links）：今天提到的 PR / issue / 架构图链接，只用 HTTP / HTTPS。

格式见 project 技能的「自定义项目视图」；写入后运行 `kaitu validate`，有错就改到通过。

## 交付

用三句话告诉用户：今天做成了什么、卡在哪、明天建议先做什么，并说明哪些信息因为没权限没读到。
