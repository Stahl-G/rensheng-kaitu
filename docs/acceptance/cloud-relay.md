# 验收脚本：云端接力 Dot → Grok → ChatGPT（电脑关机）

协议见 [cloud-relay.md](../cloud-relay.md)。全程用**测试工作区**，不用真实数据。每一步把结果填进末尾的记录表。

## 准备（电脑开着，约 5 分钟）

前提：[briefs/cloud-relay.md](../briefs/cloud-relay.md) 已实现，并在 runtime worktree 里重新构建过 `kaitu`。

注意：`kaitu drive enable` 会把本机的「默认工作区」指针改到它刚开启的工作区。为了不影响你真实的工作区，下面的命令都设置了 `HOME=~/kaitu-relay-home`，让测试工作区使用一套独立的本机状态。关机重启后这个目录还在，第 5 步还要用。

```bash
D=$(ls -d ~/Library/CloudStorage/GoogleDrive-*/我的云端硬盘 | head -1); echo "$D"
```

```bash
HOME=~/kaitu-relay-home kaitu init ~/kaitu-relay-home/kaitu-relay-test --sample
```

```bash
HOME=~/kaitu-relay-home kaitu drive enable --dir ~/kaitu-relay-home/kaitu-relay-test --drive-dir "$D" --name kaitu-relay-test
```

然后：
1. 在 Google Drive 网页版确认 `我的云端硬盘/kaitu-relay-test/` 下有 `AGENT-README.md`、`OVERVIEW.md`、`NOW.md`、`health/STATUS.md`、`handoffs/`。
2. 在 Dot、Grok、ChatGPT 里都连上 Google Drive，授权范围尽量只给这个文件夹。
3. **关机**（或至少退出 Google Drive 电脑版、关掉 `kaitu ui`）。之后的检查都用 Drive 网页版看。

## 第 0 步：连接器能力探测（每个 Agent 各做一次）

发给 Agent：

> 打开我 Google Drive 里的 kaitu-relay-test 文件夹，不要改任何文件，只回答：1）你能列出根目录文件吗，列出来；2）你能读 AGENT-README.md 吗，复述它的前三条规则；3）你能在 inbox/agents/ 新建文件吗；4）你能覆盖修改已有文件吗（只回答能不能，不要真改）。

| 能力 | 不具备时 |
|---|---|
| 列目录 + 读文件 | 不能参加接力 |
| 新建文件 | 只能当「只读接力者」，只回答、不写入 |
| 覆盖已有文件 | 不能取锁、不能改状态文件；只能追加 |

## 第 1 棒：Dot 记录并更新状态

> 打开 Google Drive 的 kaitu-relay-test，先读 AGENT-README.md 并严格按它的规则做。今天中午吃了一份鸡胸肉饭，下午深蹲 3×12，60kg。把健康模块的下一步加一条「周四练背 40 分钟」。做完写交接记录。

在 Drive 网页版检查：
- [ ] `inbox/agents/` 新增 1 个记录文件，里面有饮食和训练两条
- [ ] `LOCK.json` 出现过 `holder: dot`（可以看文件历史），最后 `expires_at` ≤ 当前时间（已放锁）
- [ ] `health/STATUS.md` 的 `next` 多了「周四练背 40 分钟」，原有条目都还在
- [ ] `handoffs/` 新增一份交接记录，写明做了什么、下一步
- [ ] 没有出现 `STATUS (1).md` 之类的冲突副本

## 第 2 棒：Grok 接手（故意不给背景）

> 打开 Google Drive 的 kaitu-relay-test，按 AGENT-README.md 接手。我今天吃了什么、练了什么？健康的下一步是什么？然后把「周四练背」标记完成，再加一条「周六有氧 30 分钟」。做完写交接记录。

- [ ] **不用补充背景**就能答出鸡胸肉饭、深蹲 3×12 60kg（说明它读了收件箱里还没处理的文件）
- [ ] 能说出上一棒是 Dot
- [ ] `health/STATUS.md`：「周四练背」状态改成 done，新增「周六有氧」，其他条目没被删
- [ ] 锁：取锁时写的是 `grok-bot`，结束已放锁
- [ ] 新增一份交接记录

## 第 3 棒：ChatGPT 接手

> 打开 Google Drive 的 kaitu-relay-test，按 AGENT-README.md 接手。总结一下我最近的进度：前两次是谁处理的、各做了什么、现在下一步是什么。

- [ ] 正确说出 Dot 和 Grok 各自做了什么，下一步是「周六有氧 30 分钟」
- [ ] 不把已完成的「周四练背」当作待办
- [ ] 如果它能写：新增一份交接记录；如果只能读：明确说自己只读，没有假装写过

## 第 4 步：锁的冲突测试（任选一个能写的 Agent）

1. 在 Drive 网页版把 `LOCK.json` 改成别人持有，`expires_at` 设为 30 分钟以后：

   ```json
   { "holder": "manual-test", "purpose": "测试", "acquired_at": "2026-10-16T10:00:00+08:00", "expires_at": "2026-10-16T10:30:00+08:00" }
   ```

2. 发给 Agent：

   > 按 AGENT-README.md，把健康下一步「周六有氧」改成「周日有氧」。

   - [ ] 它**不改** `STATUS.md`，告诉你 manual-test 正在持锁，并把想做的修改写进交接记录的「未决」

3. 把 `expires_at` 改成过去的时间，再发一次同样的话。
   - [ ] 这次它取锁、改好、放锁

## 第 5 步：开机收尾

开机，打开 Google Drive 电脑版，运行：

```bash
D=$(ls -d ~/Library/CloudStorage/GoogleDrive-*/我的云端硬盘 | head -1)/kaitu-relay-test; echo "$D"
```

```bash
HOME=~/kaitu-relay-home kaitu inbox process --dir "$D"
```

```bash
HOME=~/kaitu-relay-home kaitu doctor --dir "$D"
```

```bash
HOME=~/kaitu-relay-home kaitu history --dir "$D"
```

- [ ] 收件箱里的记录全部入库，原件移到 `processed/`
- [ ] `OVERVIEW.md` 出现「最近交接」，列出最近的交接记录
- [ ] `doctor` 通过，没有冲突副本
- [ ] 历史里能看到云端对 `STATUS.md` 的改动版本，版本说明标着云端改动

测完：在 Drive 网页版把 `kaitu-relay-test/` 移到回收站，再在访达里删掉 `~/kaitu-relay-home`。你的真实工作区和默认指针始终没有被改动过。

## 记录表

| 步骤 | Dot | Grok | ChatGPT | 备注 |
|---|---|---|---|---|
| 0 列目录 / 读 / 新建 / 覆盖 | | | | |
| 1 记录 + 改状态 | | — | — | |
| 2 不重讲接手 + 改状态 | — | | — | |
| 3 总结接力 | — | — | | |
| 4 锁冲突（被拒 / 过期接管） | | | | |
| 5 开机收尾 | | | | |

通过标准：第 1–3 棒全部打勾，且第 4 步至少一个 Agent 通过。只要有一家 Agent 无法覆盖文件，就把它记为「只追加接力者」，不算失败；但第 1、2 棒里至少要有一个 Agent 能改状态文件。
