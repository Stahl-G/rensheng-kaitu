# 开图 iPhone：架构（v0.6，含 v0.7）

更新：2026-10-18。产品要求见 [product.md](product.md)。本文件定义手机与电脑之间读写哪些文件、各自要改什么、怎么分工和验收。

## 1. 现状

**iOS（独立仓库 `kaitu-ios`）**
- 纯 SwiftUI 加本地 Swift Package `KaituKit`（零第三方依赖），iOS 18+，仅 iPhone，v0.5.0。
- 现在的功能是健康采集：HealthKit → `kaitu.health.v1` JSON，交到三个地方之一：iCloud 容器、用户选的 iCloud Drive 文件夹、Apps Script 地址。
- 已有后台刷新任务（`dev.kaitu.app.refresh`）。用 xcodegen + xcodebuild + altool 发 TestFlight，本机能构建。
- 与开图仓库不共享代码，只靠文件格式连接：格式见 `docs/guides/health-shortcut-format.md`，由 `importers/apple-health.ts` 接收。

**电脑（本仓库）**
- `packages/core` 计算今天页（`readOverviewPage`、`readPlans`）和足迹（`lifeMap`）。进度图的行（`progressRows`）和路线（`journeyRoutes`）目前在 `dsh-plugin` 的前端代码里。
- 收件箱：`processInbox` 处理 `inbox/agents/` 与 `inbox/health/`。插件后台每分钟跑一次（`inbox-loop.ts`）；处理完的文件移到 `inbox/processed/`。
- 确认类操作已有函数：`decideProposal`、`completeNext`、`scheduleNext`（workbench.ts），`completeTask`、`cancelTask`（tasks.ts），`adoptOnboardingMatter`、`keepOnboardingMatter`（onboarding.ts），`writeExploration`。
- 存放位置：本机、iCloud、同步文件夹（Google Drive、坚果云等）。
- GitHub 备份（`workspace-backup.ts`）：
  - 用 Git Data API，每分钟同步一次，按记录 ID 和修订号三方合并。
  - **不同步整个 `inbox/`、隐藏目录和媒体文件，并且按文本读写。**

v0.6 继续沿用「两个仓库只靠文件格式连接」：手机不引用 `packages/` 里的代码。

## 2. 总体设计

```
电脑 core ──生成──▶ phone/*.json（快照）──iCloud / GitHub──▶ 手机读取、显示
手机 ──新建──▶ inbox/agents/ios-*（原文、记录、操作）──iCloud / GitHub──▶ 电脑 processInbox
电脑 processInbox ──应用──▶ data/、STATUS.md、NOW.md ──▶ 重新生成快照 + phone/receipts.json
```

1. v0.6 只有电脑写资料（`data/`、`STATUS.md`、`NOW.md`、`me/`），与云端接力协议一致；手机只交新文件。v0.7 起电脑不在时，用户指定的整理员（云端 Agent）按 [ORGANIZER.md](ORGANIZER.md) 的白天一节改其中有限的几处（[agent-runner.md](agent-runner.md)）。
2. 手机界面只依赖两样东西：快照的格式、写入的格式。谁生成快照、谁处理收件箱以后可以换（§8），界面不用改。
3. 存储层可以换：iCloud 文件夹、GitHub，以后加 WebDAV（坚果云），读写的都是同一组路径。

## 3. 手机读取：快照（`phone/`）

| 文件 | 内容 | 电脑端来源 |
|---|---|---|
| `phone/today.json` | 今天前三项（第一项即最重要的一件事）、待确认日程、今天已确认的日程、进行中的目标、同步状态；关键问题位（v0.6 恒为 `null`） | `readOverviewPage`、`readPlans` |
| `phone/week.json` | 最近 7 天：进行中项目的字数、提交（按天）和下一步；训练、睡眠、蛋白质、体重摘要；本周记下的原文条数；最近三项变化 | `readOverviewPage` |
| `phone/map.json` | 进度图的行；城市级地点和图层；家乡；已走路线和计划路线的坐标（手机直接画，不在手机上重算路线规则） | `progressRows`、`lifeMap`、`journeyRoutes` |
| `phone/receipts.json` | 手机交来的文件和操作的处理结果，保留最近 14 天 | 收件箱处理 |

