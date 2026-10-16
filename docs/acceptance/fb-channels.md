# 手机通道交审

- 文件：`channels/src/{agent,index,runtime,phone-service}.ts`、`channels/test/runtime.test.ts`。
- 文件：`cli/src/main.ts`、`cli/src/ui/{server,phone-answer}.ts`、`cli/test/phone-answer.test.ts`。
- 文件：`dsh-plugin/src/client/{PersonalPages,PhoneChannels}.tsx`、`dsh-plugin/src/standalone/main.tsx`。
- 现象：手机通道只有命令行入口，App 无登录、配置与配对界面，回复默认调用 Codex CLI。
- 原因：通道运行时没有接入 App 生命周期，也没有接到问问模型服务。
- 改动：只在独立 App「AI 与连接」增加微信、QQ、Telegram、飞书卡片，显示配置、配对、连接与错误状态。
- 微信提供登录链接、复制按钮、验证码输入和取消登录；其余通道提供官方配置入口和凭据表单。
- 配对码显示有效时间，继续沿用只回复配对本人、同一聊天按顺序处理的行为。
- App 启动后后台连接已配置通道，退出或搬迁工作区时停止，搬迁后重新连接。
- 回复使用问问当前连接，创建默认权限对话，等待完整回复；无连接时提示到电脑连接 AI。
- 沿用现有本机凭据、配对与会话存储，没有改动 PRD §6；「邮件与聊天」界面未改。
- 仓库没有二维码生成依赖；二维码图片需后续添加 `qrcode`（MIT），本次没有安装依赖。
- 行为检查：合成工作区验证主人隔离、配对和消息顺序；合成模型验证问问默认权限与完整回复。
- 手动步骤：用临时工作区启动 `kaitu ui --dir <临时工作区>`，打开「AI 与连接」，检查四张通道卡片。
- 手动步骤：填自己的测试机器人凭据或登录微信，将配对码发给机器人，随后发文字，检查状态与回复。
- 手动步骤：在 App 连接或切换问问模型，再发手机消息；退出 App，确认机器人停止回复。
- 手动步骤：在浅色、深色与 375 像素宽度检查卡片、登录链接和表单。
- 检查：build、typecheck、lint 退出 0；全量 test 多项超时后停止，退出 130；单独复跑安全状态用例通过。
