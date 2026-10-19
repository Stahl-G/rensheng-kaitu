---
name: kaitu-project-memory
description: 开始或结束代码项目工作时，按当前 GitHub 仓库读取开图项目状态及日志，再把改动、失败尝试、阻塞和下一步记回现有项目日志。
---

# 开图项目记忆

使用用户指定的开图工作区；未指定时用 kaitu 当前默认工作区。

开始：运行 `kaitu project memory --from <当前代码仓库绝对路径> --dir <开图工作区> --json-out`。
按 GitHub 远端匹配已有项目。没有匹配先说明；多个匹配让用户选择，再加 `--project <slug>`，不自动错绑。
读取返回的 STATUS 正文、下一步和 log.md；需要依据时沿来源读取，不把旧猜测当结论。

结束：用现有 `kaitu project log <slug> --text '<本次开发记录>' --by agent --dir <开图工作区>`。
正文分清“改动”“失败尝试”“阻塞 / 未解决项”“建议下一步”，附相关文件、PR 或证据来源；下一步只是建议，不据此自动改目标或 STATUS。
再用 `project show <slug>` 读回，确认记录在项目页“最近日志”可见。
已配置 GitHub 时运行 `kaitu backup sync` 并检查 status；冲突保留双方，不强推。无本机 kaitu 的远端 Agent 可直接读原样 Markdown/JSONL，写入仍按 AGENT-README.md 的接力约定。

仅在用户明确指定代码仓库并要求安装时，运行 `kaitu project memory --from <代码仓库> --install --dir <开图工作区>`。
它写本项目的 .agents/skills 和 .claude/skills 入口，保留 AGENTS.md、CLAUDE.md，不改全局配置。