**规则：**
- **版本：** 每个文件带 `format` 和 `version`（主版本）。字段只增不改；手机忽略不认识的字段；`version` 高于 App 支持时提示更新。
- **何时生成：**
  - 资料变化后在后台防抖重算，复用现状刷新的时机，不进写入路径。
  - 只在手机能读到时才写：存放位置是 iCloud 或同步文件夹，或者已连接 GitHub 备份。
  - 内容不变就不写文件，`generated_at` 只在内容变化时更新，免得 GitHub 每分钟多一条提交。
- **不含：** 财务明细、标为敏感的记忆、Key、本机绝对路径。`file` 字段只写资料文件夹内的相对路径。
- **`phone/` 是生成目录：** 不当模块（加入 `NOT_MODULES`），不进本机版本历史，Agent 只读，与 `OVERVIEW.md` 同等对待。
- **schema 和样例：** schema 在 `schemas/phone-*.schema.json`，样例在 `schemas/fixtures/phone/`。
  - 电脑端测试保证生成结果符合 schema、样例符合 schema。
  - iOS 端用同一批样例做解码测试。
  - 任何一边改格式，都要先改 schema 和样例。

## 4. 手机写入：收件箱（`inbox/agents/`）

**文件名：** `ios-<设备号8位>-<ULID>.<后缀>`。设备号在首次启动时随机生成，存在钥匙串里。

| 后缀 | 内容 | 电脑端处理 |
|---|---|---|
| `.note.md` | 原文。frontmatter 写 `agent: 你（iPhone）`、`kind: capture`、`origin: user`、`date`、`created`；正文是原文 | 收作原文，等同于在电脑上「保存原文」；每日整理负责起草。需确认导入时保留 `kind: capture`。 |
| `.records.jsonl` | 记录，沿用现有格式。每行写 `agent: "iPhone"` 和 `origin: "user"` 或 `"assistant"` | `origin: user` 署名为用户（`by: user`），`assistant`（手机问问写的）记为 Agent；权限按 Agent 校验 |
| `.actions.jsonl` | 操作，新格式，每行一条（见下） | 按顺序执行并去重，写回执 |
| `.jpg` / `.heic` | 照片：长边不超过 2048、单张不超过 1 MB，和引用它的记录一起交 | 移到 `health/files/meals/<日期>/`，在记录里写相对路径。v0.6 只在 iCloud 方式下可用 |

健康数据沿用 `inbox/health/*.health.json`（`kaitu.health.v1`）。

**操作文件（`.actions.jsonl`）**

每行：`{"client_id": ULID, "at": 时间, "device": 设备号, "op": 操作, "args": 参数}`。

| op | args | 电脑执行 | 版本 |
|---|---|---|---|
| `complete_next` | `file`、`id` | `completeNext` | v0.6 |
| `decide_proposal` | `id`、`decision`（confirmed / rejected） | `decidePhoneProposal`：只改状态；确认的标 `calendar: phone`，日历由手机写入；Mac 在日历里找到那条后才跟着更新、允许改时间，从不新建 | v0.6 |
| `complete_task` / `cancel_task` | `id` | `completeTask` / `cancelTask` | v0.6 |
| `keep_draft` / `adopt_draft` | `source`（加核对后的草稿） | `keepOnboardingMatter` / `adoptOnboardingMatter` | v0.6.1 |
| `answer_question` | `question_id`、`value` | 待定 | 预留 |
| `trial_checkin` | `experiment_id`、`expected_revision`、`done`、`note` | `writeExploration` | 预留，依赖数据规范 |

- **执行前先核对前提**：这一项还在、仍是待办或待确认。不满足就记为 `conflict`，不硬改；手机按回执撤回并说明原因，电脑今天页不另行提示。
- **去重：** 用 `client_id`，同一条操作交两次只执行一次。

**回执和叠加显示**
- 电脑处理后写入 `phone/receipts.json`，每条是 `{client_id 或文件名, status, message, at}`，`status` 取 applied / duplicate / conflict / rejected。文件被移出 `inbox/agents/` 也表示已经处理。
- 还没收到回执的操作，手机先在界面上显示成生效（划掉、标为已确认），并标「等电脑处理」。收到 conflict 或 rejected 时撤回，并说明原因。

