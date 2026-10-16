# 只读渠道交审

按渠道查看实现、借用文件、未完成项与手动验证步骤：

- [IMAP](imap.md)
- [Slack](slack.md)
- [飞书及桌面打包修复](feishu.md)

用户接入步骤见 [邮件与聊天收件箱](../../channels.md)，Slack 应用配置见 [manifest](../../slack-app-manifest.json)。
最终 build / typecheck / lint 通过，完整测试 49 个文件、134 项通过。
每渠道仅新增一个假传输行为测试，单 worker 运行且未修改原有 15 秒时限。
全部提交保留在本地 codex/channels，不推送、不合并；未修改 PRD §6、schemas 或真实账号配置。
