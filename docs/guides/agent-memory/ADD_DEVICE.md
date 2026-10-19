# 在另一台设备或新 Agent 接上共享记忆

用用户的语言和用户交流、写入内容，本说明是中文也一样。

给 Agent 的步骤：

1. 用用户给的仓库地址；没给就看当前账号下的 `kaitu-ai-memory`。确认是私有仓库。
2. 本机已有开图工作区（`kaitu status` 能看到）并已连接这个仓库时，直接用它。否则克隆到 `~/kaitu-ai-memory`（已存在且是同一仓库就 `git pull`；不是就换新目录）。有 kaitu 时用 `kaitu backup restore <仓库> --to <目录> --via gh`。
3. 读 `AGENT-README.md`，再读 `me/profile.md`、`me/rules.md`、`memory/MEMORY.md`、`OVERVIEW.md`、各项目的 `STATUS.md` 和较新的 `handoffs/`。
4. 用几条话告诉用户你记住了什么：用户是谁、目标、各项目做到哪和下一步。项目进度是空的，或明显比项目仓库的最新提交旧，就直说，并提出按 INSTALL 第 5 步补上。
5. 接着做用户给的事。做完更新你做过的那个项目的 `STATUS.md`（做到哪、卡在哪、`next`）和 `log.md`，再在 `handoffs/` 写一份交接；档案、偏好和目标不直接改，建议写进 `inbox/agents/`。然后更新手机：有 kaitu 就在仓库目录运行 `kaitu phone run --as <你的名字>`（还不是开图工作区时先 `kaitu init`，已有文件不动）；没有就按 [INSTALL.md](INSTALL.md) 第 8 步重写 `phone/today.json` 和 `phone/library.json`。提交并推送（有 kaitu 用 `kaitu backup sync`）；有冲突保留两边，不强推。

仓库根目录没有 `kaitu-backup.json` 时，补一个 `{ "format": "kaitu-workspace", "version": 1, "text": true, "records": true }` 并推送，开图 App 才能接上。
