# CodeBuddy ACP 本地验收（2026-10-18）

开发分支 `codex/codebuddy-acp`。初始本地提交 `4c949cc` 基于 `b9f361c`；首次推送前移到 main `d48c52a`，得到 `d78f6b6`，排除其他 Agent 的两条手机日历提交。草稿 PR：[#16](https://github.com/Stahl-G/rensheng-kaitu/pull/16)。
接续开图本机 Agent snapshot `47ce1c0085d516e9094efb84a308e0f0032f5022`，本轮只开放 CodeBuddy。
本机 CLI 包版本 `@tencent-ai/codebuddy-code 2.154.0`。

## 行为与范围

- 「连接 AI」新增「用本机 CodeBuddy」；原有 API Key / DeepSeek 和手动资料包入口保留。
- 自动发现 CLI（PATH、常用安装目录、nvm、Windows npm），允许填写绝对路径。
- 检测到可执行文件只说明已安装；首次对话才验证登录和 ACP。不开登录窗口、不调用 authenticate、不复制或重置凭据。
- 仅完整 Agent 模式可发送。沿用每个对话的完整模式确认；CodeBuddy 原生权限请求只选一次允许，不写全局授权规则，不传 bypass 参数。
- 云模型正常推理不逐次确认。提示词要求最少读取、不得擅自向其他网站/消息/公开仓库发送私料；不将提示词称为隔离保证。
- 应用只发送当前用户文字与固定隐私指令，不自动注入全部档案。CodeBuddy 自身的上下文与工具仍由宿主管理。
- 会话按工作区、实际 CLI 路径及后端分开。旧对话切换后端后必须新建；不把历史内容重放给另一后端。
- 文本增量经 SSE 展示，最终消息才写一次对话日志；支持取消、退出清理及原生会话恢复。首版禁用附件和 DSH 专属引用/模型切换。
- 开图 MCP 按会话注入；完整 Agent 自带文件/命令能力仍然存在。

## 已通过

1. Mac 本机实际 CLI：使用已有登录，3 次纯合成任务。
   - 第一轮：流式回复合成标记 `KAITU_SYNTHETIC_842`。
   - 关闭 runtime 后第二轮：恢复同一会话，回忆标记，使用原生工具写入临时 `ACP-SMOKE.txt` 并回读验证。
   - 第三轮：发送合成取消任务后取消，返回 idle；应用关闭后清理本轮启动的进程。
   - 对话经过实际 `createAskService` 持久化，再创建服务恢复。未发送个人档案、健康或财务资料；未读取凭据。
   - 初次沙箱内尝试未完成握手，未发送模型 prompt；上述三次为之后已授权的本机运行。后续没有重跑付费任务。
2. 打包后的 `dist/engine/mcp-stdio.mjs`：标准 MCP client 握手并发现 38 个工具，调用 `task_add` 保存合成待办，通过 core `listTasks` 回读。此验证不调用模型。CodeBuddy 调用该开图工具的真实模型回合未另行增加。
3. 相关回归：6 个文件、11 项测试通过：
   `codebuddy.test.ts`、`ask.test.ts`、`ask-mode.test.ts`、`ask-filesystem.test.ts`、`security-ask.test.ts`、桌面 `web.test.ts`。
   覆盖 stdio 流、保存与恢复、取消、出错后重试、后端切换阻断、原 SDK 入口保留、Windows npm shim 解析以及现有资料与联网边界。
4. CLI、插件服务端和客户端 TypeScript 检查；插件构建、CLI engine/helper 构建；修改文件 Biome 与 `git diff --check`。
5. 独立合成 Web 工作区：浏览器实际选择 CodeBuddy，显示数据流与完整 Agent 提醒，保存连接；附件置灰。截图见 [connection.png](connection.png)。最后一次新增的模式标签复查遇到浏览器连接中断，未将其记为人工通过。

## 已知限制与后续验收

- Windows 未真机验收；当前只有跨平台实现和合成 shim 测试。进程退出使用本轮拥有的 PID 树，不按进程名关闭用户已有 CLI。
- 原生 App 的独立打包、签名和启动已通过，追加记录见下；没有安装/替换正在使用的 App，没有影响 iOS/TestFlight。
- `packages/desktop/test/providers.test.ts` 中原生 DSH 自定义提供商测试返回 400（预期 200）。在此独立工作树临时恢复基线 AskService 后重跑，得到相同失败；已恢复 ACP 代码。该失败不作为本轮通过项。
- 安装依赖的离线缓存缺包，本轮没有下载依赖，使用已有依赖目录的只读链接。没有修改锁文件。
- 用户已授权推送并创建草稿 PR；未合并、未启用自动合并、未发布版本。排期仍由用户决定。

## 代码与许可证

- 适配实现：`packages/cli/src/local-agents/`；桌面装配 `packages/desktop/local.mjs`；CLI/Web 装配 `packages/cli/runtime/service.mjs`。
- 界面：`packages/dsh-plugin/src/client/AskPage.tsx`；日志与后端绑定：`packages/cli/src/ui/ask.ts`。
- BriefLoop 参考版本和许可说明：`third_party/briefloop/NOTICE.md`、`LICENSE`。本轮没有分发其 Python runtime 或 Open Design bundle。

## 原生包追加验收

- 产物：`/tmp/kaitu-acp-native/Kaitu.app`（macOS arm64，ad-hoc 本地测试签名）；ZIP 保存于本任务 `native-acceptance/Kaitu-ACP-test.zip`，包含 App 和隔离启动脚本/说明，不包含验收 profile 或工作区。未公证、未作为发布包分发。ZIP 附带 `Run-isolated.command`：完整解压后用该脚本启动，profile、workspace 和 local-state 放在脚本旁边；不要直接启动 App 进入日常 profile。测试不改变发行源码的默认目录。
- `codesign --verify --deep --strict` 通过；ASAR 的 7 个新增/修改文件逐字节自检通过，原包 unpacked 状态一致。源 App 仅作为只读打包输入。
- 初次输出到 Documents 的两次签名校验遇到 Finder 元数据错误；改用 `/tmp` 生成包。打包脚本增量仅清理新输出包上的 `com.apple.FinderInfo`、`com.apple.ResourceFork`，在签名前后执行，保留 quarantine。只读扫描打包输入未发现 quarantine 属性；没有绕过系统警告。
- 指定独立 `KAITU_APP_HOME`、`KAITU_DIR`、`KAITU_LOCAL_STATE_DIR` 和随机端口；原生窗口显示空白欢迎页，进入问问。未出现新的系统权限请求。CUA 后续传输中断，因此没有将完整按钮点击流程计为通过。
- 通过该原生 App 实际启动的本机服务接口，检测到 `/opt/homebrew/bin/codebuddy`，未启动真实模型。随后切换为模拟 CLI，验证：默认模式拒绝发送、完整模式发送、正文流、保存临时文件、取消、重建 runtime 后原生会话恢复、切换后端阻断旧线程、DeepSeek 默认入口保留。结果见 [native-result.json](native-result.json)。追加验收真实模型调用次数为 0。
- CUA 无法恢复，退出采用只针对已记录且再次核对路径的本任务 PID 发送 SIGTERM；App、其活动模拟 ACP 子进程及本机端口约 5.4 秒内全部退出，见 [exit-result.json](exit-result.json)。这不代替“点击原生退出菜单”的人工验收；后者仍待补。
- main 基线重放后的聚合回归：88 个测试文件，87 通过 / 1 失败；245 项测试，244 通过 / 1 失败。唯一失败为 DSH 原生自定义提供商测试（预期 200，实际 400），见 [aggregate-tests.txt](aggregate-tests.txt)。先前临时恢复基线 AskService 单独运行同文件，同样 1 通过 / 1 失败；`sdk-runtime.mjs`、`sdk-credentials.mjs` 和 `providers.test.ts` 均未因本任务改动。
- 构建：core、channels、CLI、插件及打包 helper；CLI、插件服务端/客户端、Web TypeScript 检查通过。全仓 Biome 检查 463 文件通过。

剩余发布前验证：原生 GUI 退出菜单、Windows 真机。未请求或操作 Windows 电脑。

额外尝试过测试专用 bundle 标识及默认目录 launcher；该额外产物的启动探针未通过，已撤回这部分产物定制。最终包保留已通过原生功能验收的标准 App 结构，使用附带脚本隔离 profile，不把额外探针记为通过。

最终 ZIP SHA-256：`9001b83d5c74eee94c5c42c66d09e9efe35523de500cdbe6f3a3abcc2fbdbbe0`；包内容核对见 [artifact.json](artifact.json)。
