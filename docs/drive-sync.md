# Google Drive 模式（给 Grok Bot / ChatGPT Dots 用户）

状态：已实现（2026-10-15，决策 D20）。临时目录迁移、收件箱与工作台自动保存已验证；真实 Drive / 云端连接器仍待实测。

## 为什么

Grok Bot 与 ChatGPT Dots 跑在云端电脑上，碰不到本机 `~/kaitu`，但都有 Google Drive 连接器。把工作区放进 Google Drive 同步文件夹，它们就能直接读到现状，也能把结果放回来，不需要把本机接口暴露到公网。能用这两个产品的用户本来就能用 Google Drive。

## 用户怎么开

1. 安装 Google Drive 电脑版（官方客户端），登录。
2. `kaitu drive enable`（工作台「设置 → 同步到 Google Drive」同等功能）：找到 Drive 的「我的云端硬盘」本地路径（macOS 一般在 `~/Library/CloudStorage/GoogleDrive-<账号>/` 下，子目录名随系统语言变化：英文 `My Drive`、中文「我的云端硬盘」等，不要写死，取该目录下唯一的可写子目录或让用户选；有多个账号时让用户选），把工作区移到其中的 `kaitu/`，并把不该上云的东西移出来（见下）。
3. 在 Grok Bot / Dots 里连上 Google Drive，告诉它「读 `kaitu/AGENT-README.md`」。
4. `kaitu drive disable`：搬回本机，状态目录合并回去。

默认关闭。开启前界面明确提示：个人数据会存到 Google Drive，版本历史与密钥留在本机。

- `kaitu drive enable [--drive-dir <我的云端硬盘目录>] [--name kaitu]`；目标已存在时报错，不覆盖。
- `kaitu drive disable [--to <本机目录>]`，默认搬到 `~/kaitu`；允许回到此前只留下迁移说明的目录。
- `kaitu drive status` 显示模式、路径、状态目录与上次处理收件箱的时间。
- 旧位置留下 `WORKSPACE-MOVED.md`；本机状态根目录的 `current-workspace.json` 供 `defaultRoot()` 找到当前位置，
  显式 `--dir` 与 `KAITU_DIR` 优先。迁移后运行 doctor 与 validate。

## 目录：哪些上云，哪些留在本机

| 内容 | 位置 |
|---|---|
| 数据文件（模块、记录、记忆、对话、NOW.md、AGENTS.md……） | Drive 内的 `kaitu/` |
| 仅本机项目与进度 | **本机**状态目录 `local-projects/<slug>/`；metric 在 `local-projects/projects/data/metrics/`，不会进入 OVERVIEW 或 MCP remote |
| `.kaitu/config.json`（不含密钥） | Drive 内，额外记录 `"state_dir"` |
| 版本库（git 目录） | **本机**状态目录 `history.git`（isomorphic-git 的 `gitdir` 与 `dir` 分开）。同步盘与 git 目录放一起会产生冲突副本、损坏版本库 |
| `secrets.json`、`index.sqlite`、`cache/`、上传暂存 | **本机**状态目录。Google Drive 电脑版不支持排除规则，所以不能靠忽略文件 |

本地版本库为 `.kaitu/history.git/`，打开旧工作区时自动迁移 `.git`，失败明确报错并保留历史。
版本写入遇权限或磁盘空间问题时，数据保持已保存，提示稍后运行 `kaitu ui` 或 `kaitu snapshot` 补存版本。

