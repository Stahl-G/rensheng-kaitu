# 邮件与聊天收件箱

开图 → 右上角 → AI 与连接 → 邮件与聊天收件箱。添加账号后，开图保持运行即可自动接收。
不需要 Codex CLI 或另装服务；只保存来源、发件人、时间、标题、最多 280 字摘录与原文链接。
消息作为不可信资料进入现有收件箱，后续整理为待确认建议。

## IMAP 邮件

选择邮箱服务，填写账号名称、邮箱账号、应用专用密码 / 授权码，点击添加，再测试连接。
支持自填服务器和文件夹，默认 TLS 993、INBOX。首次连接只记录当前位置；重新连接从本机游标续接。
UIDVALIDITY 改变时重新建立当前位置，不回灌历史邮件。超过 1 MiB 的邮件跳过，附件不保存。

| 邮箱 | 预置服务器 | 凭据入口 |
|---|---|---|
| Gmail | imap.gmail.com | [Google 账户应用专用密码](https://support.google.com/mail/answer/185833)，先开启两步验证；组织策略可能禁用 |
| iCloud | imap.mail.me.com | [Apple 账户](https://support.apple.com/102654) → 登录和安全 → App 专用密码 |
| Outlook | outlook.office365.com | [Microsoft 要求 OAuth2](https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com)；手填 IMAP access token，应用密码不可用 |
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

## 本机设置与接口

账号配置、凭据、游标、状态在 `localStateRoot/collectors/`，JSON 文件权限 600。
工作区中没有凭据；同账号由本机锁保护。关闭开图会停止采集，另一运行中的开图进程可接手。
另一进程修改设置后最多 10 秒同步生效。断开删除本机配置与凭据，保留已接收的笔记。

独立 App / 本地工作台：`POST /api/channels/{list,add,test,disconnect,select}`，请求体为 JSON 对象，
带现有工作台的 `X-Kaitu: 1` 与同源 Origin。`list` 返回渠道、连接状态、上次拉取、错误原因和选择范围。
`add` 使用设置表单同名字段；`test` / `disconnect` 使用 `{id}`；`select` 使用 `{id, ids: [...]}`。
DSH 对应 `kaitu.channelSettings(operation, JSON.stringify(input))`，返回同一结果的 JSON 字符串。
接口不会返回密码、token 或应用密钥。不要把凭据写在 URL 或工作区文件里。

原有会回复消息的手机通道是另一项功能，见 [手机通道](phone-channels.md)，不会由此入口启动。
