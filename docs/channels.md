# 邮件与聊天收件箱

开图 → 右上角 → AI 与连接 → 邮件与聊天。添加账号后，开图保持运行即可自动接收。
不需要 Codex CLI 或另装服务；只保存来源、发件人、时间、标题、最多 280 字摘录与原文链接。
消息作为不可信资料进入现有收件箱，后续整理为待确认建议。

## Gmail：用 Google 登录

点击 Gmail 卡片的「连接」→「用 Google 账号登录」，在系统浏览器完成授权后回到开图。
只申请 `https://www.googleapis.com/auth/gmail.readonly`，不使用 IMAP XOAUTH2，不发送、删除、移动或标记已读。
第一次用 `messages.list` 分页读取当前收件箱，随后用 `users.history.list` 增量读取新邮件；历史游标失效时重新扫描并去重。
用 `messages.get(format=metadata)` 取标题、发件人、认证头与 snippet，只保存最多 280 字摘录，不保存附件或完整正文。
OAuth 使用本机随机端口回环回调、state 与 PKCE S256，授权等待三分钟后超时；电脑保持运行时每分钟拉取。
访问令牌、刷新令牌只放本机采集状态目录的 600 文件，接口不返回。断开时向 Google 请求撤销并删除本机令牌。
撤销接口不可达时仍清除本机令牌，界面提示到 Google 账户第三方连接移除开图。

### 开通此版本的 Google 登录

由维护者在 Google Cloud 操作，开图不会代建项目或填写凭据：

1. 创建或选择专用项目，在 API 库启用 **Gmail API**。
2. 在 Google Auth Platform 配置品牌与 OAuth 同意屏幕：应用名称、支持邮箱、开发者联系方式；公开使用时准备主页、隐私政策与域名验证。
3. 选择受众：组织内部应用仅限符合条件的 Workspace 组织；外部应用在 Testing 阶段添加明确的测试用户。
4. 在数据访问中只添加 `https://www.googleapis.com/auth/gmail.readonly`。
5. 创建 OAuth 2.0 客户端，类型必须为 **桌面应用（Desktop app）**，不能用 Web、iOS 或 Android 客户端替代回环流程。
6. 启动开图的进程需配置 `KAITU_GOOGLE_CLIENT_ID`，客户端如附带 secret，可配置 `KAITU_GOOGLE_CLIENT_SECRET`。
   打包时由启动环境提供同名配置；不要把用户令牌放进包。桌面客户端 secret 不能作为可保密的客户端身份证明，仍使用 PKCE。
7. 外部 Testing 项目只允许加入的测试用户。含 Gmail scope 的刷新令牌在 Testing 状态通常七天到期，届时重新登录。
8. 面向公众发布前将应用推进 Production，并根据 Google 要求完成品牌及受限 scope 验证，提交用途、最小权限理由、隐私政策与演示。
   `gmail.readonly` 属于受限 scope；若不符合豁免条件，需要受限 scope 审核。将此类数据存储或传输到服务器时，可能另需安全评估。
   发布状态与验证通过是不同事项，不把切到 Production 当作已通过审核。

未配置客户端 ID 时，Gmail 卡片显示「这个版本还没开通 Google 登录，可以先用应用专用密码」。
本分支没有创建 Cloud 项目、配置真实 ID、邀请测试用户、提交 Google 审核，也没有验证真实账号授权和 Gmail 实收。

