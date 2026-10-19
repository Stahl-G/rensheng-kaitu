# 建立开图私人共享记忆

给 Agent 的步骤：

1. 查看有没有 git、官方 gh 和已登录的 GitHub 账号。没登录就让用户在 GitHub 官方页面登录。
2. 先找用户已有的开图资料：运行 `kaitu status`（或 `pnpm kaitu status`），或看 `~/kaitu` 是否存在。已有就用那个目录，不再新建第二份；没有才用新目录 `~/kaitu-ai-memory`。
3. 目标仓库：该账号下的私有仓库 `kaitu-ai-memory`。已存在就改走 [ADD_DEVICE.md](ADD_DEVICE.md)。
4. 从当前对话整理用户已经说过的偏好、目标和正在做的事；缺的最多问三个问题，用户可以跳过。没有项目也能完成。
5. 用户想加项目时，只读用户指定的项目（本机目录、GitHub 仓库或文档）的说明、交接文件和最近的提交，每个项目写清：
   - 做到哪了；
   - 卡在哪、试过什么没成；
   - 下一步要做的几件事。
   这三项写进 `projects/<英文短名>/STATUS.md` 正文和 `next`，同时记一条 `log.md`。目录名用可读的英文短名（如 `kaitu`、`lenghu-short`）。
6. 按 [DATA_LOCATIONS.md](DATA_LOCATIONS.md) 放内容。写入和上传前，把仓库名、目录和要写的内容给用户确认一次。
7. 建库并上传：
   - 有 kaitu：没有工作区时先 `kaitu init <目录>`；项目用 `kaitu project new --title <名称> --slug <英文短名> --kind work --dir <目录>`；然后 `kaitu backup connect <账号>/kaitu-ai-memory --create --via gh --text --records --dir <目录>`。之后只用 `kaitu backup sync --dir <目录>` 上传，不要在工作区里直接 `git push`（工作区自己的 .gitignore 会漏掉手机和收件箱文件）。
   - 没有 kaitu：`git clone --depth 1 https://github.com/Stahl-G/rensheng-kaitu` 到临时目录，把其中 `docs/guides/agent-memory/template/` 的全部内容（含隐藏文件）复制到新目录，填内容，`gh repo create <账号>/kaitu-ai-memory --private`，`git init`、提交、推送。时区写进 `me/rules.md`。仓库根目录必须保留 `kaitu-backup.json`，开图 App 靠它接上这个仓库。
8. 在 `handoffs/` 写第一份交接（见 AGENT-README.md 的格式），写明这次整理了什么、各项目的下一步。
9. 读回 `me/profile.md`、各项目 `STATUS.md` 和远端最新提交，确认已推送。
10. 最后给用户一段填好仓库地址的「另一台设备接入」提示词（见 [README](README.md)），并告诉用户：想在开图 App 里看，就在「设置 → GitHub 同步」从这个仓库恢复。