**可信边界：** 能写资料位置的 Agent 都能写收件箱，也能造出同名的手机文件，收件箱格式里没有签名或配对校验。手机文件只有 Agent 的权限，`origin` 只决定署名。只能由用户本人做的决定（确认阶段、启用方向）手机不生效，在电脑上确认。日程建议可以在手机上确认：写日历只在手机上由用户点按后发生，电脑只记状态，所以伪造的文件写不进日历。手机可信确认通道未交付，见[手机契约](../guides/phone-contract.md)。

## 5. 存储层（iOS）

协议 `WorkspaceStore`：`list(prefix)`、`read(path) → (data, version)`、`create(path, data)`（文件已存在就失败），以及同步状态。

- **iCloud 文件夹：**
  - 用安全作用域书签指向电脑在用的 kaitu 文件夹，读写时用 `NSFileCoordinator`。
  - 占位文件先下载，未下载不当成不存在。用 `NSMetadataQuery` 监听 `phone/` 的变化。
- **GitHub：**
  - 填 `owner/repo`，token 存钥匙串。根目录有 `kaitu-backup.json`（`format: kaitu-workspace`）就认作开图仓库。公开仓库提示风险，默认不写。
  - 读：先取分支引用，再递归读文件树，只拉 `phone/*.json`，按 sha 和 ETag 缓存。
  - 写：用 Contents API 新建文件（新路径不带 sha，不会和别的提交冲突）；多文件可以用 `createCommitOnBranch` 一次提交，带 `expectedHeadOid`，撞车就换新版本重试。
  - 国内网络不稳定，所以必须靠缓存和离线队列。
- **其他同步盘（Google Drive、坚果云）：** 通过「文件」选文件夹，复用 iCloud 的实现，尽力支持。
- **离线：**
  - 快照缓存在 App 容器里。
  - 写入先进持久化的离线队列：前台联网立即交出，后台由已有的刷新任务补交。

## 6. 电脑端改动（本仓库，云端子 agent 实现，我审 PR）

- **D1 快照生成：**
  - 把 `progressRows`、`journeyRoutes` 移进 core，与插件共用。
  - 写 `buildPhoneToday/Week/Map`：从已读出的数据投影成快照，用纯函数。再写 `writePhoneSnapshots`：放后台、防抖、内容不变不写。
  - 处理好 `phone/` 的生成目录身份。
  - 补测试，写 `docs/guides/phone-contract.md`。
- **D2 GitHub 备份带上手机路径：**
  - 连接后始终同步 `phone/`（只上传），以及 `inbox/agents/`、`inbox/health/`（双向：拉下手机的新文件，电脑处理后删掉远端那份）。这几处不受「文字 / 结构化资料」开关影响。
  - D2b：支持二进制文件，用于照片。
- **D3 收件箱：**
  - 手机原文保留 `kind: capture` 和作者。
  - `origin` 映射成署名 `by`，权限按 Agent 校验。
  - 执行 `.actions.jsonl` 并去重，写 `phone/receipts.json`。
- **D4 数据规范：** 投入（工作 / 学习 / 个人 × 长期投入 / 项目）、阶段、尝试可以挂在任何投入下。改 PRD §6、schemas、AGENTS.md 模板和 core。之后快照加上投入。
- **D5（v0.6.1）快照补充：** 待核对草稿的内容（供手机采纳）、关键问题、到期的尝试。

## 7. iOS 端模块（`kaitu-ios`，本地 Codex 实现）

`KaituKit` 拆成两块：现有引擎为 `KaituKitHealth`，新增 `KaituKitData`。App target 只放界面。

- **I1 KaituKitData：**
  - 按 schema 写快照与写入格式的 Codable 模型，用 `schemas/fixtures/phone/` 做解码测试。
  - `WorkspaceStore`（iCloud、GitHub）、缓存、离线队列、回执叠加。
- **I2 界面骨架：**
  - 按 size class 切换：窄屏用 TabView（今天、开图），宽屏用 NavigationSplitView（侧栏，加开图两栏）。
  - 界面状态放在共享模型里，展开、合上不丢。
  - MapKit 画进度图，线型与电脑一致。
