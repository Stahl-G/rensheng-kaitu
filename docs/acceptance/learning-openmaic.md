# 学习主题与 OpenMAIC 薄接入

基线：main `e2d9cd83a176bf2fc6b35bc1dabe7f92f32bc9d6`。分支：`codex/learning-openmaic`。
验证日期：2026-10-19 UTC。仅合成资料；未安装到用户正在运行的开图或 DSH。已补真实 DSH SDK、真实 ACP CLI 与一次本机 Qwen 流程，具体范围见末节。

## 实现范围

- 资讯「开始学习」把标题、来源链接和已有摘要带入保存表单，可归入已有主题；资料页可新建主题、粘贴材料。
- 来源放既有 `learning/<topic>/sources/*.md`；完全相同材料去重，追加材料不覆盖既有状态和笔记。
- 理解、未解问题、下一步按时间追加到 `notes.md`。下一步复用 STATUS 的 `next`；只有用户明确选择才完成旧条目，不推算掌握度。
- 接续按钮把主题指向和教学约束送入问问草稿，发送前可编辑。模型从同一主题的来源、笔记、下一步接上。
- `kaitu_learning` 提供 list/read/start/save；学习 skill 采用 OpenMAIC 一次一问、3–6 小步、先尝试再提示、用学习者原话总结的流程。
- 复用 OpenMAIC 的概念卡、自判小测、互动模拟 UI 和元数据；原始 MIT 许可证及 commit 在 `packages/core/src/learning-openmaic/`。工具名用 kaitu_learning_card/widget，避免与用户已安装插件冲突。
- 独立问问从既有对话工具结果加载 `/api/ask/teaching-frame`。单独响应使用 CSP 与 sandbox allow-scripts，阻止 workspace API 访问、表单和网络连接；主页面策略未放宽。DSH 原生会话用同一组件的 srcDoc。
- 沿用现有 Markdown 与 STATUS schema，无 schema 改动、无新课堂服务、无题库或新 session 持久协议。PPT 没有打包新 SDK，仅明确要求且工具可用时可调用已安装的 openmaic_slide。

## 验证结果与边界

- core/channels/cli TypeScript 编译、插件 host/client 类型与两个 UI 构建通过。
- 9 个针对性测试文件、29 个测试通过：DSH Remote 生成契约与后台版本、新学习文件读写、来源去重与 slug 碰撞保护、取消/超限、教学 metadata、受限 HTTP 帧，以及既有工具、skill、HTTP/SSE、ACP 会话回归。
- Computer Use 在隔离工作区验证：资讯 → 保存主题/来源 → 接续问问草稿 → 固定样例提问 → 回答后展示小测/模拟 → 手填理解/问题/下一步 → 重载后读回。
- 实际点击「11 元」显示正确反馈；模拟从第 2 期调到第 3 期显示 133.10 元。卡片从持久对话元数据重开可见，交互状态会重置。
- 这些结果证明本地链路与渲染可用，**不代表真实模型教学质量、真实模型自动保存、用户 DSH 新分支安装或 PPT 已验收**。原插件的用户亲测成功与本分支验收分开。
- 无模型时可手填并保存来源与学习记录。使用 AI 时材料由当前选定模型读取，不会另行自动发给 open.maic.chat。
- 所有构建直接用现有依赖；新增的 dev 类型引用 dsh-client-ui-tool@0.2.1-rc.2 复用本机已有包和锁文件条目，没有执行 npm/pnpm 安装。

![合成小测与互动模拟](learning-openmaic/teaching-cards.jpg)

![重开后保存的理解与下一步](learning-openmaic/saved-learning.jpg)

## 合成大工作区延迟

本机 Node 26，1000 个主题、1000 份既有笔记（每份 100 行）、1000 份来源（每份 500 行）。
20 次 localhost HTTP 读取/保存；后台版本写入沿用已有调度。

| 操作 | 结果 |
|---|---:|
| 构造 3000 个合成文件 | 615.6ms |
| startUi 返回 | 6.5ms |
| 第一次主题列表 | 152.0ms |
| 单主题读取 P50 / P95 | 1.9 / 4.6ms |
| 追加理解与下一步 P50 / P95 | 3.6 / 7.0ms |

这不是完整 App 冷启动或云盘下载基准。按钮按下立即显示保存中；UI 的交互体感通过上述浏览器操作核对。

## 用户亲测五个动作

1. 找一篇你真的想学的资讯，点「开始学习」，看来源和摘要是否带对；选择已有主题或建一个主题。
2. 点「接着学」发送草稿。故意答错或说不会，看它是否只给一个提示、能否等你回答，别只看生成材料漂不漂亮。
3. 要一个小测或模拟，操作一次，再把理由告诉 AI；确认 AI 没有假装已经看到卡片里的答案。
4. 用自己的话留一条理解、一条没懂的问题和一个很小的下一步；看今天页是否出现该动作，不把看完算作学会。
5. 关掉再开，从资料里回到同一主题，看它能否读到上次的问题并接着问。PPT 只在你明确需要时另试。

