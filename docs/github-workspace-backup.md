# GitHub 私有资料库同步

在「设置 → 资料放哪 → 同步与备份 → GitHub 同步」填写 `owner/repo`。建议为这个工作区准备专门的空私库，或选择已有的开图备份仓库。

桌面开图始终读写「存放位置」显示的本地工作区。这里的 GitHub 资料库同步与项目页绑定代码仓库、读取项目活动是不同用途。GitHub 同步所选的真实资料文件，不只是 AI 摘要；`kaitu-ai-memory` 只是建议仓库名。可以只用 GitHub，不必同时连接 Google Drive。若本地工作区本身就在 Drive 同步目录里，两者同步的是同一个文件夹，不会自动合并两个独立资料库。Drive 的上传状态以 Drive 客户端为准。

可沿用已登录的 GitHub CLI（gh），新建私有资料库或连接已有资料库。也可在 GitHub 创建 fine-grained token，只授权目标仓库的 Contents 读写，再在界面输入并连接。token 保存在本机 state 目录中的 secrets.json，不放进备份。

连接或更换目标时检查一次仓库可见性。公开仓库默认不上传，界面单独提供主动允许公开同步的按钮。之后每分钟在后台同步一次，另有「立即同步」，不重复查询可见性。不开启此连接，保存和其他本地功能照常可用。

可分别勾选：

- 文字：非隐藏目录中的 Markdown、TXT。
- 结构化资料：JSON、JSONL、YAML、CSV、ICS、TOML。

两项默认均不勾选。已连接但未选范围时，普通资料文件不进入同步，下面的手机通道仍会同步。界面显示已保存范围、正在进行的阶段、实际上次完成时间和失败原因；未完成首次同步时不显示成功时间。

`.git`、整个 `.kaitu`、隐藏目录、node_modules、收件箱、常见凭据文件名和媒体均不上传；手机收件路径按下面的专用规则处理。备份附带 `kaitu-backup.json` 以识别格式和选择范围。已有备份中未选择继续同步的类别保留在远端；不会操作用户自己的 Git 仓库、remote、分支或 index。GitHub 接入用 Git Data API，不需要系统 Git；本机版本历史继续使用已有 isomorphic-git。

恢复时选择新的空目录，程序先读取备份，再初始化工作区、还原所选资料。点「打开恢复的工作区」可立即切换；独立 App 的下次启动位置也更新。DSH 插件若显式配置了 workspace，需同时将该配置改为恢复目录。

两端修改不同文件或不同记录可往返合并。同一记录在两端修改、或一端修改另一端删除时，即使修订落在不同月份文件，也暂停上传并列出相关文件。本机与远端内容都保留，用户对照后选择文件版本，再点同步。处理前的两份内容保留在本机 `.kaitu/backup-conflicts/`；这里不上传。普通文本的两端修改也进入该流程。网络或授权失败只更新状态，不影响本地保存。iCloud 尚未下载的所选资料会暂停本轮并显示下载提示，不会被当作删除上传；下载回来后可重试。

仓库权限若后来发生变化，按连接时选择继续同步；用户可断开后重新连接核对。远端分支不可读取时暂停，不把整个工作区当作已在远端删除。

GitHub 接口依据：[Git trees](https://docs.github.com/en/rest/git/trees)、[Git refs](https://docs.github.com/en/rest/git/refs)、[Contents](https://docs.github.com/en/rest/repos/contents)、[个人访问令牌](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。

## 手机伙伴路径

启用连接后，`phone/{today,week,map,library,receipts}.json` 始终只上传，远端快照修改不会覆盖电脑生成内容。
`inbox/agents/` 的文字 / JSON / JSONL、`inbox/health/*.health.json`、`inbox/notes/` 的 Markdown 始终双向同步，不受文字 / 结构化资料开关影响。
手机只创建新文件，电脑拉下后按现有收件箱处理；处理完成后下一轮删除远端原件，并上传手机回执。
照片与二进制文件尚不支持。格式、回执与去重规则见 [手机契约](guides/phone-contract.md)。

iPhone 每次只使用一个资料来源：GitHub、Google Drive 或所选文件夹。成功连接新来源会切换当前资料位置，保留账号授权不代表同时使用两库；原位置缓存与队列保留，不自动合并。GitHub 必须是含 `kaitu-backup.json`、`format: "kaitu-workspace"` 的开图私库。手机读取快照、提交记录与操作并等待回执，页面更新和操作处理仍由电脑或整理 Agent 完成。
