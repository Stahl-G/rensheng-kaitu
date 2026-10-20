# 在另一台设备或新 Agent 接上共享记忆

用用户的语言和用户交流、写入内容，本说明是中文也一样。

给 Agent 的步骤：

1. 用用户给的仓库地址；没给就看当前账号下的 `kaitu-ai-memory`。确认是私有仓库。
2. 本机已有开图工作区（`kaitu status` 能看到）并已连接这个仓库时，直接用它。否则克隆到 `~/kaitu-ai-memory`（已存在且是同一仓库就 `git pull`；不是就换新目录）。有 kaitu 时用 `kaitu backup restore <仓库> --to <目录> --via gh`。
3. 读 `AGENT-README.md`，有根目录 `SKILL.md` 时按其中当前任务路径读取相关摘要与技能；外部 Agent 是否自动识别根 Skill 取决于运行时。共享记忆模板尚未由开图初始化时，按入口指针读取所需的目标项目或现状。
4. 用几条话告诉用户这次任务所需的已知情况、实际读到的来源和缺口。项目进度是空的，或明显比项目仓库的最新提交旧，就直说，并提出按 INSTALL 第 5 步补上。
5. 接着做用户给的事。做完更新你做过的那个项目的 `STATUS.md`（做到哪、卡在哪、`next`）和 `log.md`，再在 `handoffs/` 写一份交接；档案、偏好和目标不直接改，建议写进 `inbox/agents/`。然后更新手机：有 kaitu 就在仓库目录运行 `kaitu phone run --as <你的名字>`（还不是开图工作区时先 `kaitu init`，已有文件不动）；没有 kaitu 就跳过，开图打开这个仓库时会自动生成。提交并推送（有 kaitu 用 `kaitu backup sync`）；有冲突保留两边，不强推。

仓库根目录没有 `kaitu-backup.json` 时，补一个 `{ "format": "kaitu-workspace", "version": 1, "text": true, "records": true }` 并推送，开图 App 才能接上。
