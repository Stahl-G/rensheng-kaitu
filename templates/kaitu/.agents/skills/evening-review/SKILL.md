---
name: evening-review
description: 用户要晚间复盘或回顾今天时，对照计划更新进展、日报并整理记忆。
---

# 晚间复盘

## 步骤

1. 先运行 `kaitu project sync` 同步项目进度，再运行 `kaitu status --json-out`，读取 NOW.md 和各模块 STATUS.md。
2. 运行 `kaitu inbox notes`，逐条把能结构化的内容用 `kaitu record add`、`kaitu memory import --file <候选.json>` 或写简报等写入。
   来源记为笔记里的 agent；混合文件只整理失败条目，合法部分已经写入。
   笔记里的待办（含 *.note.md）用 `kaitu task add --title "待办" [--due 日期或带偏移时间] [--remind-at 带偏移时间] [--project slug]` 转成 task。
   先查 `kaitu task list --all --json-out`，避免把已整理或已完成的事项重复新建；相对日期按笔记日期及用户时区理解，不确定的日期保留待澄清。
   保留笔记的 agent 来源与原路径，用 `kaitu record update task <id> --json` 补 source、notes。
   所有条目整理完成后运行 `kaitu inbox done <路径>`；拿不准的保留待整理，并在日报里列出。
3. 用 `kaitu record list workout --from YYYY-MM-DD --to YYYY-MM-DD` 查看今天训练。
4. 同样查询 meal、sleep、activity；不把没有记录直接判成没有发生。
5. 逐项核对 NOW.md，区分有记录证据、用户说明与尚未核实。
6. 根据 status 的 tasks 提醒用户过期项；仅在记录或用户说明确认完成后用 `kaitu task done <id>`，不因排进计划就标完成。
   只追问会改变完成判断的关键缺口。
7. 保留 NOW.md 原有块 id，按实际更新 done 或 skipped。
8. 记录未完成的具体原因；尚不清楚的原因写待补。
9. 更新相关模块 STATUS.md 的 progress、next、blocked、updated。
10. 保留尚未完成的 next；需要调整目标时提出建议等待确认。
11. 写 `reviews/daily/YYYY-MM-DD.md`，包含完成、偏差、原因与明天下一步。
12. 运行 `kaitu memory list --json-out`，查重复或互相矛盾的记忆。
13. 对照来源和用户最新说明，优先采用已确认的更新，歧义保留待澄清。
14. 用 `kaitu memory update <文件名> --text "合并内容"` 合并条目。
15. 用 `kaitu memory rm <文件名>` 删除已被合并的重复项。
16. MEMORY.md 超过约 3k tokens 时收敛细节，详细信息留在模块或来源中。
17. 通过 memory 命令刷新索引，不手改 MEMORY.md 中的条目链接。
18. 按实际变化刷新 me/profile.md 的简短摘要。
19. 运行 `kaitu validate`，修正结构错误。
20. 最后运行 `kaitu snapshot -m "Agent 完成了晚间复盘"`。

项目回顾包含工作与个人项目的推进、障碍、下一步；仅本机项目的内容留在该项目日志，不写进共享日报、周报或记忆。

## 确认点

修改规则或目标先提出具体建议；批量删除超过 10 条记录先确认。

## 交付

说明实际完成情况、明天保留的下一步与记忆整理结果。
