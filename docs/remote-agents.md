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

HTTP 默认 remote 集合：读取状态、记录、记忆、对话和文档；`record_types` 只读列出记录类型、字段与示例；新增记录、记忆、简报和待确认日程建议。
`--tools all` 才开放修改、删除和保存版本；stdio 默认 all，也可显式加 `--tools remote`。
工具不提供恢复版本、删除模块、修改规则或目标、任意文件写入。

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
