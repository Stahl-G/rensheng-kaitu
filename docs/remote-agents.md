# 远程 Agent 接入开图

本机 Agent 用 `kaitu mcp`（stdio）。Claude Code 读取工作区 `.mcp.json`；Codex 用
`codex mcp add kaitu -- kaitu mcp` 注册。非默认工作区先设置 `KAITU_DIR` 为绝对路径。

## HTTP 服务

```sh
kaitu mcp --http --dir /你的工作区
kaitu mcp token --dir /你的工作区
```

服务只监听 `127.0.0.1:4871`，地址为 `http://127.0.0.1:4871/mcp`，使用 Streamable HTTP。
请求必须带 `Authorization: Bearer <token>`。token 存在状态目录的 `secrets.json`（本地模式为 `.kaitu/secrets.json`，Drive 模式留在本机；权限 600），不进版本历史。
用 `kaitu mcp token --rotate` 轮换；正在运行的服务会在后续请求中拒绝旧 token。

HTTP 默认 remote 集合：读取状态、记录、记忆、对话和文档（不含财务明细和标为敏感的记忆）；`record_types` 只读列出记录类型、字段与示例；新增记录、记忆、简报和待确认日程建议。
`--tools all` 才开放修改、删除和保存版本；stdio 默认 all，也可显式加 `--tools remote`。
工具不提供恢复版本、删除模块、修改规则或目标、任意文件写入。

## 记住这次变化

现有 `import-chatgpt-memory` Skill 也是当前对话的入口：只取用户明确的新事实、偏好、决定，保留原话的限定、日期和来源。用户看到的是「记住这次变化 → 勾选候选 → 我确认」。
`onboarding_memory_review` 复用搬记忆的本机暂存、去重和版本逻辑，通过 MCP form elicitation 向用户展示候选；模型参数没有 selected / confirmed，只有客户端表单提交的选择能进入本工具的确认步骤。空选、取消、过期以及确认前失败不写正本，等待确认不占写队列。来源可从记忆回读，整批撤销仍在开图历史中完成；确认后丢失回执须先回读，不能假定保存成功或失败。
客户端须支持 form elicitation 并将选择交给用户；不能由模型或 hook 自动填写 accept。这是客户端交互约定，不是抵御恶意客户端的权限隔离，现有 memory_save / record_add 仍是独立的直接写入工具，Skill 明确不把它们用作候选入口。
不支持确认表单、没有本机工具或未连接时，Skill 提供候选文字，用户复制到开图「从常用的 AI 搬来记忆」预览确认；不宣称已经保存。目标、项目和方向继续在该既有入口选择去处。不会扫描 transcript、改全局配置、开公网服务或承诺所有聊天自动实时回传。

接口依据：[Agent Skills 规范](https://agentskills.io/specification)、[MCP 工具的人机交互](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)、[MCP elicitation 表单与选择](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)。已核对 [Claude Code hook 生命周期和项目配置](https://code.claude.com/docs/en/hooks)：hook 是特定运行时的自动事件，不能证明模型总结就是用户事实。本版使用主动 Skill，不需要安装 hook；客户端的真实渲染与 Skill 自动发现须分别验收。

## 自愿开放公网

开图不内置公网暴露。若确实需要云端 Agent 访问，用户可自行选择 Cloudflare Tunnel 或 Tailscale Funnel，
以其官方文档为准，把 HTTPS 公网地址转发到本机 `127.0.0.1:4871`。

代理须保留 Authorization 和 MCP 会话头，并把上游 Host 改写为 `127.0.0.1:4871` 或 `localhost:4871`；
开图会拒绝其他 Host。使用自定义端口时同步替换 Host 中的端口。不要关闭 Host 校验来适配隧道。

将公网 HTTPS 地址的 `/mcp` 路径和 Bearer token 配置给 Grok Bot 或 ChatGPT Dots。
具体是否支持 Streamable HTTP、静态 Bearer 请求头，以及如何填写，以对方官方文档为准；
本项目没有验证它们的接入界面或兼容性。若客户端不能带该请求头，当前不能直接连接。

公网地址和 token 交给谁，谁就能通过所开放的工具读取你的记录、记忆和对话，并写入内容。
先用 remote 集合；不需要时关闭隧道，token 泄露时立即轮换。客户端名用于版本说明，不作为可信身份认证。
外部简报可用 `write_digest` 写入 `feed/digests/YYYY-MM-DD.md`；工具按 MCP 客户端名称分节合并，同一来源重交只替换自己的小节。
`propose_block` 只产生待确认建议，用户在工作台确认后才能进一步写外部日历。