## PR 审查后的五项修复

| 问题 | 最小处理 | 回归证据 |
|---|---|---|
| 旧 STATUS 简写在详情被拒绝 | 与校验器、列表一样先 normalizeStatus；正文保留 | learning.test.ts 的无 updated / next 字符串旧文档可读、添资料、保存 |
| 已保存但响应丢失后重试重复总结 / 完成报错 | 新 save API 要求 operationId；界面同一未确认请求重用 ID，本地 `.kaitu/cache/learning-operations/<hash>.json` 记 topic 与输入 hash；完成回执先于下一步检查 | 跨 Workspace 重开重试不追加，换 ID 可记录相同理解；同 ID 换内容拒绝 |
| 保存 A 期间切 B 导致迟到响应覆盖 | 保存中锁主题切换、编辑、接续与取消；组件卸载后忽略写回本地 UI | 挂起服务桩下 B 与编辑框 disabled，释放保存后可编辑 B |
| 另一 Agent 保留 id 但改任务标题，旧界面误完成 | 完成须同时提交已读的 completedNextTitle；当前标题/status 不符则拒绝；重读主题保留本次输入 | 改名后旧提交失败，状态与笔记未变化 |
| 同主题同文字二次接续无草稿 | Overview 每次点击增加 promptRequest；独立 AskPage 和原生 PluginAsk 都接收该动作 | 实际独立页发送→回主题→再接续恢复草稿；原生适配器服务桩清空→再点击注入次数 1→2 |

操作回执是本机可丢弃的缓存，不是学习资料格式；不改 STATUS、notes 或来源 schema，不同步到第二台设备。
只保障已完成且回执仍在的同一次请求重试；不宣称多文件写入具有崩溃事务语义。另一次学习必须用新 ID，不按内容做全局去重。

## 运行环境与能力边界

| 环境 | OpenMAIC 插件未安装 | OpenMAIC 插件已安装 |
|---|---|---|
| 安装本分支开图插件的 DSH 原生会话 | 开图自带 kaitu_learning 和 card/widget；来源、保存、接续及教学卡片不依赖上游插件；无 PPT 工具则文字教学 | 在**同一 DSH profile** 安装时，开图的独立工具名不会覆盖上游；用户明确要求且会话列出 openmaic_slide 时可选 PPT |
| Kaitu.app / CLI-Web 内置 DSH（含自带登录或用户配置的外部 API 服务商） | 构建产物自带开图 SDK 插件和复用的 UI；card/widget 从已有工具元数据呈现。默认不打包 OpenMAIC SDK/课堂/PPT | 用户在另一个 DeepSeek Harness App 装插件，不会自动进入开图隔离的 DSH profile；本次能力与左列相同，不因此声称 PPT 可用 |
| 外部本机 Agent 的 ACP 模式（choice=local） | ACP 会话只注入现有开图 MCP；目前 MCP 无 kaitu_learning/card/widget，ACP 适配器也不传教学 meta。提示改为读技能/主题文件、文字练习；若该 Agent 有文件写权限，可写现有 Markdown，否则用户回资料页手填 | 装在 DSH 的 OpenMAIC 不会自动进入 ACP Agent。此 PR 不新增 ACP 卡片或 MCP 教学协议，行为同左列 |

“外部 API 服务商”仍走内置 DSH；“外部 ACP Agent”是不同运行时，不应混称。
源码依据：`packages/dsh-plugin/src/tools.ts`、`learning-tools.ts`、`client/index.tsx`、`packages/desktop/sdk-runtime.mjs`、`packages/cli/runtime/service.mjs`、`local-agents/runtime.ts`、`mcp/server.ts`。
以上模式边界来自源码和运行验证。真实 DSH / ACP 补验见末节；未使用用户付费账号或用户正在运行的 DSH 安装，教学质量仍需用户体验。

## 可复现的独立合成验收

前置：仓库依赖已就绪。这次只复用现有依赖，没有 npm/pnpm 安装。先生成本分支构建产物：

```sh
node node_modules/typescript/bin/tsc -p packages/core/tsconfig.json
node node_modules/typescript/bin/tsc -p packages/channels/tsconfig.json
node node_modules/typescript/bin/tsc -p packages/cli/tsconfig.json
node packages/dsh-plugin/scripts/build.mjs
node scripts/learning-smoke.mjs --check
```

`--check` 在全新临时目录中自动走来源保存、固定问答事件、受限教学帧、保存与同 ID 重试、重开读取，输出 PASS 后清理。
它不证明浏览器执行 JS 或真实模型理解，仅验证本地 HTTP/文件/元数据链路。

