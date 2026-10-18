# CodeBuddy 接入验收（2026-10-18）

本机 CLI：`@tencent-ai/codebuddy-code 2.154.0`，通过 `codebuddy --acp` 连接，沿用 CLI 自己的登录和额度。

## 行为

- 「连接 AI」多一个「用本机 CodeBuddy」；API Key 和资料包入口保留。
- 自动在 PATH、常用安装目录、nvm、Windows npm 里找 CLI，也可以填绝对路径。
- 只在完整 Agent 模式下可发送。CodeBuddy 申请权限时只选「允许一次」。
- 新会话的第一条消息前带一段提醒：只读这次需要的资料、不读凭据、不把资料发到模型服务以外的地方。提醒不是隔离。
- 流式显示回复，最终消息只记一次；可以取消，重开后续接 CodeBuddy 原会话。
- 只收文字，附件和 DSH 的引用、换模型不可用。

## 实测

- Mac 本机真实 CLI，三轮合成任务：流式回复；关掉重开后续接同一会话并用工具写文件、回读；取消后回到空闲，退出时子进程清理干净。没有发送个人资料。
- 打包后的 `mcp-stdio.mjs`：MCP 握手发现 38 个工具，用 `task_add` 存一条合成待办并回读。
- 原生 App 本地签名包能启动，找到 `/opt/homebrew/bin/codebuddy`。

## 还没验

- Windows 真机。
- 原生 App 里点菜单退出。
