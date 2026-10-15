---
name: weekly-review
description: 用户要求周复盘或到每周回顾时，汇总一周证据并调整下一步。
---

# 周复盘

## 步骤

1. 先运行 `kaitu project sync` 同步项目进度，再运行 `kaitu status --json-out`，确定用户时区与当前进度。
2. 先明确这一周的起止日期，默认用户时区的周一到周日。
3. 读取期间的 reviews/daily/，以及 NOW.md 的当前计划。
4. 用 `kaitu record list workout --from 起日 --to 止日 --json-out` 查询训练。
5. 按相同日期查询 meal、sleep、metric 与 event。
6. 同一次训练按 session_id 合并，别把每个动作算成一次训练。
7. 蛋白质按天先求和，再计算有记录日期的平均值。
8. 睡眠说明覆盖日期，未记录日不算零小时。
9. 阅读各模块 STATUS.md，对照 goals.json 的当前目标。
10. 区分已完成、搁置、计划改变与数据缺失。
11. 从日报与 `kaitu chats search "关键词"` 中补充偏差原因。
12. 为每个重要判断注明记录日期或对话路径。
13. 只选下周最重要的几个 next，估计时间并检查规则约束。
14. 更新模块 STATUS.md，保留尚未解决的 blocked。
15. 写 `reviews/weekly/YYYY-Www.md`，周编号用 ISO 周。
16. 报告目标进展、主要障碍、下周动作与需要用户决策的事项。
17. 不把一次异常波动写成长期趋势。
18. 运行 `kaitu validate`。
19. 运行 `kaitu snapshot -m "Agent 完成了周复盘"`。

项目回顾包含工作与个人项目的推进、障碍、下一步；仅本机项目的内容留在该项目日志，不写进共享日报、周报或记忆。

## 确认点

规则与目标变更先确认；日常下一步更新可直接保存。

## 交付

给出本周进展与下周最重要的行动，说明数据覆盖。
