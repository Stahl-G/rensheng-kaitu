# 微信文本通道来源

来源：腾讯官方 npm 包 `@tencent-weixin/openclaw-weixin@2.4.10`，MIT。
原始许可证逐字保存在 [LICENSE](LICENSE)。本次使用用户提供的本地源码，没有联网拉取。

| 上游文件 | 此处保留的部分 |
|---|---|
| `src/auth/login-qr.ts` | 获取登录链接、轮询状态、扫码确认、验证码、机房跳转、过期刷新与已有绑定处理 → `login.ts` |
| `src/api/api.ts` | iLink 请求头、版本编码、getupdates / sendmessage 请求、uint64 ID 无损解析 → `api.ts` |
| `src/api/types.ts` | 文本项、消息类型 / 状态、游标与轮询超时字段 → `index.ts` 的最小类型 |
| `src/monitor/monitor.ts`、`src/storage/sync-buf.ts` | 长轮询、保存游标、出错重试与停止逻辑 → `index.ts` |
| `src/messaging/send.ts` | 单文本项发送载荷、context_token、client_id → `index.ts` |
| `package.json` | `ilink_appid: bot`、版本 `2.4.10` 用于协议请求头 |

移除了 OpenClaw 插件、路由、Agent、配置、账号索引、日志、媒体 / CDN、引用缓存和输入输出钩子。
本机凭据统一使用开图 secrets.json；游标放本机状态目录，按账号区分；配对由开图统一处理，扫码本身不授予消息权限。
`bot_agent` 改为 `Kaitu/0.0.0`，client_id 改为 `kaitu-<UUID>`；保持上游协议版本与 iLink App ID。
请求用 Node 内置 fetch / AbortSignal，停止时取消请求，不记录请求体、响应体和 token。
二维码展示不依赖 `qrcode-terminal`，终端打印登录链接并提示用手机微信打开；未提供工作台二维码图片。
服务器返回的机房地址仅接受 HTTPS 的 `*.weixin.qq.com`。不支持图片、语音、文件、群聊。

对照上游时重点检查：登录状态分支、请求头版本、消息结构、context_token 和游标语义。
当前只完成源码对照与本地构建，扫码、真实收发、账号资格与重连仍需用户实测。