- **I3 今天与开图页面：** 按 product §4.1–4.2 实现。
- **I4 记一下：** 文字；语音（`SFSpeechRecognizer`，优先设备端识别）；可选标项目；照片（iCloud 方式）。
- **I5 操作（争取 v0.6）：** 完成下一步；确认日程时先用 EventKit 写进「开图」日历（需日历权限，提前 10 分钟提醒，备注 `开图记录：<日期>/<时间段 id>`），再交 `decide_proposal`；没有权限时照样交操作并说明「只记在开图里」。乐观显示，按回执更新。
- **I6 设置与首次使用：** 选存放位置、连接 GitHub、显示状态；保留健康设置；中英文。
- **I7 发布：** 版本 0.6.0，普通 iPhone 和 iPhone Duo 模拟器截图，提交 TestFlight，写发布说明。动手前先用 `xcrun simctl list devicetypes` 核对 Xcode 里有没有对应的设备类型。
- **I8（v0.6.1）问问：**
  - `ChatProvider` 协议，先做 OpenAI 兼容实现（DeepSeek 默认），Key 存钥匙串。
  - 工具：读快照和资料文件、按 §4 写收件箱。对话存本地。
  - 另放一个 `ProProvider` 占位，留给付费版。
- **I9（v0.6.1）：** App Intents、小组件。

## 8. 以后独立使用：现在要守住的

- 界面只读快照、只写收件箱格式。以后换成手机自己（或云端）生成快照、处理收件箱，界面不用改。
- **两条路线：**
  1. **云端整理（v0.7 先做）：** 用户自己的云端 Agent 当整理员，白天按 ORGANIZER.md 处理手机文件、重算今天；能运行命令的 Agent 或仓库定时任务运行 `kaitu phone run`，用同一份代码。电脑开着时电脑优先。规范见 [agent-runner.md](agent-runner.md)。
  2. **手机端引擎（以后再评估）：** 把快照计算移植到 Swift，或者让 core 的纯计算部分在 JavaScriptCore 里跑；收件箱直接在手机上应用。GitHub 备份的记录级合并已经支持多端写同一批记录文件。
- **现在的约束：**
  - D1 的投影函数保持纯函数，输入是已读出的数据。
  - 快照尽量不依赖只在电脑上才有的状态。「最近三项变化」目前读的是本机版本历史，以后改从记录的修订里取。
- **问问：** 自带 Key 和付费版走同一个 `ChatProvider` 接口。

## 9. 测试与验收

- **格式：** 电脑端测试校验生成结果和样例都符合 schema；iOS 端测试解码同一批样例。
- **端到端（合成工作区，iCloud 和 GitHub 测试私库各跑一遍）：** 电脑生成快照 → 手机读取 → 手机交原文和操作 → 电脑处理 → 写回执 → 快照更新。
- **性能：**
  - 手机冷启动后从缓存显示今天不超过 0.3 秒。
  - 在 10,000 个文件的合成工作区里，电脑生成快照放后台完成，不阻塞保存；在验收记录里写明实测耗时。
- **布局：** 普通 iPhone、大屏 iPhone 横握、iPhone Duo 外屏和内屏，展开、合上都保留状态。

## 10. 分工与时间

| 日期 | 云端（本仓库，我派子 agent 实现并审） | 本地（`kaitu-ios`，Codex） |
|---|---|---|
| 10-18 | D1、D2、D3 | I1：先用 schema 和样例做模型与解码 |
| 10-19 – 20 | D 系列合并 | I2、I3、I4、I6 |
| 10-21 | 端到端联调（合成资料） | I5（争取）、修问题 |
| 10-22 | — | I7：TestFlight 0.6.0 |
| 10-23 | 官网加 iPhone 介绍 | — |
| 之后 | D4、D5 | I8、I9 |

每个模块单独写一份任务说明（目标、涉及文件、格式、验收、不要做的事），放在 `docs/mobile/tasks/`，由本地的 agent 分给 Codex。
要让我审 iOS 代码，需要把 `kaitu-ios` 推到 GitHub，并加进这个会话可访问的仓库。
