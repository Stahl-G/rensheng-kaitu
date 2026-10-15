# Google Drive 模式（给 Grok Bot / ChatGPT Dots 用户）

状态：规格已定（2026-10-15，决策 D20），待实现。

## 为什么

Grok Bot 与 ChatGPT Dots 跑在云端电脑上，碰不到本机 `~/kaitu`，但都有 Google Drive 连接器。把工作区放进 Google Drive 同步文件夹，它们就能直接读到现状，也能把结果放回来，不需要把本机接口暴露到公网。能用这两个产品的用户本来就能用 Google Drive。

## 用户怎么开

1. 安装 Google Drive 电脑版（官方客户端），登录。
2. `kaitu drive enable`（工作台「设置 → 同步到 Google Drive」同等功能）：找到 Drive 的「我的云端硬盘」本地路径（macOS 一般在 `~/Library/CloudStorage/GoogleDrive-<账号>/` 下，子目录名随系统语言变化：英文 `My Drive`、中文「我的云端硬盘」等，不要写死，取该目录下唯一的可写子目录或让用户选；有多个账号时让用户选），把工作区移到其中的 `kaitu/`，并把不该上云的东西移出来（见下）。
3. 在 Grok Bot / Dots 里连上 Google Drive，告诉它「读 `kaitu/AGENT-README.md`」。
4. `kaitu drive disable`：搬回本机，状态目录合并回去。

默认关闭。开启前界面明确提示：健康等个人数据会存到 Google Drive。

## 目录：哪些上云，哪些留在本机

| 内容 | 位置 |
|---|---|
| 数据文件（模块、记录、记忆、对话、NOW.md、AGENTS.md……） | Drive 内的 `kaitu/` |
| `.kaitu/config.json`（不含密钥） | Drive 内，额外记录 `"state_dir"` |
| 版本库（git 目录） | **本机**状态目录 `history.git`（isomorphic-git 的 `gitdir` 与 `dir` 分开）。同步盘与 git 目录放一起会产生冲突副本、损坏版本库 |
| `secrets.json`、`index.sqlite`、`cache/`、上传暂存 | **本机**状态目录。Google Drive 电脑版不支持排除规则，所以不能靠忽略文件 |

本机状态目录：macOS `~/Library/Application Support/kaitu/<工作区 id>/`，Linux `$XDG_STATE_HOME/kaitu/<id>/`，Windows `%LOCALAPPDATA%\kaitu\<id>\`。本地模式下状态目录仍是 `<工作区>/.kaitu/`，行为不变。

## 云端 Agent 怎么读

- 根目录生成 `AGENT-README.md`：给云端 Agent 的简短入口（这是谁的工作区、先读哪几个文件、怎么把结果放回来、不能做什么）。Drive 连接器不一定能逐个打开深层目录，所以入口要短、路径写全。
- 根目录生成 `OVERVIEW.md`：`kaitu status` 的 Markdown 版（今天的安排与待确认、各模块进度与下一步、最近 7 天关键数据）。每次写入后与晚间复盘时刷新。云端 Agent 读这一个文件就能「一眼看到情况」。

## 云端 Agent 怎么写：收件箱（不直接改文件）

两边同时改同一个文件会产生冲突副本，所以云端 Agent **只在 `inbox/agents/` 里新建文件**，每个文件名唯一，不改已有文件。开图看到新文件后校验、写入、存版本，把原件移到 `inbox/processed/`（失败的移到 `inbox/rejected/` 并附原因）。

收件箱接受的文件（与 MCP 的 remote 工具集一致）：

| 文件 | 作用 |
|---|---|
| `*.digest.md`（frontmatter 含 `date`） | 写入 `feed/digests/<date>.md`，如 Grok 整理的 X 动态 |
| `*.records.jsonl`（每行 `{"type": "...", ...}`） | 逐条 `record add`，整批一个版本 |
| `*.memory.json`（候选记忆数组） | `memory import`，整批一个版本 |
| `*.proposal.json`（`title`、`start`、`end`、`module?`） | 追加到今天 NOW.md 的 proposal，等人在工作台确认 |

版本说明带来源，如「Agent（Drive 收件箱：grok-bot）写入了今天的动态简报」；来源取文件 frontmatter / 字段里的 `agent`，没有就写「云端 Agent」。不接受删除、恢复、改规则与目标。

谁来处理收件箱：`kaitu ui` 运行时自动处理（复用文件监听）；也可以手动 `kaitu inbox process`。

## 与 MCP 的关系

收件箱是默认路径（零暴露）。需要实时调用时再用 `kaitu mcp --http` + 隧道（见 `docs/remote-agents.md`）。两条路写入同一套 core 函数、同一套校验。

## 待核实

- Grok Bot / Dots 的 Google Drive 连接器能否读取、创建 `.md` / `.json` / `.jsonl` 纯文本文件（有的连接器只处理 Google 文档格式）。需要用户用真实账号试一次；不行的话，`OVERVIEW.md` 另存一份 Google 文档格式由 Drive 自动转换不在本地可控，届时再定。
- Google Drive 电脑版（File Provider）下文件监听是否可靠；不可靠时用已有的轮询回退。
- 「仅在线」占位文件被读取时的延迟。

## 本机端到端测试（开发机已具备：Google Drive 电脑版已登录、ChatGPT 与 Grok Bot 桌面应用已安装）

1. 用 `--sample` 建一个**测试工作区**（不要用真实数据），`kaitu drive enable` 移入 Drive 下的 `kaitu-test/`。
2. 本机检查：版本库、密钥、索引在本机状态目录；Drive 里没有 `.git`、`secrets.json`、`index.sqlite`；`kaitu doctor` 全部通过。
3. 在 Grok Bot / ChatGPT（Dots）里连 Google Drive，让它读 `kaitu-test/OVERVIEW.md` 并复述今天的待确认事项。
4. 让它在 `kaitu-test/inbox/agents/` 新建一份 `*.digest.md` 和一份 `*.records.jsonl`，确认本机开图处理后：数据写入、生成带来源的版本、原件移到 `processed/`。
5. 测完 `kaitu drive disable` 并删除 Drive 上的 `kaitu-test/`。