依据：[桌面 OAuth 与 PKCE](https://developers.google.com/identity/protocols/oauth2/native-app)、
[Gmail scope 分类](https://developers.google.com/workspace/gmail/api/auth/scopes)、
[受限 scope 验证](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)、
[Testing 令牌有效期](https://developers.google.com/identity/protocols/oauth2/)、
[增量同步与 404 恢复](https://developers.google.com/workspace/gmail/api/guides/sync)。

## IMAP 邮件（其他邮箱与 Gmail 备选）

选择邮箱服务，填写账号名称、邮箱账号、应用专用密码 / 授权码，点击添加，再测试连接。
支持自填服务器和文件夹，默认 TLS 993、INBOX。首次连接只记录当前位置；重新连接从本机游标续接。
UIDVALIDITY 改变时重新建立当前位置，不回灌历史邮件。超过 1 MiB 的邮件跳过，附件不保存。

| 邮箱 | 预置服务器 | 凭据入口 |
|---|---|---|
| Gmail | imap.gmail.com | [Google 账户应用专用密码](https://support.google.com/mail/answer/185833)，先开启两步验证；组织策略可能禁用 |
| iCloud | imap.mail.me.com | [Apple 账户](https://support.apple.com/102654) → 登录和安全 → App 专用密码 |
| Outlook | outlook.office365.com | [Microsoft 要求 OAuth2](https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com)；本版不支持 Microsoft 登录；高级设置保留手填 access token，应用密码不可用 |
| QQ | imap.qq.com | [网页版邮箱](https://service.mail.qq.com/detail/0/75) → 设置 → 账号与安全 → 开启 IMAP → 生成授权码 |
| 163 | imap.163.com | [网页版邮箱](https://mail.163.com/) → 设置 → POP3/SMTP/IMAP → 开启 IMAP → 获取授权码 |

Outlook token 到期后需断开并重新添加；本轮没有 Microsoft OAuth 登录与自动续期。
邮件用 mailauth 校验 DKIM、SPF/DMARC 证据并标注结果；未验证的邮件仍只是外部资料。
缺少原始 SMTP 会话时无法完整重演 SPF，不能把邮件头里的认证声明当作可信身份。
认证临时错误最多尝试三次，持续失败的邮件跳过。所有读取均不改未读标记，也不移动邮件。

## Slack

1. 在 [Slack 应用页面](https://api.slack.com/apps) 选择 Create New App → From a manifest，
   导入 [slack-app-manifest.json](slack-app-manifest.json)，选择自己的工作区，作为内部应用安装。
2. 在 OAuth & Permissions 复制 **User OAuth Token**（xoxp- 开头），在开图添加 Slack 账号。
3. 从 Slack 会话详情或浏览器地址复制 C / G / D 开头的会话 ID，填入新增会话 ID 并保存。
   勾选的频道、群组私信、私信才会采集。取消所有勾选可停止拉取该账号的会话。

默认每 5 分钟轮询，本地接口 `add` 可设 `intervalMinutes` 为 5–15。
从选择会话的时刻开始收新消息，也分页扫描旧线程的新回复；一次最多扫描 10 页频道历史，长历史会跨轮续拉。
每个分页进度保存在本机，网络失败或限流后下轮重试，不推进未完成页。重新勾选从新的选择时刻开始。

manifest 只有 `channels:history`、`groups:history`、`im:history`、`mpim:history`、`users:read`。
这些 scope 不允许列出全部频道目录，因此需粘贴会话 ID，不额外申请目录或发送权限。
[Slack 官方读取规则](https://docs.slack.dev/reference/methods/conversations.history/) 和
[线程读取规则](https://docs.slack.dev/reference/methods/conversations.replies/) 适用于用户有权访问的会话。

## 飞书

1. 在 [飞书开放平台](https://open.feishu.cn/app) 创建企业自建应用，启用机器人能力。
2. 开通 `im:message.p2p_msg:readonly` 接收发给机器人的私信，群聊使用 `im:message.group_at_msg:readonly`。
   若需要所在群的全部用户消息，需企业批准 `im:message.group_msg` 权限；不申请发送权限。
3. 事件与回调 → 使用长连接接收事件 → 订阅 `im.message.receive_v1`，发布应用版本并设置可用范围。
4. 在开图添加 App ID / App Secret，测试连接；把机器人加入要接收的测试群，或直接私聊机器人。

**只能收到机器人所在群和发给机器人的私信，无法读取个人的其他聊天。**
只开群 @权限时，群里必须 @机器人。参见 [官方事件说明](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive)。
只接收平台推送，不回灌离线期间的历史消息；平台可能重推，按 message_id 去重。
支持文本、富文本 post 与提及；图片 / 文件 / 音频仅留类型占位，不下载附件。
原文链接打开所在会话，笔记同时保留 message_id；尚不能直接定位原消息。

## 本机设置与接口

账号配置、凭据、游标、状态在 `localStateRoot/collectors/`，JSON 文件权限 600。
工作区中没有凭据；同账号由本机锁保护。关闭开图会停止采集，另一运行中的开图进程可接手。
另一进程修改设置后最多 10 秒同步生效。断开删除本机配置与凭据，保留已接收的笔记。

独立 App / 本地工作台：`POST /api/channels/{list,add,test,disconnect,select,gmail-login}`，请求体为 JSON 对象，
带现有工作台的 `X-Kaitu: 1` 与同源 Origin。`list` 返回渠道、连接状态、上次拉取、错误原因和选择范围。
`gmail-login` 打开系统浏览器并返回等待状态，`list` 提供 `gmailConfigured` 与安全的授权错误信息。
`add` 使用设置表单同名字段（不接受 Gmail 令牌）；`test` / `disconnect` 使用 `{id}`；`select` 使用 `{id, ids: [...]}`。
DSH 对应 `kaitu.channelSettings(operation, JSON.stringify(input))`，返回同一结果的 JSON 字符串。
接口不会返回密码、token 或应用密钥。不要把凭据写在 URL 或工作区文件里。

原有会回复消息的手机通道是另一项功能，见 [手机通道](phone-channels.md)，不会由此入口启动。
