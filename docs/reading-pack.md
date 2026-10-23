# 按需阅读包

Agent 可用 `kaitu reading-pack --dir <资料目录>`，或 MCP `reading_pack` 即时取得当前正本计算的近况。`--json-out` 返回交接包的分组结构，默认输出 Markdown；`--locale en` / MCP `{ "locale": "en" }` 选择英文。

内容、记忆筛选、密钥与本机路径脱敏直接复用 `handoverPack`。阅读包不保存到工作区、不创建版本。CLI 使用 `local-mcp` 权限，MCP 使用服务端绑定的实际连接身份；财务按现有 `agentCanRead` 规则决定，调用参数不能自报财务授权。

读取与界面交接包相同：暂不可读的来源可能缺省为空，缺项不证明用户没有这类资料；需要完整证据时按来源核对。此入口不修改原始记录、修订号或手机协议。
