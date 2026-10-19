# 用一个 Agent 接上开图项目记忆

在 App 的「设置 → GitHub 同步」核对目标仓库和资料范围，复制「本机 Agent 接入提示词」到新 Agent。默认仓库名 `kaitu-ai-memory` 可改；已有同名仓库或 `my-ai-memory` 时先选择复用或新建，不覆盖、不迁移。真实建库和全局配置修改均须用户明确目标后确认。

提示词包含本机实际 CLI 入口。新功能包内有 `dist/cli.mjs`，可用 App 自带的 Electron Node 执行；无须先把 kaitu 安装到 PATH。旧包缺入口时先通过 App 更新，不运行臆造的 `npx rensheng-kaitu`。

CLI（已有工作区可用 `--dir` 明确指定）：

```text
kaitu backup auth-status
kaitu backup status
kaitu backup connect owner/kaitu-ai-memory --create --via gh
kaitu backup connect owner/existing-workspace --via gh
kaitu backup connect owner/existing-workspace --via token
kaitu backup sync
kaitu backup restore owner/existing-workspace --to /path/to/new-folder --via gh
```

`--via token` 复用工作区既有凭据；需要录入时沿用 `kaitu project github-token` 的 stdin，不在命令行参数、提示词或日志放 token。gh 只复用既有授权；登录由用户在官方页面确认，不额外请求权限。gh 的凭据存储取决于系统，不保证是钥匙串。

开发开始用 `kaitu project memory --from /path/to/code --json-out` 匹配已有 GitHub 绑定或 repo 链接；多个匹配时加 `--project slug`。没有绑定时，先核对后复用 `project new --title ... --kind work --link /path/to/code:repo`、`project link`、`project github`。`project github` 是现有仓库指标连接，权限以它的已有配置为准；本地 repo 链接足以匹配项目记忆，不要求为了读日志另开授权。

开始读取 `project show slug` 返回的 STATUS 和 log；结束用 `project log slug --text '改动：…；失败尝试：…；阻塞：…；建议下一步：…；来源：…' --by agent`。现有 log.md 保留多行正文，项目页已有“最近日志”，无需另一种交接格式或新增事实库。

明确要求安装项目入口时，用 `project memory --from /path/to/code --install`：只写该项目的 `.agents/skills/kaitu-project-memory/` 与 `.claude/skills/kaitu-project-memory/`，不改 AGENTS.md、CLAUDE.md 或用户全局配置。同名技能有不同内容会停止并保留原文。

第二设备复制另一段提示词，先 clone 到新目录并读 AGENT-README.md。没有 CLI 的 Agent 仍可直接读原样 Markdown/JSONL；写入遵守 inbox/agents/、handoffs/ 的既有接力约定。冲突保留双方，不能强推。

接入完成须有实际证据：新会话读到上次项目状态，写一条合成开发日志，经同步后在 App 项目页回读。只生成文件或安装技能不能证明所有 Agent 已接入。图片和视频等附件暂不在同步范围。
