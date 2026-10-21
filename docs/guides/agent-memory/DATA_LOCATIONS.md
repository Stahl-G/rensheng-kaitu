# 内容放在哪

格式和开图工作区一样。

| 内容 | 位置 |
|---|---|
| 背景、现在在做什么 | `me/profile.md` |
| 偏好（语言、回答长短等） | `memory/preference_<slug>.md`，并在 `memory/MEMORY.md` 加一行索引 |
| 其他长期事实、人物、决定 | `memory/<type>_<slug>.md`，type 为 preference/fact/context/person/decision |
| 目标 | `me/goals.json`（id、title、status，status 为 active/paused/done/dropped） |
| 作息、约束、时区 | `me/rules.md`（frontmatter 里的 IANA `timezone`） |
| 正在考虑的事 | `me/ongoing.json` |
| 项目 | `projects/<slug>/STATUS.md`、`log.md`、`notes.md`，可参考 [examples/project](examples/project/) |
| 还没采纳的内容、交接 | `inbox/agents/*.note.md`、`handoffs/` |

项目 `STATUS.md` 的 `updated` 要写带时区的完整时间（如 `2026-10-19T09:30:00+08:00`），不能只写日期。`next` 每项是对象，例如 `next: [{id: export-csv, title: 确认字段顺序后实现导出, status: todo}]`，不能直接写字符串列表；没有下一步时用 `next: []`。

记忆条目的 frontmatter：type、name、text、created、updated，可选 source、sensitive。`memory/MEMORY.md` 每条一行：`- [类型] 名称 —— 一句话（文件名）`。密码、token、证件号不要放进来。
