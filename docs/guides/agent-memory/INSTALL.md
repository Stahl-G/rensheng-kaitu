# 建立开图私人共享记忆

底线：仓库必须是私有的；用户已有的仓库和文件不动；登录只走 GitHub 官方页面，不向用户要密码、token 或验证码；上传前给用户看一次要保存的内容。用用户的语言和用户交流、写入内容，本说明是中文也一样。

给 Agent 的步骤：

1. 查看有没有 git、官方 gh 和已登录的 GitHub 账号。没登录就让用户在 GitHub 官方页面登录。
2. 先找用户已有的开图资料：运行 `kaitu status`（或 `pnpm kaitu status`），或看 `~/kaitu` 是否存在。已有就用那个目录，不再新建第二份；没有才用新目录 `~/kaitu-ai-memory`。
3. 目标仓库：该账号下的私有仓库 `kaitu-ai-memory`。已存在就改走 [ADD_DEVICE.md](ADD_DEVICE.md)。
4. 从当前对话整理用户已经说过的偏好、目标和正在做的事，再问最多三个问题，用户可以跳过。第一个问题固定问：「除了眼前这件事，你最近还在推进什么？工作、自己的项目、写作、学习都算。」不要只围着当前目录里的项目。没有项目也能完成。
5. 用户提到的每个项目都整理，不只是当前目录这一个。项目在本机目录或 GitHub 仓库里时：
   - 先取远端最新（`git fetch` 后看默认分支，或用 `gh` 直接读远端），不要只看本机可能很久没更新的副本；
   - 读说明、最新的交接文件、最近的提交，以及开着的 PR 和 issue（`gh pr list`、`gh issue list`）；
   - 每个项目写清：做到哪了；卡在哪、试过什么没成；下一步要做的几件事。写明读到哪个提交、哪天，旧资料里的说法标上日期。

   写作、学习这类没有仓库的项目，读用户指出的文件夹；用户没给就记用户说的。三项写进 `projects/<英文短名>/STATUS.md` 正文和 `next`，同时记一条 `log.md`。目录名用可读的英文短名（如 `kaitu`、`lenghu-short`）。
6. 按 [DATA_LOCATIONS.md](DATA_LOCATIONS.md) 放内容。写入和上传前，把仓库名、目录和要写的内容给用户确认一次。
7. 建库并上传：
   - 有 kaitu：没有工作区时先 `kaitu init <目录>`；项目用 `kaitu project new --title <名称> --slug <英文短名> --kind work --dir <目录>`；然后 `kaitu backup connect <账号>/kaitu-ai-memory --create --via gh --text --records --dir <目录>`。之后只用 `kaitu backup sync --dir <目录>` 上传，不要在工作区里直接 `git push`（工作区自己的 .gitignore 会漏掉手机和收件箱文件）。
   - 没有 kaitu：`git clone --depth 1 https://github.com/Stahl-G/rensheng-kaitu` 到临时目录，把其中 `docs/guides/agent-memory/template/` 的全部内容（含隐藏文件）复制到新目录，填内容，`gh repo create <账号>/kaitu-ai-memory --private`，`git init`、提交、推送。时区写进 `me/rules.md`。仓库根目录必须保留 `kaitu-backup.json`，开图 App 靠它接上这个仓库。
8. 生成手机要读的内容，开图 iPhone 连上这个仓库就能看到：
   - 走「有 kaitu」：`kaitu phone run --as <你的名字> --dir <目录>`，再 `kaitu backup sync --dir <目录>`。
   - 走「没有 kaitu」：按 [ORGANIZER.md](../../mobile/ORGANIZER.md)「白天：更新手机」第 3 步写 `phone/today.json`（第一次写、没有上一份可照抄时：goals 取 `me/goals.json` 里 status 为 active 的目标，每个写 `{id, title, results: 0, next: null}`；sync 写 `{received: 0, needs_review: 0, organizer: false, updated_at: 现在}`）；再写 `phone/library.json`（格式见开图仓库的 `schemas/phone-library.schema.json`）：每个项目一条（kind `project`，title 取 STATUS.md 的 title，有下一步时 subtitle 写「下一步：<第一条>」，date 为 null，path 为 STATUS.md 的路径），每个目标一条（kind `me`，path `me/goals.json`，id 为目标 id，date 为 null），每条记忆一条（kind `me`，title 取 name，date 取 updated 的日期，path `memory/<文件名>`，标为敏感的 subtitle 写「标为敏感」），按 date 倒序、null 在最后。两份都写 `generator: {"kind": "agent", "name": "<你的名字>", "spec": 1}`，用 schema 校验通过后和其他文件一起提交推送。以后装了 kaitu，在仓库目录运行一次 `kaitu init`（已有文件不动，只补缺的），之后用 `kaitu phone run --as <你的名字>`。
9. 在 `handoffs/` 写第一份交接（见 AGENT-README.md 的格式），写明这次整理了什么、各项目的下一步。
10. 读回 `me/profile.md`、各项目 `STATUS.md` 和远端最新提交，确认已推送。
11. 最后给用户一段填好仓库地址的「另一台设备接入」提示词（见 [README](README.md)），并告诉用户：想在开图 App 里看，就在「设置 → GitHub 同步」从这个仓库恢复。
