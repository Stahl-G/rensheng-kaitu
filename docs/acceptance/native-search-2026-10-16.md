# 对话服务商自带搜索交审（2026-10-16）

工作树：`rensheng-kaitu-native-search`，分支 `codex/native-search`，起点 `main 5537de4`。
后端提交：`ec87780`。界面、原型与本说明在第二个提交中。仅本地交审。

## 自定义连接

「自定义服务」先选择 Chat Completions、Responses、Anthropic Messages 或 Gemini，
再填写 Base URL、模型 ID 与 Key。最小验证请求使用所选协议，沿用原有 Key、额度、限流、模型和网络错误分类。
自定义路由的 `providerPatch.api`、持久化选择与下一次连接使用同一协议。
已发布的自定义配置缺少 `api` 时继续按 Chat Completions 读取。

Base URL 是协议根地址，不包含操作名。例如 Messages 可填 `https://api.anthropic.com` 或以 `/v1` 结尾的兼容地址，
程序避免重复添加 `/v1`；Responses / Chat Completions 通常填以 `/v1` 结尾的地址，Gemini 通常以 `/v1beta` 结尾。
Key 继续由本机 `LocalCredentialProvider` 保存，配置、provider patch 与接口回执只含选择和凭据引用。

## 官方资料、接口与实施范围

以下为文档核对及本地协议实现范围，不表示已验证线上账号可用性。

