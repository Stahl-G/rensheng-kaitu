---
timezone: Asia/Shanghai
sleep: { start: "23:30", end: "07:30" }
work_hours: { start: "09:30", end: "19:00", days: [1, 2, 3, 4, 5] }
no_tasks_after: "22:00"
training: { pattern: "alternate-days", duration_min: 40, preferred: "evening" }
nutrition: { protein_g: [140, 150], deficit_kcal_max: 600 }
goal_priority: []
---
# 作息与规则

上面是 Agent 排日程时必须遵守的约束，可以直接改。

- `days` 里 0 是周日、1 是周一。
- `training.pattern`：`alternate-days`（隔天练）、`daily`、`weekdays`、`custom`。
- 其他要求用文字写在这里，例如「周三晚上固定陪家人，不排任务」。
