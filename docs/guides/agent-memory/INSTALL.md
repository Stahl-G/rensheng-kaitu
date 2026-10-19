# 建立开图私人共享记忆

给 Agent 的步骤：

1. 查看有没有 git、官方 gh 和已登录的 GitHub 账号。没登录就让用户在 GitHub 官方页面登录。
2. 目标：该账号下的私有仓库 `kaitu-ai-memory`，本机目录 `~/kaitu-ai-memory`。仓库已存在就改走 [ADD_DEVICE.md](ADD_DEVICE.md)；目录不是空的就换一个新目录。
3. 从当前对话整理用户已经说过的偏好、目标和正在做的事；缺的最多问三个问题，用户可以跳过。没有项目也能完成。
4. 用户想加项目时，只读他指定的项目（本机目录、GitHub 仓库或文档），整理出现状、决定、失败尝试和下一步，附来源。
5. 按 [DATA_LOCATIONS.md](DATA_LOCATIONS.md) 放内容。写入和上传前，把仓库名、目录和要写的内容给用户确认一次。
6. 建库：
   - 有 kaitu：`kaitu init <目录>`，填内容，再 `kaitu backup connect <账号>/kaitu-ai-memory --create --via gh --text --no-records --dir <目录>`。
   - 没有 kaitu：复制本目录的 [template/](template/) 到新目录，填内容，`gh repo create <账号>/kaitu-ai-memory --private`，`git init`、提交、推送。时区写进 `me/rules.md`。
7. 读回 `me/profile.md`、`memory/MEMORY.md` 和远端最新提交，确认已推送。
8. 最后给用户一段填好仓库地址的「另一台设备接入」提示词（见 [README](README.md)）。