- **DeepSeek**：[Anthropic 兼容说明](https://api-docs.deepseek.com/guides/anthropic_api)。
  已实现 `POST https://api.deepseek.com/anthropic/v1/messages`，使用当前模型及 `web_search_20250305`。
  读取 `web_search_tool_result` 和引用的 `cited_text`。官方兼容说明不足以证明每个模型或账号均开放服务端搜索，未拿真实 Key 验证。
- **Anthropic**：[Web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)。
  已实现 `POST https://api.anthropic.com/v1/messages`，使用当前模型及 `web_search_20250305`。
  读取结果块与引用块；HTTP 200 内的工具错误也作为失败返回。
- **OpenAI**：[Web search](https://developers.openai.com/api/docs/guides/tools-web-search)。
  已实现 `POST https://api.openai.com/v1/responses`，使用当前模型及 `tools: [{type: "web_search"}]`。
  请求 `web_search_call.action.sources`，同时读取 `url_citation`；按 URL 去重，不使用回答正文。
- **Gemini**：[Generate Content grounding](https://ai.google.dev/gemini-api/docs/generate-content/google-search?hl=en)、
  [返回结构](https://ai.google.dev/api/generate-content)。
  已实现 `POST https://generativelanguage.googleapis.com/v1beta/models/{当前模型}:generateContent`，启用 `google_search`。
  读取 `candidates[].groundingMetadata.groundingChunks[].web`，使用 `x-goog-api-key`，Key 不放 URL。
- **Kimi**：[独立搜索接口](https://platform.kimi.com/docs/guide/best-practices-for-web-search)、
  [旧工具迁移说明](https://platform.kimi.com/docs/guide/use-web-search)。
  已实现 `POST https://api.moonshot.cn/v1/tools/search`，发送 `text_query` 和 `include_content: false`，读取 `search_results`。
  使用同账号 Basic 搜索，复用 Kimi 对话 Key。没有接即将下线且不能据其示例确认来源结构的旧 `$web_search` 工具。
- **智谱**：[搜索服务](https://docs.bigmodel.cn/cn/guide/tools/web-search)、
  [Web Search API](https://docs.bigmodel.cn/api-reference/工具-api/网络搜索)。
  已实现 `POST https://open.bigmodel.cn/api/paas/v4/web_search`，发送 `search_engine: "search_std"`、`search_query`。
  读取 `search_result` 的 `link/title/content/publish_date`。使用同账号自研搜索。
  官方 Chat 示例的回答不含可核对的来源数组，因此使用明确返回结构化来源的搜索接口。
- **通义千问**：[联网搜索](https://help.aliyun.com/zh/model-studio/web-search)。
  已实现 `POST https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation`，使用当前模型。
  发送 `parameters.enable_search`、`forced_search`、`enable_source`，读取 `output.search_info.search_results`。
  支持 `qwen-plus`。来源参数仅适用于 DashScope，故不用兼容 Chat 接口。
  现有 `qwen-vl-plus` 需要多模态流式搜索，本轮未接入，设置给出原因并允许使用另配搜索服务。
- **OpenRouter**：[新搜索工具](https://openrouter.ai/docs/guides/features/server-tools/web-search)、
  [旧插件说明](https://openrouter.ai/docs/guides/features/plugins/web-search)。
  文档接口为 `/api/v1/chat/completions` 或 `/responses`，工具为 `openrouter:web_search`，来源为 `url_citation` annotations。
  **未启用**。新工具文档明确 `native` 在不支持的模型上仍可回落 Exa，旧插件文档对 `native` 的描述不同。
  无法核实对现有全部目录模型都仅使用原生搜索的契约，因此不静默启用；设置显示原因，用户可另配 Perplexity / Exa。
- **自定义服务**：依据所选协议的上述官方资料及用户自己的服务文档实现尝试，使用用户填写的 Base URL、模型及协议。
  Messages / Responses / Gemini 同上述工具；Chat Completions 尝试 `web_search_options` 并只读 `annotations[].url_citation`。
  协议兼容不代表服务实现了搜索。不支持、工具失败或没有结构化来源时返回可读错误，不从正文提取 URL。

Messages 的请求、结果块与引用片段连接方式参照只读 DSH `web-search-deepseek/src/provider.ts`。
本地适配器统一七种接口的结构化结果、错误分类和去重，不继续沿用上游写死 DeepSeek 名称与独立搜索端点配置的错误引导。
DSH 源码未改动。

## 选择顺序与数据流

1. 每次搜索读取当前对话连接，按其凭据引用从 `LocalCredentialProvider` 获取 Key。
   使用当前模型支持的服务端搜索，或 Kimi / 智谱的同账号搜索接口；应用不把搜索词发送给另一家搜索服务。
2. 当前连接未配置或属于上述未接入范围时，按用户在网络搜索中保存的选择使用 Perplexity / Exa。
   所选服务没有 Key 时，使用另一个已配置的专门服务。专门服务仍为可选，添加它不会连接对话模型。
3. 两种路径都没有凭据时，提示「问问 → 连接 AI」和「AI 与连接 → 网络搜索」入口。

自带搜索已发出请求后，认证、网络、工具不支持或无结构化来源等失败直接报错，本次查询不会因失败而自动外发到另一家。
「改用专门的搜索服务」内说明了它的备用条件与接收方；配置专门服务不会覆盖可用的自带搜索优先级。
DeepSeek Key 不再被当作独立优先搜索 Key，只有当前对话使用 DeepSeek 时才读取它。

默认模式仍可搜索、打开公网网页，不能运行命令；`web_fetch` 继续使用 `public-fetch.ts` 公网校验。
没有改 PRD §6、schemas 或日历分支约定的文件。

## 本地验证

- 后端提交前 `pnpm build && pnpm typecheck && pnpm lint && pnpm test` 全部通过，70 个测试文件、173 项测试通过。
  后端末次修改另回归 `packages/desktop/test/web.test.ts`，三项通过，其中公网读取测试原样保留。
- 搜索只改动两个行为测试：一个覆盖各协议的实际本地请求、结构化来源去重、正文 URL 不入结果、工具错误及自定义验证路由；
  一个覆盖当前对话服务优先、专门服务备用、无凭据提示、残留 DeepSeek Key 不抢占和错误脱敏。
  测试仅用假 Key、本机 HTTP 假服务器与合成响应，没有调用线上模型或搜索 API。
- 额外运行实际 rc.2 Electron Node 与 `LocalCredentialProvider`，加载本次 `sdk-web.mjs` 注册提供方。
  在两次调用之间把临时连接从 Messages 切为 Responses，本机假服务器分别收到 `/v1/messages`、`/responses` 和各自模型。
  移除凭据后返回配置提示，没有第三次 HTTP 请求。凭据只写临时目录。
- 浏览器使用实际 `kaitu ui --dir <临时合成工作区> --port 4975 --no-open`。
  问问和设置请求转发同机真实 SDK 适配器，其余页面由 CLI 服务提供。浏览器阻止非本机请求。
  截图与界面回执见下方；未使用 Computer Use。

- 界面逐个保存四种自定义协议，第二次起留空 Key 复用已存凭据。
  同时配置 Exa / Perplexity 后仍显示自带搜索优先；切到外部 AI 后使用专门服务，逐个移除后显示连接入口。
  接口响应与两份配置均不含合成 Key，390px 暗色无横向溢出，页面异常为零。
- 界面批次的 `pnpm build && pnpm typecheck && pnpm lint && pnpm test` 全部通过，70 个测试文件、173 项测试通过。
  最后补跑构建、类型检查与 lint，确保展开项的布局与最终原型也纳入构建和检查。

截图已目检：

- [连接前的搜索入口](native-search-2026-10-16/01-search-before-connection.png)
- [自定义 Responses 协议与连接参数](native-search-2026-10-16/02-custom-responses.png)
- [默认使用当前服务自带搜索](native-search-2026-10-16/03-native-search.png)
- [390px 暗色专门搜索展开项](native-search-2026-10-16/04-mobile-search-options.png)
- [390px 暗色自定义 Gemini 连接，可向下滚动操作](native-search-2026-10-16/05-mobile-custom-gemini.png)

## 用户自行填写真实 Key 的手动验证

1. 在隔离工作区打开「问问 → 连接 AI → 用开图里的 AI」，自行选择服务、填写自己的真实 Key。
   自定义服务先选协议，按照服务文档填 Base URL 和模型 ID；点击下一步，核对成功或具体的连接失败原因。
2. 不添加专门搜索 Key，在默认模式查询一条公开、非个人的问题，要求列出来源。
   按上述各服务逐家核对实际来源卡片和链接。支持搜索的模型应复用对话 Key；没有结构化来源时应明确报错。
   DeepSeek 的线上服务端工具能力需在此步确认，不能把本地假服务器通过当成线上支持证明。
3. 在同一对话更换服务或模型，下一条查询应使用新连接。保留旧 DeepSeek Key 时，它也不应抢占其他服务的搜索。
   到「AI 与连接 → 网络搜索」查看当前服务名，展开「改用专门的搜索服务」后再自行填写 Perplexity / Exa Key。
4. 使用未接入自带搜索的 OpenRouter 或 `qwen-vl-plus`，确认有原因说明，已配置的专门服务可作为备用。
   先后移除专门服务 Key，确认按可用凭据切换，全部没有时提示配置入口。搜索 Key 的保存和移除不应改变对话模型。
5. 对自定义服务分别验证支持与不支持服务端搜索的端点。不支持时应得到可读失败，而不是从回答正文伪造来源。
   认证、余额、限流、网络及模型错误继续分别显示对应操作提示，回执和配置不应含输入的 Key。
6. 在默认模式打开公开网页、尝试打开本机/内网 URL、尝试运行命令。公开网页可读取，本机/内网应拒绝，命令工具不应开放。
   开启完整 Agent 仍须原来的二次确认。应用重启后，协议、模型及专门搜索选择应保留。

本轮没有使用真实 Key，线上账号权限、模型搜索可用性、余额、可达性与检索质量尚未验证。
未重打、签名或发布 Kaitu.app；未推送、未合并。测试日志不纳入提交。
