# Slack 交审

实现：使用 @slack/web-api 与内部应用 user token，只读 `auth.test`、`conversations.history`、
`conversations.replies`、`users.info`、`chat.getPermalink`。不调用发送、已读、加入频道或编辑 API。
账号按 auth.test 返回的 team/user 标识去重并锁定，不把 token 当作账号标识。
设置入口支持填入会话 ID、勾选与取消采集范围；默认 5 分钟轮询，可由本地接口设置为 5–15 分钟。

处理 mrkdwn 链接、用户提及、实体和格式标记，用户名解析结果只在内存缓存。
频道历史分页扫描以发现旧线程里的新回复；仅保存选择时刻之后的消息。
同一固定时间窗口的历史页与线程页进度留本机，失败不提前推进游标；已完成页可在下轮继续。
同一消息确定性文件名复用 IMAP 的 `.note.md` 投递与归档去重。
共用渠道笔记使用 `channel-<hash>.note.md` 与既有 date 字段指定 UTC 消息日期归档；
收件箱收到已归档的同名文件时保留原笔记，避免 Drive 同步重投产生随机后缀。

来源：此提交的 Slack 采集器为独立实现，没有复制或移植 OpenClaw Slack 文件。
依赖 @slack/web-api（MIT），提供可直接导入的 docs/slack-app-manifest.json，只有用户指定的五个只读 scope。
接口与 UI 复用 IMAP 提交的基础设施，不新增数据类型或字段。

未做：不查询频道目录，因为所定 scope 不含 channels:read / groups:read / im:read / mpim:read。
用户自行粘贴会话 ID；不扩权。历史很长时每轮 10 页扫描需要多轮，期间新时间窗口会等待当前扫描结束。
未实现 Slack OAuth 登录或 token 自动刷新，使用用户自己创建的内部应用 token。

验证：一个假的传输测试覆盖所选会话、新消息、旧线程新回复、mrkdwn/用户名规整、分页中断后归档去重与凭据隔离。
测试只使用临时目录及合成消息，无 Slack 网络连接。真实 workspace 安装、权限、限流与消息链接点击未实测。
构建、类型检查、lint 通过；全量测试 48 个文件、133 项通过（单 worker，保留原有 15 秒超时）。
临时工作区的本地接口冒烟确认 list=200、缺少同源校验=403、无效账号=400；
Chrome 实际打开 AI 与连接，确认 IMAP / Slack 表单可展开和切换，没有填写真实凭据。

手动验证：导入 manifest 并安装内部应用，填入 user token，选择一个测试频道和一个私信。
在所选与未选会话分别发消息，再给旧线程补回复；等待轮询，核对只有所选内容进入收件箱，链接指向原消息。
将笔记归档后重启，确认不重复；取消勾选后确认不再读取。断开后确认本机 token 已删除。
