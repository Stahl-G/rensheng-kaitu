---
name: evening-review
description: 用户要晚间复盘或回顾今天时，对照计划更新进展、日报并整理记忆。
---

# 晚间复盘

## 步骤

1. 先运行 `kaitu project sync` 同步项目进度，再运行 `kaitu status --json-out`，读取 NOW.md 和各模块 STATUS.md。
2. 用 `kaitu record list workout --from YYYY-MM-DD --to YYYY-MM-DD` 查看今天训练。
3. 同样查询 meal、sleep、activity；不把没有记录直接判成没有发生。
4. 逐项核对 NOW.md，区分有记录证据、用户说明与尚未核实。
5. 只追问会改变完成判断的关键缺口。
6. 保留 NOW.md 原有块 id，按实际更新 done 或 skipped。
7. 记录未完成的具体原因；尚不清楚的原因写待补。
8. 更新相关模块 STATUS.md 的 progress、next、blocked、updated。
9. 保留尚未完成的 next；需要调整目标时提出建议等待确认。
10. 写 `reviews/daily/YYYY-MM-DD.md`，包含完成、偏差、原因与明天下一步。
11. 运行 `kaitu memory list --json-out`，查重复或互相矛盾的记忆。
12. 对照来源和用户最新说明，优先采用已确认的更新，歧义保留待澄清。
13. 用 `kaitu memory update <文件名> --text "合并内容"` 合并条目。
14. 用 `kaitu memory rm <文件名>` 删除已被合并的重复项。
15. MEMORY.md 超过约 3k tokens 时收敛细节，详细信息留在模块或来源中。
16. 通过 memory 命令刷新索引，不手改 MEMORY.md 中的条目链接。
17. 按实际变化刷新 me/profile.md 的简短摘要。
18. 运行 `kaitu validate`，修正结构错误。
19. 最后运行 `kaitu snapshot -m "Agent 完成了晚间复盘"`。

项目回顾包含工作与个人项目的推进、障碍、下一步；仅本机项目的内容留在该项目日志，不写进共享日报、周报或记忆。

## 确认点

修改规则或目标先提出具体建议；批量删除超过 10 条记录先确认。

## 交付

说明实际完成情况、明天保留的下一步与记忆整理结果。
