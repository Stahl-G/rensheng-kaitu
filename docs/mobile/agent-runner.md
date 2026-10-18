# 开图 iPhone v0.7：电脑不在也能用

更新：2026-10-18。产品依据见 [product.md](product.md)，读写格式见[手机契约](../guides/phone-contract.md)。
给 Agent 照做的规则是 [PHONE-RUNNER.md](PHONE-RUNNER.md)，放在资料位置根目录。

## 1. 要解决什么

- v0.6 的手机是电脑的伙伴：今天的内容由电脑生成，手机交的东西等电脑处理。电脑一关，手机就停在上一次的内容，记下的东西一直「等电脑处理」。
- 很多用户已经在用 Dot、Grok Bot 这类云端常驻 Agent，它们本来就按开图的接力规则读写资料（HANDOFF D20）。
- v0.7 让用户自己的云端 Agent 当「手机更新员」：电脑不在时，按电脑的规则处理手机交来的文件、生成手机要读的今天。
- 电脑保留，电脑开着时总是电脑优先。手机界面结构不变，只多显示「谁更新的」。

## 2. 角色

| 角色 | 谁 | 能写什么 | 规则 |
|---|---|---|---|
| 接力者 | 任何 Agent | 只新建 `inbox/agents/*`、`handoffs/*.md` | `AGENT-README.md` |
| 整理员 | 夜间定时任务 | 每日整理，各 STATUS.md 的 next | `ORGANIZER.md` |
| 更新员（新） | 用户指定的云端 Agent | 手机文件带来的几处改动，`phone/today.json`、`phone/receipts.json` | `PHONE-RUNNER.md` |

同一个 Agent 可以兼任整理员和更新员。

## 3. 存放位置

- **GitHub 私有仓库（推荐）**：手机支持最完整，电脑用 GitHub 备份同步。Agent 用只授权这一个仓库的 token，或它自带的 GitHub 连接。
- **Google Drive**：沿用 Drive 模式（D20），整个资料文件夹在 Drive 里；手机经「文件」读写，尽力支持。
- **iCloud**：云端 Agent 读不到，不支持。
- 待核实：Dot、Grok Bot 各自能写 GitHub 还是 Drive。这是测试第一步，核实前不对用户承诺。

## 4. 两档能力

| | 一档：只能读写文件 | 二档：能运行命令 |
|---|---|---|
| 例子 | Dot、Grok Bot 这类对话型 Agent | 云端编程 Agent 的定时任务、仓库定时任务 |
| 手机操作、原文 | 按 PHONE-RUNNER.md 处理 | `kaitu phone run`，与电脑同一份代码 |
| 手机记录、健康文件 | 不处理，留给电脑 | 处理 |
| today.json | 按规则重算 | 生成 |
| week.json、map.json | 不动，沿用电脑上次生成的 | 生成 |

一档的规则从电脑代码逐条抄出（`overview-page.ts`、`phone-projections.ts`、`phone-actions.ts`、`inbox.ts`）；对不上时以电脑下一次生成的为准。
二档需要先定命令行的发布方式（现在 `packages/cli` 不发布），定之前只做一档。

## 5. 电脑优先

不加心跳文件。更新员每次运行只在三种情况下动手（PHONE-RUNNER.md 第 0 步）：

1. 手机文件在收件箱里超过 15 分钟没人收。
2. 过了 00:15，today.json 还是昨天的。
3. 别人（不是电脑）改了 NOW.md 或 STATUS.md 已经 10 分钟，today.json 还没跟上。GitHub 上按提交信息「开图工作区同步」认出电脑。

电脑开着时，一两分钟内就会收走手机文件、重算快照，三条都不成立，更新员什么也不做。
电脑回来后，一分钟内就用自己生成的快照覆盖（现有行为：`phone/` 以电脑为准，内容不同就重写）。
一档算出的 today 和电脑不完全一样时，电脑开着期间可能来回覆盖，每次 Agent 运行最多一次；T11 记录实际情况。

两个 Agent 都当更新员时，运行时间至少错开 30 分钟，和整理员「多家错开半小时」一致。

剩下的竞争：电脑恰好在更新员处理同一个手机文件的一两分钟里启动，两边都会执行。
操作靠 client_id 去重（第 8 节 R4），原文按文件名去重；手机记录一档不处理，不会重复。

## 6. 可信边界

- 让 Agent 当更新员，就是把电脑「处理手机文件」的权限交给它。设置页写明，只交给信任的 Agent。
- 手机文件仍只有 Agent 的权限：更新员只执行 complete_next、decide_proposal、complete_task、cancel_task，与电脑相同。
- 只能由用户本人做的决定，更新员同样不做：确认阶段、写阶段回顾、启用方向、采纳草稿或建议。
- 更新员不写外部日历。手机确认日程后自己写进日历，更新员只把状态标成 `calendar: phone`。
- 只改这几处：STATUS.md 里 next 的状态和 updated；NOW.md 里待确认日程的状态；待办文件末尾追加新版本；`inbox/notes/`、`inbox/processed/` 新建文件；`phone/today.json`、`phone/receipts.json`；`handoffs/` 新建交接。
- 快照不含财务明细、标为敏感的记忆、Key 和本机绝对路径。
- Agent 读到的资料由它所在的服务处理。设置页写一句，不展开。

## 7. 格式改动（待用户确认）

`today`、`week`、`map` 三份快照加可选字段 `generator`：

```json
"generator": { "kind": "agent", "name": "Dot", "spec": 1 }
```

