# 开图 iPhone：问问（v0.6.1）

更新：2026-10-18。产品要求见 [product.md](product.md) §4.5，界面见 [design/iphone/Ask.dc.html](../design/iphone/Ask.dc.html)。
任务说明在 [tasks/](tasks/)（ASK-1 到 ASK-4）。

## 1. 要做成什么样

- 用户填自己的 AI 服务 Key（DeepSeek 默认），在手机上问开图里的事：「这周训练够了吗」「摄影集下一步是什么」。
- 回答下面列出读了哪些资料。需要改动时给出建议卡片，用户点「放进待确认」才交进收件箱，由电脑或云端整理员处理。
- 不替用户确认任何事；读不到 Key；标为敏感的记忆不发给 AI；财务按问问设置里的开关（默认开）。

## 2. 结构

```
问问页 ─▶ AgentLoop（KaituKitData，自己写，约一百行）
            ├─ 接口层：开源库，OpenAI 兼容接口（DeepSeek / Kimi / 智谱 / OpenAI），Key 在钥匙串
            ├─ 提示词：固定的几句开场 + 工作区 AGENTS.md + 今天和这一周的快照摘要
            ├─ 读工具：与电脑 `kaitu mcp` 的 remote 工具同名同义（§4）
            └─ 写工具：只生成建议卡片；用户点了才写收件箱文件（origin: assistant）
```

- **规则只有一份。** 开图能做什么、不能做什么写在工作区的 `AGENTS.md`（电脑生成），手机 Agent 跟云端 Agent 一样读它；harness 里不写开图知识。
- **工具跟电脑对齐。** 名字、参数和返回格式与 `packages/cli/src/mcp/server.ts` 的 remote 工具一致。以后改走电脑或付费版，只换后端。

## 3. 选型：接口用开源库，循环自己写

循环本身很简单：发消息 → 模型要调工具就执行 → 把结果放回去 → 再问一次，加上轮数上限、超时、取消。难的是工具定义、能写什么、界面怎么显示，这些框架替不了。所以只把「连服务、流式、工具调用的格式」交给库。

**候选（ASK-1 里实测后二选一）**

