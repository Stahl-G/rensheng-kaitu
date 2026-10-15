# 验收脚本：云端接力（第二版：白天只追加，夜里整理一次）

协议见 [cloud-relay.md](../cloud-relay.md)。全程使用 Drive 里的**测试工作区** `kaitu-relay-test`，它的本机状态隔离在 `~/kaitu-relay-home`，不影响真实工作区。文件结果由 Claude 在本机检查，你只需要把 Agent 的回答贴回来。

## 准备（电脑开着）

测试工作区已经升级到第二版（2026-10-15 由 Claude 完成）。以后新建测试工作区时，运行：

```bash
D=$(ls -d ~/Library/CloudStorage/GoogleDrive-*/我的云端硬盘 | head -1)/kaitu-relay-test && HOME=~/kaitu-relay-home kaitu upgrade --dir "$D"
```

之后电脑可以关。

## 第 1 步：白天接力（一条做完再发下一条）

**Dot**

> 打开 Google Drive 的 kaitu-relay-test，先读 AGENT-README.md，严格按它的规则做。今天晚饭吃了牛肉面一碗，晚上跑步 5 公里，用了 30 分钟。下一步加一条「明天早上称体重」。做完写交接记录。

**Grok**（不给背景）

> 打开 Google Drive 的 kaitu-relay-test，按 AGENT-README.md 接手。我今天晚饭吃了什么、做了什么运动？现在的下一步有哪些？把「明天早上称体重」改成「后天早上称体重」。做完写交接记录。

- [ ] Grok 不用你补充背景就能说出牛肉面和跑步 5 公里，知道上一位是 Dot
- [ ] 两份交接都在 `handoffs/` 根目录，Grok 那份的 `follows` 指向 Dot 那份，「当前下一步」里是「后天早上称体重」
- [ ] 两家都没有改动任何已有文件

**ChatGPT**（只读）

> 打开 Google Drive 的 kaitu-relay-test，按 AGENT-README.md 接手，只读不写。总结我今天的进度：谁处理过、各做了什么、现在下一步是什么。

- [ ] 能说出 Dot 和 Grok 各做了什么，下一步是「后天早上称体重」

## 第 2 步：设定整理员（每家都设，彼此错开）

在 Grok 和 Dot 里各建一个**每天运行的定时任务**，时间分别是 03:00 和 03:30。任务指令写：

> 打开 Google Drive 的 kaitu-relay-test，读根目录的 ORGANIZER.md，严格按它做今天的每日整理。如果今天的每日整理已经存在，什么都不做，直接结束。

ChatGPT 只能读，不设整理员。

**想今天就看到效果**：不用等到凌晨，直接把上面这段话发给 Grok 执行一次；然后发给 Dot 执行一次。

- [ ] Grok 写出了 `handoffs/daily/<今天>.md`，`STATUS.md` 和 `NOW.md` 的下一步与最新交接一致，已整理的交接移到了 `handoffs/archive/<今天>/`
- [ ] Dot 看到今天的每日整理已经存在，什么都没做

## 第 3 步：第二天早上

等定时任务跑过之后，挑任意一家发：

> 打开 Google Drive 的 kaitu-relay-test，按 AGENT-README.md 接手。早上好，我现在的进度如何、今天该做什么？

- [ ] 它从每日整理开始读，答出昨天做的事和当前下一步，不需要你重讲
- [ ] 两家定时任务里只有一家真正做了整理，另一家跳过

## 第 4 步：开机收尾

```bash
D=$(ls -d ~/Library/CloudStorage/GoogleDrive-*/我的云端硬盘 | head -1)/kaitu-relay-test && HOME=~/kaitu-relay-home kaitu inbox process --dir "$D" && HOME=~/kaitu-relay-home kaitu doctor --dir "$D"
```

- [ ] 收件箱里的记录全部导入，`doctor` 通过，没有同名副本

测完：在 Drive 网页版把 `kaitu-relay-test/` 移到回收站，再在访达里删掉 `~/kaitu-relay-home`。

## 结果（2026-10-15，第二版）

**通过**：电脑不参与，Dot 与 Grok 通过 Drive 完成接力、夜间整理和第二天接手。

| 项 | Dot | Grok | ChatGPT |
|---|---|---|---|
| 读入口、列目录 | ✅ | ✅ | ✅（看不到 `.json` / `.jsonl`，只看到 `.md`） |
| 新建 / 覆盖文件 | ✅ / ✅ | ✅ / ✅ | ❌ 未确认，只读 |
| 接力（读到上一位的记录与交接） | ✅ | ✅ | 第二版未测 |
| 当整理员 | ✅ 当天已整理时正确跳过 | ✅ 每日整理质量高：7 份交接归档，矛盾写进未决，不猜 | — |
| 第二天接手 | ✅ 从每日整理接上 | — | — |

本机收尾：收件箱全部导入，`doctor` 通过，`OVERVIEW.md` 显示最新每日整理。

发现的问题：
- Dot 慢、偶尔停住，工具调用被取消后需要用户催；Grok 快而稳定。日常整理员优先用 Grok，Dot 作为 03:30 的备份。
- 同时给两个 Agent 发互相矛盾的指令（「明天」与「后天」称体重），整理员无法判断哪条是最新意图，只能写进未决，这是正确行为。Dot 第二天接手时自行认定「明天」才是最新指令，略有越界。
- 只给日期的记录导入后时间是 12:00，比如「晚上跑步」。需要准确时间时，应在记录里写 `ts`。
- 测试期间修改入口文件会让正在执行的 Agent 中途停下：测试时不要改规则。
