# 在另一台设备或新 Agent 接上共享记忆

给 Agent 的步骤：

1. 用用户给的仓库地址；没给就看当前账号下的 `kaitu-ai-memory`。确认是私有仓库。
2. 克隆到 `~/kaitu-ai-memory`（已存在且是同一仓库就 `git pull`；不是就换新目录）。有 kaitu 时可用 `kaitu backup restore <仓库> --to <目录> --via gh`。
3. 读 `AGENT-README.md`，再读 `me/profile.md`、`me/rules.md`、`memory/MEMORY.md`、`OVERVIEW.md` 和较新的 `handoffs/`；用到时再读目标和项目。
4. 用几条话告诉用户你记住了什么（偏好、目标、在做的事、下一步），然后接着做用户给的事。
5. 做完按 `AGENT-README.md` 在 `handoffs/` 写一份交接，提交并推送；有冲突保留两边，不强推。
