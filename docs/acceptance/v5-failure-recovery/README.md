# V5 失败与恢复：真实本机 HTTP 验收

本轮发现并最小修复三处错误原因丢失：损坏的 YAML frontmatter、同步冲突后再次本机编辑，以及非法 JSON 请求。**本机 HTTP 与合成资料的恢复通过；真实 GitHub/云盘、Electron GUI、iCloud 占位文件未验。** 不能据此宣称 V5 全平台验收通过。

基线 main：`e2d9cd83a176bf2fc6b35bc1dabe7f92f32bc9d6`；修复与脚本固定提交：`6afa5e68c75fa194203709a267c2db97e6c1c722`。本目录后续提交只加入报告和原始证据，最终 PR head 与 exact-head CI 记录在 PR 描述中。

## 环境与复现

Linux 6.18.55 x86_64、Node v24.19.0、pnpm 11.25.0。所有 HOME、KAITU_DIR、KAITU_APP_HOME、KAITU_LOCAL_STATE_DIR、XDG_STATE_HOME、LOCALAPPDATA 均指向脚本新建的 `/tmp/kaitu-v5-*`。没有访问用户资料目录、账号、云盘或真实外部服务。未改主机网络、文件权限或系统设置；未 mock 全局 fetch、Git、时间或伪造 mtime；没有提高阈值或超时。

先读根 AGENTS、docs/GOAL、PRODUCT、HANDOFF，以及模板 onboarding、import-chatgpt-memory、project 技能。根工作区 `.agents` 无可用文件，仓库没有另一个 `.agents` 目录；相关技能正本在 `templates/kaitu/.agents/skills/`。

从仓库根目录构建后运行：

```sh
pnpm build
node docs/acceptance/v5-failure-recovery/run.mjs /tmp/kaitu-v5-evidence.json
```

脚本使用真实 `initWorkspace`、默认 CLI/Web 引擎、`startUi`、文件读写和普通版本库；HTTP 均为 `127.0.0.1` 随机端口。保留合成临时目录供复核，输出中含其路径。`baseline.json` 是 main 上的完整首次有效复现（尚无后加的采纳恢复步骤）；`final.json` 是固定修复提交上的完整复验。早期夹具错误（接口名错误、日程缺起止时间）没有用作验收证据，已修正并重新运行。

## 1. 应用请求连接失败与恢复

步骤：先由本机服务实际监听随机端口；关闭后，将其 `/v1` 地址作为自定义模型 Base URL，通过 `POST /api/product/askConfigure` 发起连接。再在同一个端口恢复本机受控模型服务，重新提交；最后沿用已保存凭据重试连接。

- 失败真实 HTTP 400：`code: AI_NETWORK`，提示检查网络、代理和 Base URL。闭端口制造真实连接拒绝，没有将 fetch 替换成异常函数。
- 失败前/后 `state/web-ai/kaitu-ai.json` 均不存在；恢复后存在，`askSettings.configured=true`。原文文件逐字节保持。
- 恢复服务实际收到 `/v1/chat/completions`、模型 `v5-synthetic` 及 `Reply OK` 验证请求；恢复配置与凭据复用均 HTTP 200。
- 根因：本机目标服务停止。现有分类和失败不保存配置已正确，无生产代码修改。
- 证据：`final.json.http` 的 askConfigure/askSettings，`connection`，`paste.original/after`。
- 限制：只验最小连接验证与配置恢复，未发真实模型会话、未验额度/代理/外部 AI 服务，更不代表 AI 生成内容正确。

## 2. 同步冲突、二次编辑与重复处理

步骤：通过显式 `BackupRemote` 入口连接合成本机 HTTP 服务，初次同步建立共同基线。将同一 `me/profile.md` 分别改为本机版和远端版后同步，真实应用 HTTP status 返回冲突及两份内容。冲突展示后再次编辑本机文件，再从 HTTP 选择远端版。读取更新后的冲突，再选择远端版并重试同一操作；再跑两次同步。

- main 对二次编辑返回 HTTP 400「请求未完成，请检查文件格式后重试」，无法解释真正的并发编辑；重复处理也同样丢失原因。
- 修复后：二次编辑 HTTP 409「本机文件又有修改，已更新对照内容，请重新选择」；文件仍为 `Local second synthetic change\n`，未覆盖。
- 重新核对后 HTTP 200，文件为 `Remote synthetic change\n`；`.kaitu/backup-conflicts/` 仅一个归档，含第二次本机编辑与远端文本。
- 再次处理 HTTP 409「找不到待处理的冲突，请刷新」，归档仍一份。恢复同步与无改动重试的 push 计数均为 1，没有重复远端写入。
- 根因：core 用普通 Error 抛出已有正确原因，HTTP 只公开 KaituError 的消息。最小修复仅将两处分支改成 `KaituError(CONFLICT)`，不改变合并、归档或数据格式。
- 证据：`baseline.json`/`final.json` 中 `http` 的 workspaceBackup 项、`syncHttp`、`conflict`。`conflict.before/afterFailure/afterResolve/archives` 为实际文件回读。
- 限制：HTTP 服务经公开的 `BackupRemote` 测试入口接入；合并、冲突持久化和 UI 使用的 HTTP 状态/处理接口真实执行，但没有覆盖 GitHub REST 适配器、真实授权和多设备同步。不能把该受控服务成功当作真实 GitHub/云盘链路通过。