本机状态目录：macOS `~/Library/Application Support/kaitu/<工作区 id>/`，Linux `$XDG_STATE_HOME/kaitu/<id>/`，Windows `%LOCALAPPDATA%\kaitu\<id>\`。本地模式下状态目录仍是 `<工作区>/.kaitu/`，行为不变。

## 云端 Agent 怎么读

- 根目录生成 `AGENT-README.md`：给云端 Agent 的简短入口（这是谁的工作区、先读哪几个文件、怎么把结果放回来、不能做什么）。Drive 连接器不一定能逐个打开深层目录，所以入口要短、路径写全。
- 根目录生成 `OVERVIEW.md`：`kaitu status` 的 Markdown 版（今天的安排与待确认、各模块进度与下一步、最近 7 天关键数据）。每次 core 写入、晚间复盘保存版本及工作台检测到外部改动后刷新；内容不变不重写，派生文件事件不触发自动版本。云端 Agent 读这一个文件就能「一眼看到情况」。

## 云端 Agent 怎么写：收件箱（不直接改文件）

两边同时改同一个文件会产生冲突副本，所以云端 Agent **只在 `inbox/agents/` 里新建文件**，每个文件名唯一，不改已有文件。开图看到新文件后写入、存版本，成功原件移到 `inbox/processed/`；写错的部分连同原内容、原因、字段参考和示例转为 `inbox/notes/YYYY-MM-DD/` 的待整理笔记。

格式不确定时直接写 `*.note.md`，用自然语言即可，不会被拒；结构化文件写对会立即生效，写错的部分会转为待整理笔记。

收件箱接受的文件：

| 文件 | 作用 |
|---|---|
| `*.note.md`（frontmatter 可选 `agent`、`date`） | 原样保存为待整理笔记，正文可写任意自然语言 |
| `*.digest.md`（frontmatter 含 `date`） | 按来源合并到 `feed/digests/<date>.md`；同一来源重交替换自己的小节 |
| `*.records.jsonl`（每行 `{"type": "...", ...}`） | 逐条 `record add`，整批一个版本 |
| `*.memory.json`（候选记忆数组） | `memory import`，整批一个版本 |
| `*.proposal.json`（`title`、`start`、`end`、`module?`） | 追加到今天 NOW.md 的 proposal，等人在工作台确认 |

版本说明带来源，如「Agent（Drive 收件箱：grok-bot）写入了今天的动态简报」；来源取文件 frontmatter / 字段里的 `agent`，没有就写「云端 Agent」。不接受删除、恢复、改规则与目标。

处理前间隔 1.5 秒核对大小与修改时间，写入仍在变化时留待下一轮。
记录逐行、记忆逐条校验：合法部分立即写入，其余部分保留待整理；只接受新增操作。来源可写在简报 frontmatter、每行记录、每条记忆或建议的 `agent` 字段。
未处理文件不进版本，成功原件与待整理笔记均保存版本；处理时间与进程锁留在本机状态目录。
无法识别的文件也转为笔记；二进制只记录文件名、大小，原件放当日 notes 的 `files/`。同名文件保留独立副本，不覆盖。
本地模式同样生成 `AGENT-README.md`、`OVERVIEW.md` 与 `inbox/agents/`。入口与现状开头标明用户时区与当天 UTC 偏移。

记录格式从各模块 schema 自动生成，含自定义模块；`AGENT-README.md` 与本机 `AGENTS.md` 内嵌字段与示例。
本机可用 `kaitu record types` 列出全部类型、`kaitu record schema <类型>` 查单个类型。
复杂 pattern 或复合约束的 schema 可提供字段级或对象级 `examples`，供生成器选择合法示例。
收件箱的 `type` 与 `agent` 是传输字段，写入前去掉；有 `source` 字段的类型未填时取同文件 agent，缺省为 `cloud-agent`。
不自动猜测改名。时间可省略 ts（当前时间），或给带偏移的 ts；只给 date 时按用户时区当天 12:00 转为 ts。
类型本身定义 date（如 activity）时保留，其他类型在写入前去掉 date。
未知类型的笔记列出所有可用类型，已知类型附该类型字段参考和示例。

### 健康数据收件箱

按[一页安装指南](guides/apple-health.html)部署健康收件箱，密钥自动生成，本人设置页可复制完整同步地址；手机安装快捷指令时粘贴一次，并设每晚 22:00 运行。
设置页无法识别部署账号时，在编辑器手动运行 `showSyncUrl()` 从执行日志复制地址；实际 Gmail 身份识别、iPhone 与 Drive 链路待实测。
Apple 官方 `export.zip` / `export.xml` 与快捷指令 `*.health.json` 放进 `inbox/health/`。
复用 Agent 收件箱的稳定检查与监听；成功后原件归档到 `inbox/processed/YYYY-MM-DD/`，失败附原因转为待整理笔记。
成功归档的健康原件不进版本历史，整理后的记录按来源与自然键去重，有变化才存一个版本。
快捷指令只需输出原始样本，格式见 [health-shortcut-format.md](guides/health-shortcut-format.md)。
旧工作区先运行 `kaitu upgrade` 更新内置模块与技能，`kaitu upgrade --dry-run` 可预览。

谁来处理收件箱：`kaitu ui` 运行时自动处理（复用文件监听）；也可以手动 `kaitu inbox process`。

本机用 `kaitu inbox notes` 列出未整理笔记，用 `kaitu inbox done <路径>` 整理后归档到 `inbox/notes/done/YYYY-MM-DD/` 并生成版本。
`kaitu status`、OVERVIEW 与工作台「今天 · 需要你处理」显示待整理数量。
晚间复盘由本机 Agent 把可结构化内容写入记录、记忆或简报，保留原 agent 来源；拿不准的留着并列入日报。

## 与 MCP 的关系

收件箱是默认路径（零暴露）。需要实时调用时再用 `kaitu mcp --http` + 隧道（见 `docs/remote-agents.md`）。两条路写入同一套 core 函数、同一套校验。MCP 的 `inbox_notes` 只读列出笔记，`inbox_note_done` 仅在 `--tools all` 中提供。

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
