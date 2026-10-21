# 提案：一步建好个人记忆仓库，并让写代码的 Agent 接上项目记忆

状态：待用户确认（2026-10-19）。来源：用户试用 [shared-ai-memory](https://github.com/CodyQin/shared-ai-memory)（一段提示词让本机 Agent 建好私有记忆仓库）后的讨论。

## 1. 现状

开图的 GitHub 备份已经是一个能给 Agent 用的记忆仓库：

- 仓库里是工作区原样的 Markdown 和 JSONL（按「文字 / 记录」开关挑选，`.kaitu/`、密钥类文件名、媒体不上传），带 `AGENTS.md`；PR #31（K-2）起 GitHub 方式也维护 `AGENT-README.md`。
- 任何 Agent clone 下来就能读；写进 `inbox/agents/` 和 `handoffs/` 会同步回电脑（这两处不受开关影响，始终双向）。
- 同步有三方合并、按记录 id 合并、冲突暂停、只连私有仓库。传输层是干净的接口（`workspace-backup.ts` 的 `BackupRemote`：inspect / read / push）。

缺的是建起来太麻烦：用户要自己去 GitHub 建私有仓库、手动生成 fine-grained token（GitHub 只允许在网页上生成，十来次点击）、再粘回开图。shared-ai-memory 证明了「把这些仪式交给工具」能把门槛降到「在 GitHub 官方页面点一次同意」。

## 2. 方案

### 2.1 用已经登录的 `gh` 当传输（`ghBackupRemote`）

- 新增 `BackupRemote` 的第二个实现：通过 `gh api` 调 GitHub（`execFile`，不经 shell），和现有 token 实现同一组接口、同一套合并逻辑。
- 开图不保存任何凭据：token 留在 `gh` 自己的钥匙串里。连接记录里写 `via: "gh"`。
- 代价写明：`gh` 的登录通常是全部仓库的读写权限，开图进程用它就等于能访问你所有仓库。写代码的用户本来就这样在用 `gh`；不想这样的，继续用现在的单仓库 token。

### 2.2 开图里一个按钮，不必经过外部 Agent

「AI 与连接 › GitHub」加一个主按钮「建一个私有记忆仓库」：

1. 检查 `gh auth status`。已登录：直接 `gh repo create <名字> --private`，验证为私有，按 2.1 连接，立即同步一次，几秒内完成。
2. 装了 `gh` 但没登录：按钮变成「用 GitHub 登录」，调 `gh auth login --web`，用户只在 GitHub 官方页面点同意。
3. 没装 `gh`：给两条路：「安装 GitHub CLI」（官方链接），或者走现在的手动 token 流程。

自己的按钮比「复制一段提示词给 Agent」更直接；提示词留给下面两个场景。

### 2.3 命令行入口，让 Agent 也能驱动

`kaitu backup` 子命令，包一层现有的 `workspaceBackupRequest`：

```
kaitu backup status
kaitu backup connect <owner/repo> [--create] [--via gh|token]
kaitu backup sync
```

### 2.4 两段可复制的提示词

- **「在这台电脑上帮我建开图记忆仓库」**：给更习惯让 Agent 代劳的用户。提示词只允许运行 `gh` 官方命令和 `kaitu backup`；不索取密码、验证码、token；每次推送前确认仓库为私有。
- **「让另一台电脑或另一个 Agent 接上」**：仓库地址自动填好。对方 clone 后读 `AGENT-README.md` 接手，只往 `inbox/agents/` 和 `handoffs/` 写。这就是 agent-runner M2「交给 Agent 的说明」的 GitHub 版本，放在同一处。

### 2.5 写代码的 Agent 接上项目记忆

对写代码的人，最有价值的记忆是项目开发记忆：做到哪了、试过什么失败了、还有什么没解决。开图已经有项目（`projects/<slug>/STATUS.md`、仓库绑定 `github.ts`）、交接格式和 `kaitu mcp`，缺的是一条让 Codex / Claude Code 在项目仓库里顺手用起来的约定：

- 给编程 Agent 装一个技能「开图项目记忆」（Codex 和 Claude Code 各一份薄入口，内容相同）：
  - **开始时**：按当前仓库的远端地址找到对应的开图项目（`github.ts` 的绑定），读它的 `STATUS.md` 和最近一份开发交接。
  - **结束时**：写一份交接到收件箱：改了什么、试过但失败的方案、没解决的问题、下一步。格式用现有的 `handoffs/<时间>-<agent>.md`，frontmatter 加可选的 `project` 指向项目。
- 开图的项目页加一栏「最近的开发交接」，下一步照常由整理员合并进 `STATUS.md`。
- 不装钩子、不自动记录每次对话（ai-memory 那种做法太重，也会把大量无关内容收进来）。

## 3. 不做

- 不把 git 概念暴露给用户（界面不出现 commit、push、branch）。
- 不替代同步盘；GitHub 是可选的另一种存放位置。
- 不保存 `gh` 的 token；不放宽现有 token 方式的权限要求。
- 不做开图自己的 GitHub App 设备登录（要注册应用、处理 8 小时过期和续期，iOS PR 里已经踩过）；以后给不装 `gh` 的普通用户再做。

## 4. 验收

- 已登录 `gh` 的电脑上：点按钮到仓库建好、连接完成、首次同步结束，不超过 10 秒；仓库为私有；开图的状态目录里没有新增任何 token。
- 另一台电脑的 Agent 用「接上」提示词 clone 后，能说出当前项目和下一步；它写的交接在下一次同步后出现在电脑上。
- 在一个绑定了开图项目的代码仓库里用 Codex 工作一次：开始时读到项目状态，结束时交接出现在项目页「最近的开发交接」。
- `gh` 被登出后，开图显示「GitHub 登录已失效」，不悄悄停止同步。

## 5. 要用户定的

1. 2.1 用 `gh` 的宽权限登录，作为写代码用户的默认方式，是否接受。
2. 2.5 的开发交接放进现有 `handoffs/` 还是项目目录下单独一处（建议现有 `handoffs/`，frontmatter 加一个可选的 `project` 字段；这是接力格式的小扩展，也要确认）。