| 库 | 是什么 | 看点 |
|---|---|---|
| MacPaw/OpenAI | Swift 的 OpenAI 接口库，用户最多 | 流式、工具调用、可改服务地址；不带 Agent 循环 |
| [llmkit-swift](https://github.com/aktagon/llmkit-swift) | 多服务商接口库，含 DeepSeek，零第三方依赖，iOS 15+ | 自带工具循环（`.maxToolIterations`），我们只用它的接口层也行 |

**看过但不选**

| 库 | 原因 |
|---|---|
| [SwiftAgent（tomieq）](https://github.com/tomieq/SwiftAgent) | 作者说明是学习用的项目 |
| [Open Agent SDK（Swift）](https://dev.to/terryso/open-agent-sdk-swift-build-ai-agent-applications-with-native-swift-concurrency-kne) | 只写了 macOS 13+，没写 iOS |
| SwiftAgentCore、AgentRunKit、[SwiftAI](https://github.com/mi12labs/SwiftAI) | 用的人太少，停更风险大 |
| 苹果 FoundationModels | 只能驱动苹果设备上的本地模型，接不了 DeepSeek |

**选定标准**（ASK-1 按此打分）：
1. 许可证是 MIT 或 Apache-2.0（HANDOFF D15：AGPL 不进代码）。
2. 用 DeepSeek 真实 Key 跑通：流式回答、一次工具调用、取消。
3. 依赖少，不拉进整套网络库。
4. 最近一年有发版。
5. 出错时能拿到服务商原始的错误信息（Key 错、额度用完、限流），界面要照实显示。

以上候选的成熟度、许可证和维护情况都是一次搜索的结果，ASK-1 动手前逐一核对。

## 4. 工具

### 读（无需确认）

手机算不了电脑的实时结果，读的是快照和资料文件；名字保持与电脑一致，返回的是同样含义的数据。

| 工具 | 参数 | 手机上从哪读 | 电脑同名工具 |
|---|---|---|---|
| `status` | 无 | `phone/today.json` + `phone/week.json` | `status` |
| `project_list` | 无 | `phone/week.json` 的 projects | `project_list` |
| `exploration_read` | 无 | `phone/map.json` 的 rows | `exploration_read` |
| `life_map` | 无 | `phone/map.json` 的 places、routes、hometown | `life_map` |
| `record_list` | `type`、`from?`、`to?`（日期） | 对应模块 `module.json` 里该类型的路径（如 `health/data/workouts/2026-10.jsonl`），按 id 取 rev 最大的一行 | `record_list` |
| `read_file` | `path` | 工作区内文件 | `read_file` |

`read_file` 与 `record_list` 的边界和电脑 remote 一致（`packages/core/src/agent-tools.ts`）：
- 只读工作区内的 `.md`、`.json`（`record_list` 读对应的 `.jsonl`）；不读 `.kaitu/`、`.git/`，路径不能跳出工作区。
- 财务：问问设置里「让问问读财务」打开时可读（默认开，这是用户自己的 AI）；关掉后整块不读。
- `memory/`：只读单条记忆文件，且 frontmatter 里 `sensitive` 明确为 false；`MEMORY.md` 索引不读。
- 单次返回不超过 20 KB，超出截断并写明「已截断」。

### 写（只生成卡片，用户点了才写）

| 工具 | 参数 | 用户点「放进待确认」后写入 | 电脑同名工具 |
|---|---|---|---|
| `record_add` | `type`、`data` | `inbox/agents/ios-<设备号>-<ULID>.records.jsonl`，一行，带 `origin: "assistant"` | `record_add` |
| `task_add` | `title`、`due?`、`notes?` | 同上，一行 `type: "task"`、`title`、`status: "open"`（task 的必填字段），可带 `due`、`notes` | `task_add` |
| `propose_block` | `title`、`start`、`end` | **暂不提供。** 手机能交的文件只有 `.note.md`、`.records.jsonl`、`.actions.jsonl`（`packages/core/src/phone-actions.ts` 的 `phoneInboxName`），`.proposal.json` 不会按手机文件处理，也没有回执。要做就得扩展手机文件类型，属于数据规范改动，先问用户 | `propose_block` |
| `note` | `text` | `.note.md`，与「记一下」相同格式，`origin: assistant` | （收件箱原文） |

- 工具执行后返回给模型的是「已生成卡片，等用户决定」，不是「已保存」。
- 一轮最多 3 张卡片。用户点「不用」只关掉卡片，不写任何文件。
- 不提供：删除、改规则或目标、确认阶段、启用方向、写日历、改资料文件。

## 5. 循环

- 每次提问最多 6 轮工具调用；单次请求超时 30 秒；用户随时可以停。
- 每一步在回答上方显示一行「正在读：训练记录 · 本周」，用工具名和参数生成中文描述，不显示原始 JSON。
- 读过的资料去重后列在回答下面（`Ask.dc.html` 的来源标签），点开能看原文。
- 出错照实说：「Key 不对」「额度用完」「网络断了，已停在第 2 步」。不自动重试超过 1 次。
- App 切到后台时请求可能被系统中断；回来后显示「回答被中断」，提供「继续」按钮重新提问，不假装接上。

## 6. 提示词

1. 固定开场（几句）：你在用户的 iPhone 上，用工具读资料再回答；改动只能生成卡片；回答简短，用户的原文不翻译。
2. 工作区的 `AGENTS.md` 全文（手机启动时读一次并缓存，文件变化后重读）。
3. 今天和这一周的快照摘要（不超过 2 KB）。
4. 对话历史：最近 20 条。

## 7. 对话和隐私

- 对话只存在手机本地（App 容器），不同步，不写进资料位置。
- 发给 AI 服务的只有提示词、当轮读到的资料片段和对话；设置页写明发给了哪家服务。
- Key 只存在钥匙串，不同步，不写进任何文件或日志。
- 问问写进收件箱的东西署名为 assistant，权限按 Agent 校验，和其他 Agent 一样。

## 8. 待核实

- DeepSeek 当前的模型名，哪个支持工具调用和流式（ASK-1 用真实 Key 确认）。
- 各服务商的工具调用格式与 OpenAI 是否完全一致（Kimi、智谱逐一试）。
- 候选库的许可证、最近发版、iOS 支持。

## 9. 验收

- 用合成工作区和你自己的 DeepSeek Key：问「这周训练够了吗」，回答引用训练和睡眠两条来源；问「帮我记一顿午饭：鸡胸肉沙拉」，出现卡片，点了之后收件箱多一个 `.records.jsonl`，电脑处理后变成记录。
- 读标为敏感的记忆、或关掉开关后读财务的请求被拒，回答里说明读不到和怎么打开。
- 中途点停止，0.3 秒内停下；断网时显示原因。
- 单元测试用假的模型回复覆盖：调工具、到 6 轮停下、取消、工具报错、卡片只在用户点了之后写文件。
