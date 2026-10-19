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

记忆条目的 frontmatter：type、name、text、created、updated，可选 source、sensitive。`memory/MEMORY.md` 每条一行：`- [类型] 名称 —— 一句话（文件名）`。密码、token、证件号不要放进来。