## 3. 损坏 frontmatter

步骤：将合成 NOW.md 的日期改为 `date: [unterminated`，保留 frontmatter 分隔符、日程和正文。通过 `POST /api/product/decideProposal` 确认日程；回读文件。修正 YAML 后再次确认，再重试一次。

- main 返回泛化 HTTP 400，无法定位文件或格式。
- 修复后 HTTP 400：`NOW.md 的 frontmatter 无法读取（YAML BAD_INDENT）。文件已保留，请修正格式后重试。`
- 失败前后完整文本相等。修正后状态为 confirmed，`Retain this body.` 正文保持；重复确认后文件逐字节相等。
- 根因：YAMLParseError 在修改入口逸出，被 HTTP 当未知异常遮掉。仅在现有 frontmatter 修改入口捕获该已知解析错误，提供相对路径和 YAML 错误代码；未知异常继续抛出，不回显可能包含私人文本的解析器上下文。
- 证据：`frontmatter.before/afterFailure/afterRecovery/retryUnchanged`，对应 decideProposal HTTP。
- 限制：覆盖现有工作台修改入口和此 YAML 语法错误，不宣称任意损坏文件、启动时损坏配置或缺失分隔符都已完整覆盖。原始文件与正文没有自动修复或改格式。

## 4. 不合格 JSON 与恢复后去重

步骤：向保存原文接口提交截断 JSON `{"broken":`，再提交合法 JSON 但错误参数形状 `{}`。对已保存原文粘贴 `{"goal":42,"next":[]}`，然后以合法 goal/current/next 修正、采纳两次。

- 截断请求 main 返回泛化错误；修复后 HTTP 400 明确「请求内容不是合法 JSON，请修正格式后重试。」对象参数仍 HTTP 400「参数必须是数组」。非法请求不会写入；profile 前后文本相等。
- 不合格回答 HTTP 400，指出没读到目标，要求按格式贴回；最初原文逐字节保留。修正回答后可生成草稿和采纳。
- 两次采纳均返回同一个真实待办 ID `01M5AY1BFXHJYD42TKAB4TN695`；任务文件回读只有一条 open 任务，goals.json 只有一个对应目标；第二次采纳前后记录与目标文件相等。归档原文仍能通过原 source 读回。
- 根因与修复：请求 JSON.parse 的 SyntaxError 被当作未知文件错误。只将已有三个请求 JSON 解析入口合并为同一个小函数，在语法错误时抛 BAD_ARGS；不改大小限制、schema 或业务格式。不合格回答原文保留与采纳幂等已正确，无相关生产代码修改。
- 证据：`http` 的 onboardingMatterSave/Paste/Adopt 项、`invalidRequest`、`paste`。
- 限制：原文指用户最初保存的文本；失败粘贴回答没有落盘，此轮未验证浏览器文本框是否在错误后保留粘贴内容。没有浏览器或 Electron 截图，以上使用用户允许的真实 HTTP 错误证据。

## 5. iCloud 占位文件及已有修复

**iCloud 未下载占位文件：未验。** Linux 没有真实 iCloud/FileProvider，不制造普通缺失文件或同名占位文件冒充真实未下载状态。真实云盘断网、下载恢复、Windows/macOS 文件系统行为须在对应平台验收。

[PR60](https://github.com/Stahl-G/rensheng-kaitu/pull/60) 已处理后台版本权限降级与原文 retry 意图，本分支未复制；[PR62](https://github.com/Stahl-G/rensheng-kaitu/pull/62) 已处理 phone 同名 records 重投 ledger，本轮也未重写。上述测试没有声称跨 PR 集成已完成，未用 mock 成功替代真实平台权限/手机链路。

## 检查与边界

只新增两条回归：损坏请求/frontmatter 的失败保留和修正重试；同步冲突二次编辑、归档及重复处理。初次运行 2/2 通过，没有放宽 timeout、skip 或断言。源码构建通过；最终全仓 build/typecheck/lint/test 与 exact-head CI 以 PR 描述为准。

这是小型合成夹具正确性验收，没有声称大工作区性能达标。未合并、发包或部署；没有产品数据格式改动。
