---
name: monthly-review
description: 用户要求月复盘或月度现状分析时，汇总整月并在数据足够时分析长期变化。
---

# 月复盘

## 步骤

1. 运行 `kaitu status --json-out`，明确用户时区和待复盘月份。
2. 默认复盘刚结束的自然月，先写清起止日期。
3. 读取 reviews/weekly/ 与 reviews/daily/ 的相关内容。
4. 用 `kaitu record list workout --from 起日 --to 止日 --json-out` 查训练。
5. 同样查询 meal、sleep、metric，计算每项覆盖天数。
6. 读取 me/goals.json、me/rules.md 与各模块 STATUS.md。
7. 对照目标衡量真实变化，区分过程投入与结果变化。
8. 不同月份比较时说明天数、来源和记录覆盖是否一致。
9. 体态照片用 `kaitu photo list`，引导在 `kaitu ui` 身体指标页按日期对比。
10. 不从照片单独推断精确体脂率或诊断。
11. 从日报、周报和对话中查找反复出现的阻碍。
12. 写 `reviews/monthly/YYYY-MM.md`，包括进展、偏差、原因与下月动作。
13. 满两个自然月且有可比数据时，写 `me/reports/YYYY-MM.md` 现状分析。
14. 不足两个月时，只写月度观察与待补数据，不编造长期趋势。
15. 更新模块 STATUS.md 的进度和下一步。
16. 若需调整规则、目标或优先级，列出具体改动供用户确认。
17. 确认后再更新 me/rules.md 或 me/goals.json。
18. 运行 `kaitu validate`。
19. 运行 `kaitu snapshot -m "Agent 完成了月复盘与现状整理"`。

## 确认点

目标与规则调整须确认；未经确认的调整保留为建议。

## 交付

给出一个月的变化、覆盖边界与下月重点。
