---
name: morning-plan
description: 用户说早上好或要求安排今天时，按规则和已有日程生成待确认计划。
---

# 安排今天

## 步骤

1. 运行 `kaitu status --json-out`，读取今天已有块与各模块下一步。
2. 依次读 `me/rules.md`、`me/goals.json`、各模块 `STATUS.md` 的 next。
3. 按 rules.md 的 timezone 确定今天日期和当前时间。
4. 运行 `kaitu record list event --from YYYY-MM-DD --to YYYY-MM-DD --json-out`。
5. 跨午夜日程同时检查前一天开始的事件，按 start/end 判断今天是否相交。
6. 运行 `kaitu record list sleep --json-out`，读昨晚实际睡眠与醒来时间。
7. 运行 `kaitu record list workout --json-out`，定位最近一次真实训练日期。
8. training.pattern 为 alternate-days 时，按最近训练日推算隔天训练和中间休息日。
9. 没有历史训练时，提出从哪天起算的建议，别声称今天必然是训练日。
10. daily、weekdays 按对应频率；custom 缺少具体规则时只提出候选。
11. 按目标优先级与 next 的 priority、due、estimate 选择可执行任务。
12. 开始不早于规则起床时间、实际醒来时间和当前时间中的最晚值。
13. 结束不晚于 no_tasks_after，避开已有日程和规则中固定占用时间。
14. 保留今天已有的 confirmed、done 与拒绝记录，避免重复提议。
15. 把已有日历事件写为 kind: event、status: confirmed。
16. 新建议写为 kind: proposal、status: pending，并提供 start/end、module 与已知 ref。
17. NOW.md 的 date 用今天，generated_at 带时区偏移；正文解释训练日与睡眠的影响。
18. 不把建议直接改成已确认，不写外部日历。
19. 直接写 `NOW.md` 后运行 `kaitu validate NOW.md`，修正错误。
20. 运行 `kaitu snapshot -m "Agent 提出了今天的计划"`。
21. 引导用户用 `kaitu ui` 在今天页确认或拒绝建议。

## 确认点

日程建议保留 pending，用户确认后才可写外部日历。

## 交付

给出今天重点、建议数量与冲突或资料缺口。
