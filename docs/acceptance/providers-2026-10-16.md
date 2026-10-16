# 问问多提供方交审（2026-10-16）

工作树：`rensheng-kaitu-providers`，分支 `codex/providers`，基于 `main 5e17ba0`。
后端提交：`68b0ac5`。界面、文案与本说明在第二个提交中。

## 提供方与核实结果

读取 rc.2 的 `packages/llm/llm-pi-ai/README.zh.md`，并从实际安装的
`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 提取模型目录。
目录路径为 `dsh/node_modules/@earendil-works/pi-ai/dist/providers/data/*.json`。
另核对打包的 `dsh-llm-deepseek-api-key` 原生目录和协议，保留 `deepseek-official` 路由。

以下选项均用该打包产物、合成本机凭据和临时工作区完成真实 SDK `initialize`，未调用外部模型。
初始化会解析所选路由、模型和凭据，不只是检查文件存在。记录见 [SDK 初始化结果](providers-2026-10-16/sdk-initialize.txt)。

| 选项 | 默认模型；其他可选模型 | 核实方式 | 图片 |
|---|---|---|---|
| DeepSeek（推荐） | `deepseek-flash`；`deepseek-v4-pro` | 原生适配器目录、SDK 初始化 | Flash 支持，V4 Pro 按原生目录仅文字 |
| OpenAI | `gpt-4.1-mini`；`gpt-4.1` | `openai.json`、Responses 协议、SDK 初始化 | 均支持 |
| Anthropic Claude | `claude-sonnet-4-5`；`claude-haiku-4-5` | `anthropic.json`、Messages 协议、SDK 初始化 | 均支持 |
| Google Gemini | `gemini-2.5-flash`；`gemini-2.5-pro` | `google.json`、原生 Google 协议、SDK 初始化 | 均支持 |
| OpenRouter | `openai/gpt-4.1-mini`；`moonshotai/kimi-k2` | `openrouter.json` 的 Chat Completions 目录、SDK 初始化 | 前者支持，后者仅文字 |
| Kimi | `kimi-k2.6`；`kimi-k2.7-code` | `moonshotai-cn.json`、SDK 初始化 | 均支持 |
| 智谱 | `glm-4.7`；`glm-4.6v` | 国内官方 OpenAI 兼容端点、pi-ai 声明路由、SDK 初始化 | 前者仅文字，后者支持 |
| 通义千问 | `qwen-plus`；`qwen-vl-plus` | 百炼官方 OpenAI 兼容端点、pi-ai 声明路由、SDK 初始化 | 前者仅文字，后者支持 |
| 自定义（OpenAI 兼容） | 用户填写模型 ID | pi-ai 声明路由、SDK 初始化、本地假服务器完整回复 | 未知能力按仅文字处理 |

智谱不沿用 `zai.json` 中的海外 Coding 端点。国内两条声明路由分别使用
`https://open.bigmodel.cn/api/paas/v4` 和 `https://dashscope.aliyuncs.com/compatible-mode/v1`。
Kimi 使用国内目录的 `https://api.moonshot.cn/v1`。
端点依据：[Kimi 官方示例](https://platform.kimi.com/docs/get-api-key)、
[智谱 OpenAI 兼容说明](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)、
[百炼 OpenAI 兼容说明](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)。
申请 Key 的官方入口随每个提供方在对话框中显示，自定义服务由用户提供端点及凭据。

## 已验证的行为

- 验证成功后才保存 Key 和选择。凭据继续由 `LocalCredentialProvider` 管理，运行时通过 `apiKeyEnv` 引用读取。
  `kaitu-ai.json` 只保存连接方式、提供方、模型及自定义 Base URL，运行时 patch 只含凭据引用。
- 仅新增两个行为测试，使用合成 Key 和本地 HTTP 服务器。
  测试实际运行凭据助手与 HTTP 问问接口，确认配置、接口返回和助手输出不带 Key。
  另覆盖 Key 无效、余额/额度不足、限流、模型不可用、服务异常与网络失败，错误消息不会回到「检查文件格式」。
- 验证响应中的原始错误即使回显 Key，也不会作为错误文案返回。其他服务异常显示简短 HTTP 原因。
- 使用真实 rc.2 SDK、pi-ai 和本地假模型完成流式回复，再经 `ask.configure` 复用已存 Key 切换模型。
  同一个会话的下一条模型请求使用新模型，新会话仍为 `scoped`。
  记录见 [本地问答与切换](providers-2026-10-16/sdk-chat.txt)。
- 图片前端限制为一张、不超过 2MB 的 PNG/JPG/WebP/GIF，服务端复核模型能力和输入。
  新会话与恢复会话均通过 SDK 附件存储接收图片，未接受任意本机文件路径。
  另用内存中声明图片能力的本地假模型验证两次图片请求，假服务器均收到图片块；
  该声明只用于临时验证，不改变产品中的自定义模型能力。见 [SDK 图片链路](providers-2026-10-16/sdk-image.txt)。
- 未修改 `sdkRuntimePatch` 的权限部分、`sdk-host.mjs`、PRD §6 或 `schemas/`。
  既有完整 Agent 二次确认和模式切换回归通过。

## 浏览器验收

实际运行 `node packages/cli/dist/main.js ui --dir <临时工作区> --port 4971 --no-open`。
浏览器只把问问与设置请求转发给同机 `startUi` 服务中的真实 SDK 凭据适配器，其他页面直接使用 CLI 服务。
两者共用同一份合成工作区，连接验证只访问本机假服务器。未使用 Computer Use。

- [默认 DeepSeek 推荐与模型选择](providers-2026-10-16/01-connect-default.png)
- [Key 错误与操作提示](providers-2026-10-16/02-key-error.png)
- [本地自定义服务连接成功、图片能力说明](providers-2026-10-16/03-local-connection.png)
- [AI 与连接中的当前服务和模型](providers-2026-10-16/04-settings.png)
- [DeepSeek Flash 图片按钮及合成图片预览](providers-2026-10-16/05-image-enabled.png)
- [390px 暗色、文字模型禁用图片并显示原因](providers-2026-10-16/06-mobile-dark-text-only.png)
- [390px 暗色连接对话框](providers-2026-10-16/07-mobile-dialog.png)

浏览器核对九个提供方选项，完成失败重试、成功保存、从模型按钮进入设置，以及 Key 留空切换模型。
自定义表单未填完时改选已有 AI，也能保存，不要求补填不相关参数。
无页面异常、无横向溢出。图片按钮截图使用预置的合成凭据与能力信息，没有向 DeepSeek 发送请求。
详细记录见 [界面结果](providers-2026-10-16/ui-results.json)。

## 四项检查

后端提交前运行 `pnpm build && pnpm typecheck && pnpm lint && pnpm test --maxWorkers=1`，全部通过，158 项测试通过。
第一次默认并发运行出现五项已有测试超时；降低并发后全量通过，未提高超时阈值。
[后端测试日志](providers-2026-10-16/backend-tests.log)。

界面提交前运行 `pnpm build && pnpm typecheck && pnpm lint && pnpm test --maxWorkers=2`，全部通过，158 项测试通过。
[界面批次测试日志](providers-2026-10-16/ui-tests.log)。

## 用户手动验证

1. 自己在隔离 Kaitu.app 中打开「问问 → 连接 AI → 用开图里的 AI」，选择所需服务。
   从对话框的官方链接申请 Key，自行填写；自定义服务同时填写 Base URL 和模型 ID。
2. 点「下一步」，观察验证结果。分别核对正确 Key、错误 Key、无余额/额度、断网或不可用模型的提示。
   成功后可选择「都不要」关闭自动任务，先只验问问。
3. 新建对话问一句话。核对输入框旁的服务与模型；点它进入「AI 与连接 → 管理模型」，
   选择其他模型或服务，验证并保存。回到同一会话发送下一条消息，确认新服务/模型生效。
   同一服务 Key 留空可保留凭据；切换服务先清空输入框，自定义 Base URL 改变后必须提供对应 Key。
4. 选支持图片的模型，上传一张图片并提问；重启 App 后在原会话继续发图。
   再切到文字模型，确认按钮置灰并解释原因。
5. 原对话的模式保持原选择；新建对话仍默认「只读写开图资料」。开启完整 Agent 仍须二次确认。
   可检查本机 AI 配置与 patch 只有服务、模型、端点和凭据引用，不含刚输入的 Key。

## 尚未验证及边界

- 按约定未使用任何真实 Key，因此没有验证各家线上账号权限、余额、地域可达性、实际模型回复或图片理解质量。
  目录与初始化成功表示适配器可加载，不代表线上账号已经连接成功。
- 自定义模型缺少可信图片能力目录，当前禁用图片，用户无需猜测一个能力开关。
- 本轮没有重打桌面包、签名、公证或进行原生窗口验收；新增凭据助手依赖已加入打包复制列表。
  发布工程仍由原有发布流程处理。本分支只作本地交审，不推送、不合并。
