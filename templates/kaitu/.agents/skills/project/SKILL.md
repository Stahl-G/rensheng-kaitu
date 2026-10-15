---
name: project
description: 新建个人或工作项目、记录进展、更新下一步，或查询与回顾项目推进情况。
---

# 项目

项目内容在链接的本机文件夹里，只读。开图只保存 STATUS、背景笔记、进展日志、字数与提交标题。

## 新建与链接

先用 `kaitu project list --json-out` 检查已有项目。补齐标题、工作还是个人、是否仅本机、链接哪个文件夹；
写作项目还需明确正文子目录，避免把大纲、备份当作正文。已知的信息不重复询问。
用 `kaitu project new --title "标题" --kind work|personal [--local-only]` 建档。
用 `kaitu project link <slug> <绝对路径> --role manuscript|repo|folder [--include "正文/**/*.md"]` 添加链接。
阅读链接文件夹里的 README、AGENTS.md 了解背景，遵守其读取约定，不修改其中的任何文件。

## 记录与下一步

用 `kaitu project log <slug> --text "实际进展"` 记录。背景、要点、相关人写入项目的 notes.md。
先 `kaitu project show <slug> --json-out` 取得 STATUS 正文、frontmatter 与日志。
更新 STATUS 的 progress、next、blocked、updated 时保留其他字段与正文，next 沿用通用格式。
普通项目的 Markdown 更新后运行 `kaitu validate`，再保存一个版本。
Drive 模式下仅本机项目用 `project show` 读取，位置由 core 解析；下一步用
`kaitu project set <slug> --next-json '[{"id":"p1","title":"具体动作","status":"todo"}]'` 更新。
阶段变更用 `kaitu project set <slug> --stage idea|active|paused|done`。
隐私范围按用户选择用 `--local-only` 或 `--no-local-only` 切换，不把本机项目信息写入共享计划、复盘或记忆。

## 查询与回顾

用户问「XX 推进到哪了」时，先 `kaitu project sync <slug>`，再 `project show` 与 `project list`。
结合 STATUS、日志与近 7 天字数变化 / 提交数，说明进展、障碍、下一步及链接读取问题。
字数和提交数只代表对应活动量，完成判断以 STATUS、日志和用户说明为准。
每周项目回顾先 `kaitu project sync`，逐项核对工作与个人项目，保留未解决的障碍与未完成的下一步。
本机项目回顾保留在该项目的 notes.md / log.md，分享范围内的项目才进入共享周报。
