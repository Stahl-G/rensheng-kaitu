# 首次使用引导：阶段 1 交审

日期：2026-10-16。分支 `codex/onboarding`，基于 `main` 的 `19d5c12`。
本轮只交 core、接口、技能与文档，页面在 ui-v2 合并后接入。

## 已完成

- 从 rensheng-kaitu-ui 复制最新版设计原型，保留「第一次打开」完整演示。
- ONBOARDING 常量集中提供四步、AI 列表与提示、附录 A 提示词、起步选择、数据源映射和 AI 方式。
- 逐行解析粘贴，支持列表、半角括号和纯文本。未知类别、格式不符的行留作 context，已有与批内重复去重。
- 服务端保存预览，确认只接受预览 ID，选中项整批调用 importMemories，来源为所选 AI，返回导入前版本与新版本。
- 本机保存看过引导、所选事情、跳过项和 AI 选择。工作区与 config.json 不存这些状态。
- 开始清单每次读取现有资料计算，包含所选事情的数据源，跳过与完成分开。换机打开已有资料不自动弹出。
- 起步选择写对应模块 STATUS.md，固定 `onboarding-<id>` 去重，整次至多一个版本。
- 文件导入复用已有导入器；项目文件夹与关注关键词增加预览确认适配，财务继续使用现有财务导入。
- CLI、MCP、DSH 工具和两种 Host 接口可调用相同 core 能力。技能及生成的 AGENTS.md 使用共用内容。

没有改 PRD §6、schemas、页面组件、真实个人工作区或 ~/.kaitu-app。

## 阶段 2 接口清单

独立 Kaitu.app 与 `kaitu ui` 使用 `POST /api/product/<方法名>`，请求体是参数数组。
写入仍经过现有队列和外部改动保存，沿用本机 Host、Origin 和 `X-Kaitu: 1` 校验。
DSH 使用 `kaitu` Remote 服务的同名方法，经过插件的同一写队列。

| 方法 | 参数数组 / DSH 方法参数 | 返回与用途 |
|---|---|---|
| onboarding | `[]` | 共用内容、选择、showGuide、sources、checklist |
| onboardingChoose | `[choices]` | `{version,status}`，保存部分选择并去重写下一步 |
| onboardingMemoryPreview | `[text,ai]` | `{token,candidates}`，不写记忆 |
| onboardingMemoryConfirm | `[token,selected]` | `{entries,version,before,skipped}`，selected 为候选 ID 数组 |
| onboardingImportPreview | `[source,name,base64]` | `{token,preview}`，ICS、Apple 健康、ChatGPT 导出包 |
| onboardingImportConfirm | `[token]` | `{result,before}`，result 中含版本与导入统计 |
| onboardingSetupPreview | `[input]` | `{token,input}`，本机项目或关注方向的确认范围 |
| onboardingSetupConfirm | `[token]` | `{version,before,slug?}`，写项目或追加关注关键词 |
| onboardingCancel | `[token]` | 放弃任一类型预览并清理暂存 |

另有只读 `GET /api/onboarding`，返回与 onboarding 相同。
预览令牌 30 分钟失效，成功确认后消费。重复确认返回冲突，前端重新查询即可。
文件确认前再次预览，若统计变化，返回冲突并要求重看；记忆确认只会剔除期间已经存在的相同正文。

`choices` 的字段全部可选：

```json
{
  "seen": true,
  "starts": ["me", "projects", "health", "finance", "calendar", "explore", "news"],
  "skipped": ["memory", "calendar", "ai"],
  "memoryAi": "chatgpt",
  "aiChoice": "builtin"
}
```

starts、skipped 在传入时替换本机列表，未传入的字段保留原值。
starts 撤选不会删除已写下一步，skipped 不会让 done 变为 true。
AI ID 与选项以 content 为准。aiChoice 取 builtin / mine / none。

项目设置示例，links 的 role 取 manuscript / repo / folder，include 与 local_only 复用现有项目字段：

```json
{
  "source": "projects",
  "project": {
    "title": "我的项目",
    "kind": "work",
    "local_only": false,
    "links": [{ "path": "/用户选择的本机绝对路径", "role": "folder" }]
  }
}
```

关注方向：`{"source":"news","keywords":["独立开发","东南亚生活"]}`。
确认时追加关键词，保留原订阅源和其他配置。已有相同项目或关键词不会再建版本。
Drive 下仅本机项目复用独立项目历史，此时 before 为 null，不用工作区版本冒充项目恢复点。

候选包含 `id/type/name/text/category/content/when/raw/original`。
界面按 category 分组，以 content 和 when 展示，raw 表示原样保留，由 selected 控制写入范围。
记忆时间仍留在 text，不写入新的时间字段。

`checklist` 返回 `items/completed/total/progress/visible`，progress 为 0–1。
每项包含 `id/title/done/skipped/action`，action 为 `{kind,target,label}`。
前端可用 completed/total 与 progress 画清单和进度条，按 action.target 路由：

- memory：搬记忆面板。
- import:ics / import:apple-health / import:chatgpt-conversations：文件预览。
- finance：已有财务导入预览。
- setup:projects / setup:news：项目或关注方向设置预览。
- ask / connections：问问配置或 AI 与连接。
- plan：计划入口，无 AI 时先进入 AI 选择。

状态不塞入 overview，以独立查询避免与 ui-v2 总览重构冲突。
写后重读 onboarding，文件变化沿用现有刷新通知。CLI 或 MCP 更新本机选择后，页面重新查询会读到新值。

## 已有入口的复用与边界

