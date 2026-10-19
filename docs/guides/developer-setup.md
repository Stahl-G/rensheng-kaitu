# 用 Agent 接上开图项目记忆

在 App 的「设置 → GitHub 同步」选好仓库名（默认 `kaitu-ai-memory`）和同步范围，点「建一个私有记忆仓库」，或复制提示词交给 Agent 去做。已存在的仓库不会被覆盖，改用连接。

提示词里写好了本机 kaitu 的实际入口（App 自带的 `dist/cli.mjs`），不用另装。下面的 `kaitu` 都指这个入口，`/path/to/workspace` 是开图工作区。

```text
kaitu backup auth-status
kaitu backup connect owner/kaitu-ai-memory --create --via gh --text --records --dir /path/to/workspace
kaitu backup connect owner/existing --via gh --dir /path/to/workspace
kaitu backup sync --dir /path/to/workspace
kaitu backup status --dir /path/to/workspace
kaitu backup restore owner/existing --to /path/to/new-folder --via gh
```

第一次连接要写明 `--text`/`--no-text` 和 `--records`/`--no-records`，之后省略就沿用上次的选择。手机快照和待整理原文不受这两个开关影响，总会同步。用 token 而不是 gh 时加 `--via token`，token 用 `kaitu project github-token` 从 stdin 存入。

## 代码项目

- 开始：`kaitu project memory --from /path/to/code --dir /path/to/workspace`，按 GitHub 远端或 repo 链接找到项目；匹配多个时加 `--project <slug>`。
- 读状态：`kaitu project show <slug> --dir /path/to/workspace`。
- 结束：`kaitu project log <slug> --text '改动：…；失败尝试：…；阻塞：…；建议下一步：…' --by agent --dir /path/to/workspace`，项目页「最近日志」能看到。
- 装项目技能：`kaitu project memory --from /path/to/code --install --dir /path/to/workspace`，写进该项目的 `.agents/skills/` 和 `.claude/skills/`，不动 AGENTS.md、CLAUDE.md 和全局配置；已有同名技能内容不同时停下。

没有装开图 App 也想用：见 [私人共享记忆](agent-memory/README.md)，Agent 用普通 Git 和 gh 就能建。

另一台设备复制「第二设备接入提示词」：先 `backup restore` 到新目录，再 `backup connect` 固定同步范围。没有 kaitu 的 Agent 可以直接读仓库里的 Markdown/JSONL，写入按 AGENT-README.md 的接力约定。照片、视频暂不同步。