- kind：`computer` 或 `agent`。name：显示给用户的名字，不超过 32 个字；电脑不写名字。spec：Agent 照做的 PHONE-RUNNER.md 规则版本。
- 没有 generator 的快照当作电脑生成，老电脑版本照常可用。
- 现有 schema 没有禁止额外字段，手机也忽略不认识的字段，所以 version 仍为 1。
- 确认后要改：`schemas/phone-today|week|map.schema.json`、`schemas/fixtures/phone/`、手机契约、AGENTS.md 生成模板 §11。

## 8. 电脑端改动（本仓库）

| # | 改什么 | 为什么 |
|---|---|---|
| R1 | 快照写 `generator: {kind: "computer"}`（待确认，见第 7 节） | 手机分清谁更新的 |
| R2 | GitHub 同步时，远端 `phone/receipts.json` 里本机没有的回执先并进本机，再上传；today、week、map 仍以电脑为准 | 现在会用本机回执整份覆盖，丢掉更新员写的 |
| R3 | GitHub 备份双向同步 `inbox/notes/**/*.md`，不受文字开关影响 | 更新员移走的原文要回到电脑；顺带备份还没整理的原文 |
| R4 | 手机操作去重时，`phone/receipts.json` 里已有的 client_id 也算处理过 | 去重账本在本机 `.kaitu/`，不同步 |
| R5 | 像 ORGANIZER.md 一样生成并维护 `PHONE-RUNNER.md`；GitHub 方式也维护 `AGENT-README.md`（现在只有 Drive 方式）；AGENTS.md 模板 §11 加一行 | 规则跟着开图版本更新，不靠用户手抄 |
| R6 | `kaitu phone run [--as <名字>] [--dry-run]`：处理收件箱并生成全部快照，写 generator | 二档；也用来核对一档的结果 |

PHONE-RUNNER.md 假定电脑已有 R2–R5。测试阶段在合成仓库里手动放一份。

## 9. 手机端改动（`kaitu-ios`）

- **I10**：状态行用 generator 显示「Dot 07:30 更新」；没有 generator 显示「电脑 07:30 更新」。
- **I11**：一周卡片和开图页的生成者或日期与今天不同时，写一行「电脑 10-16 的数据」。
- **I12**：设置加「更新来源」：电脑和 Agent 各自上次更新的时间；「交给 Agent 的说明」一键拷贝，自动填好资料仓库和时区。
- **I13**：空状态加第二条路「让我的 Agent 来更新」，同样拷贝说明。
- **I14**：在路上的条目：today.json 由 Agent 生成时，原文和操作写「等 Dot 处理」；手机记录仍写「等电脑处理」，一档不处理它们。

交给 Agent 的说明（手机生成，仓库名和时区自动填）：

```text
你是我的「开图手机更新员」。
资料位置：GitHub 私有仓库 owner/kaitu（只用这个仓库）。
每天 06:30、12:30、18:30、22:30（北京时间）各运行一次；我说「更新开图」时也运行一次。
每次运行先读仓库根目录的 PHONE-RUNNER.md，照做，不做它没写的事。
```

## 10. 测试（合成工作区，Dot 和 Grok Bot）

只用合成资料，不用真实工作区和真实凭据。

1. 电脑上用合成资料新建工作区，连到一个新的私有测试仓库，等电脑生成一次 `phone/`，然后退出开图。
2. 把 PHONE-RUNNER.md 放到仓库根目录；给 Agent 一个只授权这个仓库的 token，或用它自带的连接。先核实它能不能写（第 3 节）。
3. 把第 9 节的说明交给 Dot（主）；Grok Bot 错开 30 分钟（备）。
4. 用例：

| # | 做什么 | 期望 |
|---|---|---|
| T1 | 把 NOW.md 改成今天，含一条待确认日程 | today.json 是今天，proposals 一条，generator 是 Dot |
| T2 | 交 complete_next | STATUS.md 那条 done、updated 更新；回执 applied；原件到 `inbox/processed/<今天>/`；today 的 next 不再有它 |
| T3 | 同一 client_id 再交一次 | duplicate，不再执行 |
| T4 | 对已完成的那条用新 client_id 再交 | conflict，带原因 |
| T5 | 交 answer_question | rejected |
| T6 | decide_proposal confirmed | NOW.md 那条 confirmed、`calendar: phone`；日历没有新事件 |
| T7 | complete_task | 待办文件末尾多一行 rev+1、status done、by user；旧行不变 |
| T8 | 交 `.note.md` | 移到 `inbox/notes/<date>/`，回执 applied |
| T9 | 交 `.records.jsonl` | 原样留在收件箱，received 计入 |
| T10 | STATUS.md 加一条没有 id 的下一步 | 不进 today，交接里写明 |
| T11 | 打开电脑上的开图 | 一分钟内快照换回电脑生成；之后 Agent 运行时不动手 |
| T12 | 检查所有快照 | 没有绝对路径、财务明细、敏感记忆、Key |

5. 对照：同一仓库状态下用电脑（以后用 `kaitu phone run --dry-run`）生成一份，除 generated_at、generator 外逐字段比较，差异写进验收记录。
6. 记录写到 `docs/acceptance/agent-runner-<日期>.md`：每个用例的结果、每次运行用时、Agent 能写哪种存放位置。

## 11. 这次不做

- 只有手机、从没在电脑上建过的资料位置（以后考虑从模板仓库新建）。
- 一档重算 week.json、map.json。
- 手机可信确认通道。
- 开图托管的云端更新（与付费版一起评估）。
- 手机端自己的引擎（见 [architecture.md](architecture.md) §8）。
