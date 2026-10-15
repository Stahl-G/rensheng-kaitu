# 手机通道

电脑保持开机，先在电脑上安装并登录 Codex CLI。通道均主动连接平台，不监听端口。

## 第一次使用

1. `kaitu channels setup telegram`（通道可换为 `feishu`、`qq`、`weixin`）。
2. `kaitu channels pair telegram`：记下 6 位一次性配对码，10 分钟有效。
3. `kaitu channels start --only telegram`：前台运行，用手机**私聊**机器人发送配对码。
4. 收到配对成功回复后，发「今天深蹲 3×12 60kg」。先收到处理回执，随后收到 Agent 的结果。
5. `kaitu ui --channels` 同时打开工作台和所有已配置通道；文件变化沿用现有监听实时刷新。
   单独运行通道也会在消息处理后保存工作区版本。

`kaitu channels start` 启动所有已配置通道，Ctrl+C 停止通道及正在运行的回答命令。
`kaitu channels status` 查看配置、配对和进程状态；进程运行中不代表平台连接已验证。
所有命令支持 `--dir <工作区>`，也可设置 `KAITU_DIR`。
已配对的通道不能再次生成配对码；未配对时再次执行 pair 会替换旧码。非主人消息静默忽略。
文本以外的内容暂不处理。

## Telegram

1. 在 Telegram 找到 `@BotFather`，发送 `/newbot`，按提示创建机器人。
2. 把返回的 bot token 填入 `kaitu channels setup telegram`。
3. 手机打开机器人私聊并点击 Start，再按上面的步骤配对。
4. 电脑需能访问 Telegram；同一个 token 只运行一个长轮询程序。

## 飞书

1. 打开飞书开放平台，创建企业自建应用，记下 App ID 和 App Secret。
2. 添加「机器人」能力，开通接收用户私聊消息和发送消息权限（如 `im:message.p2p_msg:readonly`、`im:message:send_as_bot`）。
3. 事件订阅选择「使用长连接接收事件」，添加 `im.message.receive_v1`。
4. 发布应用版本，把本人加入可用范围，填入 `kaitu channels setup feishu`。
5. 启动通道，在飞书找到机器人并私聊配对。无需配置公网回调地址。

## QQ

1. 在 QQ 开放平台创建机器人，取得 App ID 和 App Secret。
2. 开通 C2C 私聊消息能力；开发阶段把本人 QQ 加入平台提供的测试 / 沙箱范围。
3. 填入 `kaitu channels setup qq`，启动通道后通过平台入口添加机器人并私聊配对。
4. 使用 SDK 的 WebSocket 传输和 C2C 收发；平台准入、测试范围、消息频次和长文本回复限制需实测。

## 微信

1. 执行 `kaitu channels setup weixin`，终端会打印腾讯 iLink 登录链接。
2. 用手机微信打开链接，或在另一块屏幕上打开链接后扫码，在手机上确认连接。
3. 若提示数字验证，把手机显示的数字输入电脑终端；扫码过期会刷新，最多生成 3 次。
4. 登录完成后仍需 `kaitu channels pair weixin`，启动通道并从手机私聊发配对码。
5. 登录失效时重新 setup。此通道是从腾讯官方包抽取的文本实现，源码来源和差异见
   [微信抽取说明](../packages/channels/src/weixin/README.md)。

## 回答命令与本机状态

默认执行 `codex exec -s workspace-write`，在当前工作区运行，读取工作区 AGENTS.md。
每个「通道 + 聊天」保存独立 Codex 会话 ID，后续执行 `codex exec resume <ID>`；不使用 `--last`。
默认 3 分钟超时，同一会话排队，不同会话可同时处理，长结果分段发送。

可在工作区 `.kaitu/config.json` 增加下面的配置（保留其他已有字段）：

```json
{
  "channels": { "agent_command": "claude -p" }
}
```

自定义命令通过本机 shell 启动，在工作区运行，提示词从 stdin 输入，stdout 作为回答。
自定义命令每次新建进程，提示词带最近 5 轮对话；无需在命令中插入消息占位符。

凭据在本机状态目录的 `secrets.json`（权限 600）；配对、会话、微信游标在同目录 `channels/`。
默认状态目录为工作区 `.kaitu/`，Drive 模式使用已配置的本机 `state_dir`；上述状态不进版本历史和 Drive。
