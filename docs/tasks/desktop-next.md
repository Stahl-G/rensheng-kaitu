# 电脑端（rensheng-kaitu）：接下来的任务

按顺序做。每项写目标、做什么、不要做和验收；规范以 [GOAL.md](../GOAL.md)、[PRODUCT.md](../PRODUCT.md)、[AGENTS.md](../../AGENTS.md) 为准。

检查命令（每个任务做完都跑）：

```sh
pnpm --filter @kaitu/core build     # dsh-plugin 按 core 的 dist 做类型检查，core 改过要先构建，否则会报旧类型的错
npm run typecheck
npx biome check .
npx vitest run <改到的包>/test      # 最后整体跑一次 npx vitest run
```

已知：`packages/cli/test/status.test.ts`「版本库只读时 record add 仍保存数据」在 root 用户下会失败（root 不受只读权限限制），普通用户下通过，不用修。

## K-1 问问：权限串台（P1，先做）

`packages/dsh-plugin/src/client/AskPage.tsx`（PR #28 之后的 main）有两处：

1. **新对话的第一条没有用上选好的权限。** 还没有对话时选「完整 Agent」只记在 `pendingMode`；发送时 `mode` 也取自 `pendingMode`，`modeForThread !== mode` 不成立，新建对话后跳过了 `askSetMode`，第一条按默认的受限模式发出。
2. **切到已有对话会悄悄提权。** `pendingMode` 在切换对话时没有清掉；切到一个受限的旧对话再发送，`modeForThread`（旧的 full）和这个对话的 `scoped` 不同，就调用 `askSetMode(id, "full", true)`，没有经过确认就把旧对话改成了完整 Agent。

改法：

- `selectThread` 里清掉 `pendingMode`。
- 发送时和「这个对话实际的权限」比较：新建的对话按它返回的 `thread.mode` 比，已有的对话按 `threads` 里的 mode 比，不和界面上显示的 `mode` 比。

验收：两个场景各一个测试（客户端逻辑抽成纯函数测，或在现有 AskPage 测试里加）；本机 Agent「只有完整模式、发送时直接开」的行为不变。

## K-2 整理员规则跟着开图版本走（agent-runner R5）

`docs/mobile/agent-runner.md` §8 R5：

- `renderOrganizer` 生成的 `ORGANIZER.md` 改成 `docs/mobile/ORGANIZER.md` 的内容（规则版本 1）。
- `renderAgentReadme` 的「两个角色与文件」改成「任何 Agent 都能交，用户指定的整理员负责整理和更新手机」。
- GitHub 备份方式也维护 `AGENT-README.md`（现在只有 Drive 方式）。
- AGENTS.md 生成模板 §11 里对应那句跟着改（`packages/core/src/agents-md.ts`）。

不要做：不改 ORGANIZER.md 的规则本身；规则有疑问写进晨报。

验收：新建工作区和已有工作区升级后，根目录的 `ORGANIZER.md` 与 `docs/mobile/ORGANIZER.md` 一致（生成时间这类字段除外）；GitHub 备份同步后远端有 `AGENT-README.md`。

## K-3 `kaitu phone run`（agent-runner R6）

`kaitu phone run [--as <名字>] [--dry-run]`：处理收件箱里的手机文件、生成全部快照，写 `generator`（`--as` 给了就是 `{kind:"agent", name, spec:1}`，否则 `{kind:"computer"}`）。`--dry-run` 只打印会写哪些文件和差异，不写。

用途：云端 Agent 有命令行时直接用它，不用照 ORGANIZER.md 手工算；也用来核对 Agent 手工算的结果（agent-runner §10 第 5 条）。

验收：合成工作区里放一条手机原文和一条操作，`--dry-run` 列出将写的 `phone/*.json` 和回执；正式运行后快照通过 schema，`generator` 正确，再跑一次没有写入。

## K-4 Mac「云端整理员」一节（agent-runner M1–M4）

设计稿：`docs/design/iphone/Mac.dc.html`；规范：agent-runner §8「Mac 端界面」。位置在「我的 › AI 与连接」，把「云端的 AI（进阶）」改名为「云端整理员」。

- M1：整理员是谁、做了什么（读到 Agent 生成的 today.json 时记下名字和时间，存在本机状态目录；GitHub 方式在同步拉到远端 today.json 时读，Drive 方式在电脑重写前读）。
- M2：交给 Agent 的说明，一键拷贝，资料位置和时区自动填。
- M3：手机由谁更新（电脑开着时永远是这台电脑，不做开关）。
- M4：电脑不在时 Agent 做了什么，回来后列几行，看过收起。

不要做：不加网络请求；不加开关；打开这一节在 0.1 秒内显示（只读已有文件和状态）。

验收：合成工作区里放一份 `generator` 为 Dot 的 today.json 和几条 Agent 写的回执，页面显示 M1、M4 的内容；截图放进 PR。

## K-5 资料目录的耗时

`phone/library.json` 在合成大工作区（60 个项目、6,000 条原文、5,000 条训练、300 条记忆）上生成约 0.5 秒（2026-10-19 实测，含 YAML 解析；之后改成只取正文，应更快）。

- 重测一次，数字写进晨报。
- 如果还超过 0.3 秒：原文首行跟着 `inboxNotes` 的解析缓存一起存（文件没变就不再读），不要另加缓存层。

## K-6 架构升级的收尾

主仓库审查还在跑，结果出来后补到这里；补之前跳过这一项。

## K-7 首批试用的四道门槛

`docs/prd/launch.md` §1a 的 G1–G4 是邀请前必须过的。具体缺口等主仓库审查结果补充；G3（记录可靠）优先于任何新功能。
