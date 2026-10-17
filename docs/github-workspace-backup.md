# GitHub 工作区备份（开发者可选）

在「个人 → AI 与连接 → GitHub 工作区备份」填写 `owner/repo`。建议为这个工作区准备专门的空私库，或选择已有的开图备份仓库。

授权沿用已有 GitHub token 保存机制。也可由用户在 GitHub 创建 fine-grained token，只授权目标仓库的 Contents 读写，再在界面输入并连接。token 保存在本机 state 目录中的 secrets.json，不放进备份。应用不会创建 OAuth App、自动申请授权或创建远端仓库。

连接或更换目标时检查一次仓库可见性。公开仓库默认不上传，界面单独提供主动允许公开同步的按钮。之后每分钟在后台同步一次，另有「立即同步」，不重复查询可见性。不开启此连接，保存和其他本地功能照常可用。

可分别勾选：

- 文字：非隐藏目录中的 Markdown、TXT。
- 结构化资料：JSON、JSONL、YAML、CSV、ICS、TOML。

`.git`、整个 `.kaitu`、隐藏目录、node_modules、收件箱、常见凭据文件名和媒体均不上传。备份附带 `kaitu-backup.json` 以识别格式和选择范围。已有备份中未选择继续同步的类别保留在远端；不会操作用户自己的 Git 仓库、remote、分支或 index。GitHub 接入用 Git Data API，不需要系统 Git；本机版本历史继续使用已有 isomorphic-git。

恢复时选择新的空目录，程序先读取备份，再初始化工作区、还原所选资料。点「打开恢复的工作区」可立即切换；独立 App 的下次启动位置也更新。DSH 插件若显式配置了 workspace，需同时将该配置改为恢复目录。

两端修改不同文件或不同记录可往返合并。同一记录在两端修改、或一端修改另一端删除时，即使修订落在不同月份文件，也暂停上传并列出相关文件。本机与远端内容都保留，用户对照后选择文件版本，再点同步。处理前的两份内容保留在本机 `.kaitu/backup-conflicts/`；这里不上传。普通文本的两端修改也进入该流程。网络或授权失败只更新状态，不影响本地保存。iCloud 尚未下载的所选资料会暂停本轮并显示下载提示，不会被当作删除上传；下载回来后可重试。

仓库权限若后来发生变化，按连接时选择继续同步；用户可断开后重新连接核对。远端分支不可读取时暂停，不把整个工作区当作已在远端删除。

GitHub 接口依据：[Git trees](https://docs.github.com/en/rest/git/trees)、[Git refs](https://docs.github.com/en/rest/git/refs)、[Contents](https://docs.github.com/en/rest/repos/contents)、[个人访问令牌](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。
