# 邮件与聊天改版交审

工作树：`/Users/yihongguo/Developer/rensheng-kaitu-channel-ui`，分支 `codex/channel-ui`，起点 `5e17ba0`。

## 实现范围

- Gmail 使用桌面 OAuth、系统浏览器、本机回环回调、state 与 PKCE S256，只请求 `gmail.readonly`。
- Gmail API 首次分页读取收件箱，随后按 history 游标增量拉取；404 回退扫描，消息重复投递沿用现有文件名去重。
- `format=metadata`，仅保存标题、来源、最多 280 字 snippet 与链接，保留不可信资料标注；没有写邮件的 API 调用。
- 凭据、令牌、游标只进工作区外本机状态目录，令牌文件权限 600，接口不返回；断开调用撤销并清除本机令牌。
- Gmail、其他邮箱、Slack、飞书四张卡片移入「AI 与连接」正文，同级于已有 AI 与存放位置区块。
- 邮箱服务商说明与官方链接、Gmail 应用专用密码备选、Outlook OAuth 限制、高级设置、Slack manifest 一键导入及频道选择、飞书长连接指引。
- 收件箱显示实际采集状态，未连接入口可跳到新卡片；识别既有采集笔记的邮件、Slack、飞书来源。
- 仅修改邮件与聊天相关代码；没有修改 PRD §6、schemas 或模型配置区块。

## 检查与证据

只新增 `packages/channels/test/gmail.test.ts` 的两项行为测试，使用本机假 OAuth/Gmail HTTP 服务，不连接 Google。
覆盖 state 拒绝、PKCE 交换、刷新、初次与增量拉取、重复不重写、280 字截断、工作区与 list 接口无令牌、600 权限、撤销及删除。

完整检查结果见 [CHECKS.md](CHECKS.md)。首次全量测试出现既有 onboarding 两个用例的 15 秒超时（156 项通过），按单 worker 重跑全部测试，不改超时或断言。

截图来自本工作树构建的 `kaitu ui --port 4916 --no-open`，临时 HOME 与 `init --sample` 合成工作区，未使用 Computer Use。
浏览器禁止访问非本机地址，没有真实账号或凭据：

- [浅色](light.png)：1280 × 1380。
- [深色](dark.png)：1280 × 1380。
- [窄屏](narrow.png)：390 × 1100，渠道卡片单列，已检查文字与控件。
- [Gmail 备选方式](gmail-dialog-dark.png)、[其他邮箱对话框](mail-dialog-dark.png)。

实际检查：打开渠道对话框、切换 Outlook 时默认只显示邮箱输入框并禁用连接按钮，展开高级后才可填 token 并启用、切换 QQ 后填写合成邮箱、检查 Slack manifest 链接、Esc 关闭并恢复焦点。
收件箱「去连接」跳转已通过，390px 文档宽度为 390px，渠道区超出视口的元素为 0，浏览器 pageerror 为 0。
另向临时工作区投递三份合成笔记，经现有后台收取后，在实际页面分别筛选出邮件、Slack、飞书。

[状态展示](states-synthetic.png)与[Slack 范围选择](slack-selection-synthetic.png)使用浏览器注入的合成 list 响应，
只用于检查已连接、错误、上次拉取及选择控件，不是平台连接证据。详情见 `browser-results.json` 与 `source-and-state-results.json`。

Google 客户端未配置的提示为真实状态；截图中的未连接状态不代表真实平台收发已经通过。

## Google Cloud 开通步骤

完整步骤与官方依据见 [channels.md](../../channels.md#开通此版本的-google-登录)。维护者需要：

1. 创建项目，启用 Gmail API。
2. 配置 OAuth 同意屏幕、品牌、支持与开发者邮箱、受众与数据访问，只添加 `gmail.readonly`。
3. 创建 Desktop app 类型客户端，启动或打包环境提供 `KAITU_GOOGLE_CLIENT_ID`，必要时一并提供 `KAITU_GOOGLE_CLIENT_SECRET`。
4. 外部 Testing 项目添加测试用户；含 Gmail scope 的 Testing 刷新令牌通常七天到期。
5. 公开发布前准备主页、隐私政策、域名验证、演示与权限用途说明，完成适用的品牌及受限 scope 验证。
   Production 状态不等于验证通过。服务器存储或传输受限数据时，可能另需安全评估，依 Google 要求确认适用范围。

没有替用户创建项目、填入真实凭据、添加测试用户、提交验证或发布应用；真实 Google 登录、Gmail 实收、打包后的系统浏览器往返未验证。
Slack、飞书和其他邮箱的真实凭据连接本轮未验证。浏览器测试阻断外网，官方链接仅检查目标，未执行平台建应用流程。

## 合并接点：SEC-07

本工作树起点尚无 `codex/security` 的 SEC-07 修复。当前 IMAP 会先写普通收件箱，再把识别出的可信银行邮件写本机候选。
Gmail 按用户允许的现有接线复用该行为，只采信 Gmail API 返回、认证服务为 `mx.google.com` 的 Authentication-Results 中的 DMARC pass。
不能把这条接线称为 SEC-07 已修复：与安全分支整合时须将已识别可信银行通知改为**只进入本机候选、不进入普通收件箱**，并对齐其身份边界。
本分支不修改共享接收器与财务存储边界，避免覆盖安全分支方案。

Gmail 采集提交：`211b8c3`。界面与原型另作一个提交。保留本地提交供交审，不推送、不合并。
