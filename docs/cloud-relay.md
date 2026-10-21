# 云端接力协议：白天只追加，夜里整理一次

- 状态：设计已定（2026-10-15，第二版）。第一版的租约锁实测下来太重：步骤多、需要等待，ChatGPT 还看不到 `LOCK.json`，所以改为本方案。
- 目标：电脑关机时，任何云端 Agent（Dot、Grok、ChatGPT……）都能通过 Google Drive 接手，不用用户重讲，也不会互相覆盖。

## 1. 两个角色

| 角色 | 谁 | 能做什么 |
|---|---|---|
| **接力者** | 任何 Agent，任何时候 | 只新建文件：收件箱记录、交接记录。不改任何已有文件 |
| **整理员** | 任何 Agent，由用户设定定时任务（建议凌晨 3 点） | 按 `ORGANIZER.md` 写当天的每日整理，更新各模块 `STATUS.md` 的下一步，归档已整理的交接记录 |

整理员不和某个 Agent 绑定。谁的定时任务先跑，谁就当这一晚的整理员；后跑的看到当天的每日整理已经存在，就直接结束。所以可以给几家都设上定时任务，彼此错开半小时，互为备份。

## 2. 文件

| 文件 | 写入者 | 说明 |
|---|---|---|
| `inbox/agents/*` | 接力者 | 记录、记忆、简报、笔记、日程建议，格式不变。由本机 `kaitu` 导入 `data/` |
| `handoffs/<YYYYMMDDTHHMM>-<agent>.md` | 接力者 | 交接记录，平铺存放，不建子目录（两个 Agent 同时建子目录会在 Drive 上产生同名文件夹） |
| `handoffs/daily/<YYYY-MM-DD>.md` | 整理员 | 每日整理，是新一天的起点 |
| `handoffs/archive/<YYYY-MM-DD>/` | 整理员 | 已整理的交接记录移到这里，不删除 |
| `<模块>/STATUS.md` | 整理员（只改 `next`、`updated`）；本机 `kaitu` | 白天接力者不改 |
| `NOW.md` | 本机 `kaitu`、早间计划 | 云端只读 |
| `ORGANIZER.md`、`AGENT-README.md`、`OVERVIEW.md`、`AGENTS.md`、`data/`、`me/*` | 本机 `kaitu` | 云端只读 |

交接记录：

```markdown
---
agent: grok-bot
at: 2026-10-16T09:12:00+08:00
follows: handoffs/20261016T0830-dot.md
---
## 做了什么
- 记录午饭：inbox/agents/grok-bot-20261016T0912.records.jsonl
## 当前下一步
- health：周四练背 40 分钟（已完成）
- health：周六有氧 30 分钟
## 未决 / 需要用户
- 无
```

- `follows`：写明接续的是哪一份（上一份交接记录或每日整理）。下一位发现链条对不上，就说明有人漏读了。
- 「当前下一步」**写完整清单**，而不是只写改动。这样最新一份交接本身就是当前状态，白天不需要改 `STATUS.md`。

## 3. 接手顺序（`AGENT-README.md`）

1. `AGENT-README.md`
2. `handoffs/daily/` 里最新的一份每日整理；没有就读 `OVERVIEW.md`
3. `handoffs/` 根目录下比它新的交接记录，按时间排序
4. `inbox/agents/` 里比它新的文件
5. 需要细节时再读 `NOW.md`、`<模块>/STATUS.md`、`me/`、`memory/`

结束前，只要做过任何事，就新建一份交接记录。如果同时有两份交接都接续同一份（说明有人并行），就把两份都读，在自己的交接里合并它们的「当前下一步」。

## 4. 整理员（`ORGANIZER.md`）

`ORGANIZER.md` 在任何存放位置都生成：本机和 iCloud 下由开图自带的「开图每日整理」（Kaitu.app 或 DSH）执行，没有交接记录时跳过第 3、6 步。

1. `handoffs/daily/<今天>.md` 已经存在：说明今晚已经有人整理过，直接结束。
2. 读最新的每日整理，再读它之后的全部交接记录和收件箱文件。
3. 把交接合并进各模块 `STATUS.md` 的 `next`，不整份照抄交接：改之前先重读，以现在的 `next` 为起点；只应用交接明确写出的变化（完成、新增、改期、取消），交接没提到的条目原样保留。`STATUS.md` 的 `updated` 晚于最新一份交接的 `at`，说明用户在交接之后改过，这个文件的 `next` 不动，把差异写进「未决事项」。只改 `next`、`updated` 两个字段，不动其他字段和正文。
4. 整理用户随手记下的原文（`inbox/notes/` 里 kind 为 capture 的笔记），要用开图工具（Kaitu.app 或 DSH 里的 `kaitu_inbox`、`kaitu_onboarding`，或命令行 `kaitu inbox`、`kaitu onboarding matter-read / matter-draft`）：想推进的事用 `matter-draft` 存成待核对草稿，其他内容只在每日整理里写一句可以怎么记；处理完一条用 `inbox done` 归档，不再算等待整理。不创建待办、记录或记忆，不替用户采纳。没有这些工具的云端 Agent 不动原文，只写还有几条待整理。
5. 写 `handoffs/daily/<今天>.md`，内容是：昨天做了什么（附来源文件）、当前下一步、原文整理、未决事项、收件箱里还没导入的记录。
6. 把已整理的交接记录移到 `handoffs/archive/<今天>/`。不删除任何文件，`inbox/agents/` 也不动，留给本机导入。
7. 有拿不准的地方（例如两份交接互相矛盾），就写进每日整理的「未决」，不要猜。

整理员不能做的：删除任何文件；直接改 `NOW.md`、`inbox/`（原文只按第 4 步用工具归档）、`data/`、`me/`、`memory/` 和本机生成的文件；写外部日历或替用户联系任何人。这些都只是协议约定，真正的权限边界是 Drive 授权，所以授权时尽量只给开图文件夹。

## 5. 本机 `kaitu`

- 开机时照常处理收件箱：记录进 `data/`，存版本，刷新 `OVERVIEW.md`。
- `OVERVIEW.md` 增加两节：最新一份每日整理的路径，以及最近 3 份交接记录。
- 生成 `ORGANIZER.md`。
- `kaitu doctor` 报告 Drive 冲突副本（例如 `STATUS (1).md`）和同名子目录。
- `upgrade` 补建 `handoffs/daily/`、`handoffs/archive/` 并生成 `ORGANIZER.md`。第一版留下的 `LOCK.json` 已经没有程序读取，可以手动删除。

## 6. 待实测

- 各家 Agent 的定时任务能不能在电脑关机时读写 Drive。
- 整理员能不能在 Drive 里移动文件。不能移动时，就在每日整理里列出已整理的文件，接手的人只读比每日整理新的交接，效果相同。
