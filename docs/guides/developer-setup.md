# 用一个 Agent 接上开图项目记忆

无需 App、CLI 或特定 runtime 的首次试用，先看 [一次复制初始化](agent-memory/INSTALL.md) 和 [第二设备接续](agent-memory/ADD_DEVICE.md)。已有源码/CLI 时会优先核对并复用真实入口；没有时用普通 Git 与官方 gh，仍使用同一套开图资料与接力格式。

在 App 的「设置 → GitHub 同步」核对目标仓库和资料范围，查看只读 README、描述预览与选中范围，再复制「新建 / 接入前核对提示词（当前选中范围）」到新 Agent。默认仓库名 `kaitu-ai-memory` 可改；已有同名仓库或 `my-ai-memory` 时先选择复用或新建，不覆盖、不迁移。真实建库和全局配置修改均须用户明确目标后确认。

提示词包含本机实际 CLI 入口。新功能包内有 `dist/cli.mjs`，可用 App 自带的 Electron Node 执行；无须先把 kaitu 安装到 PATH。旧包缺入口时先通过 App 更新，不运行臆造的 `npx rensheng-kaitu`。

下文 `kaitu` 均指 App 提示词中列出的实际 CLI 入口，保留该入口选择的配置与传输。
不要在新 Agent 中改用系统 gh 检查仓库或读取凭据。先展示目标与范围并取得确认，再运行
`backup connect --create`，由其内置检查处理已有 `kaitu-ai-memory` / `my-ai-memory`。
发现旧 `my-ai-memory` 后默认停止。用户核对真实目标名和范围后，可在 App 勾选默认未选的
「保留 my-ai-memory，另建此仓库」，或在上述新建命令加 `--keep-legacy`。
此选择仅用于新建，不持久保存，不迁移或读取旧库内容。目标 `kaitu-ai-memory` 已存在时始终拒绝覆盖。

所有 `backup sync`、`backup status` 和 `project` 子命令都显式带所选工作区的 `--dir`。
登录检查或同步若因 Agent 会话网络权限失败，由同一个 Agent 通过正常审批重试原实际 CLI 命令；不退出已有登录、不扩大授权，不由监督或 App 后台代跑后声称 Agent 自身成功，必须有该 Agent 命令成功回执才称同步完成。

下面以 `/path/to/workspace` 表示该目录：

```text
kaitu backup auth-status
kaitu backup status --dir /path/to/workspace
kaitu backup connect owner/kaitu-ai-memory --create --via gh --text --records --dir /path/to/workspace
kaitu backup connect owner/existing-workspace --via gh --dir /path/to/workspace
kaitu backup connect owner/existing-workspace --via token --no-text --records --dir /path/to/workspace
kaitu backup sync --dir /path/to/workspace
kaitu backup restore owner/existing-workspace --to /path/to/new-folder --via gh
```

`backup auth-status` 不需要初始化或打开工作区，不写默认工作区绑定。全新 HOME 只要已有可用 gh 登录，
`backup restore owner/repo --to /path/to/new-folder --via gh` 即可直接恢复，不需要 `--dir`。
已有工作区或非空目标目录会拒绝恢复，原文件保留。

第一次连接 / 新建必须明确两项范围：`--text` 或 `--no-text`，以及 `--records` 或 `--no-records`。
缺范围会在建库前停止。已有连接省略范围时保留原选择，显式关闭不会被覆盖，换仓库也不会自动扩大范围。
界面勾选从已存连接载入，复制提示词使用当前编辑的选中范围；订阅刷新不覆盖正在编辑的选项。
README 预览区分现有原文和新建文本；已有仓库描述来自连接时检查，后续上传不重复检查权限。

`--via token` 恢复需要 `--dir /path/to/original-workspace` 指向存有凭据的原工作区。它复用工作区既有凭据；需要录入时沿用 `kaitu project github-token --dir /path/to/workspace` 的 stdin，不在命令行参数、提示词或日志放 token。gh 只复用既有授权；登录由用户在官方页面确认，不额外请求权限。gh 的凭据存储取决于系统，不保证是钥匙串。

开发开始用 `kaitu project memory --from /path/to/code --json-out --dir /path/to/workspace` 匹配已有 GitHub 绑定或 repo 链接；多个匹配时加 `--project slug`。没有绑定时，先核对后复用 `project new --title ... --kind work --link /path/to/code:repo --dir /path/to/workspace`、
`project link <项目> <路径> --dir /path/to/workspace`、`project github <项目> <仓库> --dir /path/to/workspace`。`project github` 是现有仓库指标连接，权限以它的已有配置为准；本地 repo 链接足以匹配项目记忆，不要求为了读日志另开授权。

开始读取 `project show slug --dir /path/to/workspace` 返回的 STATUS 和 log；结束用 `project log slug --text '改动：…；失败尝试：…；阻塞：…；建议下一步：…；来源：…' --by agent --dir /path/to/workspace`。现有 log.md 保留多行正文，项目页已有“最近日志”，无需另一种交接格式或新增事实库。

明确要求安装项目入口时，用 `project memory --install --from /path/to/code --dir /path/to/workspace`：只写该项目的 `.agents/skills/kaitu-project-memory/` 与 `.claude/skills/kaitu-project-memory/`，不改 AGENTS.md、CLAUDE.md 或用户全局配置。同名技能有不同内容会停止并保留原文。
执行前由同一个 Agent 展示两份 `SKILL.md` 的具体待写路径和内容，按正常权限流程确认。
遇 EPERM / EACCES 时会返回 `AGENT_PERMISSION_REQUIRED`、两份路径及原 install 命令；由该 Agent 申请正常审批后重试原命令。
不使用绕过沙箱的选项，不 chmod、不换写法、不让监督或其他 Agent 代装，不改全局 Agent 设置。
若当前会话以 `-a never` 禁止审批，停止安装，由用户在支持正常审批的新 Agent 窗口继续，不能称安装或接入全部成功。

第二设备复制另一段提示词。有可运行 CLI 时先用该实际入口 `backup restore ... --via gh` 恢复到新目录，
再用 `backup connect <仓库> --via gh --text/--no-text --records/--no-records --dir <恢复目录>` 固定选中范围。
后续 `backup sync --dir <恢复目录>`、`backup status --dir <恢复目录>` 和所有项目命令均指向恢复目录。
没有 CLI 时使用已有仓库访问能力 clone 到新目录并读 AGENT-README.md。没有 CLI 的 Agent 仍可直接读原样 Markdown/JSONL；写入遵守 inbox/agents/、handoffs/ 的既有接力约定。冲突保留双方，不能强推。

接入完成须有实际证据：新会话读到上次项目状态，写一条合成开发日志，经同步后在 App 项目页回读。只生成文件或安装技能不能证明所有 Agent 已接入。图片和视频等附件暂不在同步范围。