| 能力 | 当前入口 | 边界 |
|---|---|---|
| 财务 | 本地 financeImportPreview / Commit / Discard，DSH kaituFinance 服务 | 支持范围由既有适配器决定 |
| 较大的文件上传 | 本地 `/api/import/preview?source=...&name=...` → `/api/import/confirm` | 原有上传上限 512 MiB，令牌不能与新接口混用 |
| 新文件预览 | onboardingImportPreview | base64 上限 48 MiB，约 36 MiB 原文件 |
| DSH 本机原文件 | 既有 kaitu_import 的 dryRun → 用户确认 | 可使用用户指定文件路径，不必传大 base64 |
| GitHub | 既有 project github / kaitu_projects 的 github | 包括现有联网核验与同步，不在引导另造连接器 |
| 历史撤销 | 本地 `/api/restore`、CLI restore、DSH 既有恢复 | 使用返回的 before，默认恢复整工作区 |

CLI 新入口：

```text
kaitu onboarding status|reset
kaitu onboarding choose --json '<选择对象>'
kaitu onboarding preview --file <本机临时文本> --source <AI ID>
kaitu onboarding confirm <token> --json '{"selected":["line-1"]}'
kaitu onboarding setup-preview --json '<项目或关注方向对象>'
kaitu onboarding setup-confirm <token>
kaitu onboarding cancel <token>
```

输出均为 JSON。MCP 增加只读 `onboarding_status`，已初始化的 MCP 连接自动留本机回执。
DSH 工具 `kaitu_onboarding` 使用 status / choose / preview / confirm / setup-preview / setup-confirm / cancel action。
问问配置回读和 DSH 工具实际调用也记录连接事实，不因选择 AI 方式直接完成清单。

## 状态位置与重置

默认使用 `localStateRoot()/onboarding/<工作区路径标识>/`，路径标识只用于区分工作区。
choices.json 存用户选择，ai.json 存连接事实，preview-<token>.json 存待确认预览，文件权限为 600。
目录在工作区之外，不进入版本或 Drive。`KAITU_LOCAL_STATE_DIR` 或 core 的 stateRoot 可指定隔离位置。

reset 只清除 choices.json。记忆、项目、下一步、订阅和 AI 连接证据均保留。
已有资料时 showGuide 仍为 false，阶段 2 的重看按钮应直接打开四步，不以 showGuide 为强制条件。

## 本轮未做与原因

- 四步页面、候选勾选、顶部清单和重看入口：按分工留给 ui-v2 合并后的阶段 2。
- 原型中的 ICS 订阅地址轮询、邮箱和 Slack/飞书账号连接：现有 core 没有对应连接器。
  当前分别提供 ICS 文件与 ChatGPT 对话导出包，不能把账号或订阅地址保存等同于导入成功。
- 原生桌面中的完整首次使用流程与真人十分钟验收：页面尚未接入，留到阶段 2。

## 验证

两次提交前均运行 build、typecheck、lint 与全量 test，最终 47 个文件、134 项测试通过。
测试使用单 worker，应对同机并行任务造成的资源争用，保持原有超时和断言。
早期并发检查曾出现旧用例超时，完整复跑后通过。
旧 MCP stdio 测试已显式传入临时状态目录，早期两份合成连接回执已清理，复核没有残留。

构建后的 CLI 预览、选择确认与 reset，SDK stdio 的 onboarding_status，以及 DSH 服务对象的预览确认均通过实际调用冒烟。
DSH Remote 的自动客户端声明已成功生成。此处服务调用不代表原生窗口交互验收。

新增恰好三个行为测试：粘贴解析、通过本地接口确认整批写入并恢复、清单随实际资料和恢复变化。
后者还验证选择不改 config、下一步去重、项目与关键词预览确认、跳过不算完成、已有资料换机不自动弹出。
测试使用合成数据与临时目录，本机状态也指向临时目录，不访问外部服务。

## 手动验证

构建后在仓库根目录运行，始终明确指定隔离目录：

```sh
export KAITU_LOCAL_STATE_DIR="$(mktemp -d /tmp/kaitu-onboarding-state.XXXXXX)"
onboarding_case="$(mktemp -d /tmp/kaitu-onboarding.XXXXXX)"
node packages/cli/dist/main.js init "$onboarding_case/ws"
node packages/cli/dist/main.js onboarding status --dir "$onboarding_case/ws"
```

1. 初始应 showGuide=true、无已完成项。预览一份含类别、列表、未知行与重复行的合成文本，记下 token 与候选 ID。
2. 用 confirm 只传部分 ID，核对 memory list、history 和返回的 before/version。重复确认同一 token 应失败，重贴相同正文应被去重。
3. restore 到 before，确认整批记忆消失。choose 选择 health、calendar、projects、news，核对 sources 只包含对应四项。
4. 重复 choose，核对 STATUS.md 中固定 ID 不增加、历史不新增，config.json 不变。
5. 对临时项目文件夹和关注关键词做 setup-preview → setup-confirm。核对清单中项目与关注方向从未完成变为完成。
6. 预览并导入合成 ICS 或 Apple 健康文件，核对写入前后清单，恢复后再次核对。取消预览不应写工作区资料。
7. 用隔离目录启动 `kaitu ui --no-open`，调用上述接口。
   无 X-Kaitu、错误 Origin 或错误 Host 的写请求应被拒绝，正常请求返回令牌后才能确认。
8. MCP 客户端调用 onboarding_status，或 DSH 使用 kaitu_onboarding status，核对共用内容与真实连接状态。
9. reset 后重新查询，选择为空、资料不删除。换一个本机状态目录打开已有资料，showGuide 仍为 false。

阶段 2 再按原型走完整页面，核对默认全选、取消勾选、返回上一步、逐项与全部跳过、加载失败重试、撤销回读与每条去做按钮。