浏览器体验：运行 `node scripts/learning-smoke.mjs --port 4890`，打开输出的 URL。
该脚本只生成合成工作区和固定回复，不启动真实 AI Runtime、不读取用户资料或模型配置；Ctrl+C 清理。
使用 `scripts/fixtures/learning-openmaic.json` 中的标题、回答与 checkin，按上面的五个动作操作。
第一次问问若出现自动任务引导，选「都不要」。同主题二次接续额外步骤：发送草稿后回资料→笔记与决策→原主题→再次「接着学」，应再次填入同一文字，而非空草稿。

竞态与原生草稿桩页：运行 `node scripts/learning-ui-smoke.mjs` 并打开输出 URL。
输入 A 的理解→保存但不点「完成挂起保存」，核对 B 和编辑框禁用；完成挂起保存后再切 B，B 输入可正常编辑。
下方是实际 PluginAsk 组件配合合成会话服务：先清空草稿，再点「再次接着学（相同文字）」，草稿恢复、注入次数增加。
这是适配器逻辑回归，不是原生 DSH App 的真人验收；Ctrl+C 清理构建临时目录。

![挂起保存锁定编辑](learning-openmaic/save-lock.jpg)

![原生适配器相同文字重新注入](learning-openmaic/native-repeat-draft.jpg)

![独立问问同主题二次接续](learning-openmaic/repeat-draft.jpg)

## 真实运行时补验（2026-10-19 UTC）

- 内置 DSH：使用仓库自带 Node 版 0.2.1-rc.2 引擎、实际 SDK 插件和真实工具执行，以本机受控 OpenAI HTTP 响应提供固定工具请求。read → card/widget → save → 关闭并重开 Ask/UI → read 通过，共 10 个本机 HTTP 请求。不是直接注入 Ask 事件，也不算模型教学质量验收。浏览器从保存的会话重开小测，错答有提示、正确答案有反馈；模拟调到第 3 期显示 133.10 元。资料页读回相同理解、问题、下一步，再点接续可填入草稿。
- 外部 ACP：实际安装的 claude-agent-acp 0.55.0，独立 HOME / CLAUDE_CONFIG_DIR、明确列出的环境变量和本机受控 Anthropic HTTP 响应。通过实际 Kaitu MCP read_file 和 Claude 自有 Read / Write 保存同一 Markdown；重建 Ask/UI 后真实 session/load 可继续读取，共 14 个本机请求。无 kaitu_learning/card/widget 时使用文字反馈；没有把 DSH 卡片能力算进 ACP。首次 notes.md 尚不存在是预期空记录。
- 这次真实 ACP 发现内容块为 `{type:"content",content:{type:"text",text}}`，原问问详情显示为空。现转换成既有平面文本块；真实 CLI 的缺文件错误已在浏览器展开可见，已有适配器测试补了对应回归。接续提示及技能说明新主题可尚无 notes.md。
- 真实模型：Ollama 0.24.0 + 已存在的 qwen2.5:14b，无下载、无付费账号。通过真实 DSH 从合成来源提问 → 对学习者回答反馈 → 工具实际保存理解/问题/下一步 → 关闭重开后工具读回并从“连续复利为什么出现 e”接续，共 8 个本机模型端点请求。先前一次把 questions/next 写成数组、operationId 放错层，被校验拒绝且未写入；补充工具说明中的明确参数示例后重跑通过。首次大上下文耗时明显，曾在 180 秒内未完成；不能据此承诺响应速度、通用模型可靠性或 3–6 步教学质量。
- 父线程独立 Linux 动态 QA：准确 SHA `929d7fc85ea8fe7756519b593920cce2c0357bca`、Node 24.19，完整 build 通过；来源去重 → 保存并完成旧下一步 → 服务端 200 后丢响应使客户端 fetch failed → SIGKILL → 新 PID 重启 → 回读 → 同 operationId 并发重试均 replayed:true，notes / STATUS 字节不变；同 ID 改内容返回 400 且无写入。该检查没有浏览器或真实模型，不扩大为这些路线已验收。

重复运行真实运行时合成验收（构建后）：

```sh
node packages/cli/scripts/build-engine.mjs
node scripts/learning-runtime-smoke.mjs
node scripts/learning-acp-smoke.mjs /absolute/path/to/claude-agent-acp
```

ACP 命令只使用已安装 CLI，不安装依赖。两个脚本都使用临时合成工作区、本机固定响应、独立登录目录，不读取用户资料或登录，不产生模型推理费用。输出实际临时目录；可加 `--hold`，按最后输出的 URL 做浏览器回看，Ctrl+C 关闭。未把本机 Qwen 探索脚本纳入默认检查，避免隐式启动模型。

![实际 DSH 工具结果的小测与模拟](learning-openmaic/actual-sdk-cards.jpg)

![实际工具保存后从资料页回读](learning-openmaic/actual-sdk-reopen.jpg)

![实际 ACP 工具错误详情可见](learning-openmaic/actual-acp-error.jpg)
