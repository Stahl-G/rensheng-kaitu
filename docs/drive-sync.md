# 存放位置：本机、iCloud 或 Google Drive

本轮只提供后端、CLI 与本地接口。设置页面由 ui-v2 后续接入。

## 怎么选择

| 存放位置 | 用途 | 云端 AI 接力 |
|---|---|---|
| 本机（默认） | 只在当前 Mac 使用，不依赖云盘 | 无 |
| iCloud | 多台 Mac 同步资料，为以后的 iPhone 开图准备文件位置 | 无，云端 AI 读不到 iCloud |
| Google Drive | 同步资料，并让 Grok Bot / ChatGPT Dots 通过 Drive 连接器接力 | 唯一支持的云端接力途径 |

三选一。已启用一种同步模式时，开启另一种会报错，先搬回本机再选择。
两种同步模式都把版本、密钥、索引、cache、上传暂存留在本机状态目录。

## 命令

```sh
kaitu sync status
kaitu sync enable icloud
kaitu sync enable drive
kaitu sync enable icloud --dir /自选同步目录 --name kaitu
kaitu sync disable --to /本机目录/kaitu
```

- `sync enable --dir` 指同步目标的父目录；原工作区从 `KAITU_DIR` 或 current-workspace 指针读取，缺省 `~/kaitu`。
- iCloud 仅支持 macOS，默认目标为 `~/Library/Mobile Documents/com~apple~CloudDocs/kaitu/`。
  iCloud 根目录不存在时，先在系统设置 → Apple 账户 → iCloud 里打开 iCloud 云盘。
  开启时在后台请求 `brctl download`，不等待，失败不阻止迁移。
  返回提示：在 Finder 里对 kaitu 文件夹选『始终保留下载』。
- Drive 自动查找唯一 Google Drive 账号下的可写目录；多账号或目录不明确时用 `--dir` 指定。
- `--name` 缺省 `kaitu`，目标已存在时不覆盖。
- `disable` 缺省搬回 `~/kaitu`；允许回到只留有本次迁移说明的目录。
- `kaitu drive enable [--drive-dir <路径>] [--name kaitu]`、`drive disable`、`drive status` 保留。
  旧命令的全局 `--dir` 仍指原工作区。
- 开启或搬回后，显式设置过 `KAITU_DIR` 的用户需更新或取消该变量，才能使用新位置；本机指针不覆盖显式路径。
- status 返回 `mode`、`path` / `root`、`stateDir`、上次收件箱处理时间与 iCloud 提示。
- 旧位置留下 `WORKSPACE-MOVED.md`，本机状态根目录的 `current-workspace.json` 记录当前位置。
  迁移后运行 doctor 与 validate。

同步模式和状态位置以本机状态根目录下的工作区映射为准，标准 iCloud 路径也参与识别。旧 `state_dir` 仅用于首次迁移，不再动态决定程序状态位置。
自定义同步目录的类型写在本机状态目录 `sync-location.json`。旧版自定义 Drive 目录没有此文件时仍按 Drive 识别。
config schema 与 PRD §6 保持不变。

## 本地接口

Kaitu.app 的 `local.mjs` 与 `kaitu ui` 共用 `packages/cli/src/ui/server.ts`：

- `GET /api/sync`：返回存放位置与状态目录。
- `POST /api/sync/enable`：`{"mode":"icloud","dir":"/可选父目录","name":"kaitu"}`，mode 也可为 `drive`；dir / name 可省略。
- `POST /api/sync/disable`：`{"to":"可选本机目标目录"}`。
- 保留 `GET /api/drive` 与 `POST /api/drive/enable`、`/api/drive/disable`；旧 enable 的 `driveDir` 参数继续支持。

写请求需 `X-Kaitu: 1` 和与服务同源的 `Origin`。接口复用原有本机访问校验与串行写入队列，迁移后重建文件监听。

## 目录：哪些上云，哪些留在本机

| 内容 | 位置 |
|---|---|
| 数据文件（模块、记录、记忆、对话、NOW.md、AGENTS.md……） | 所选同步文件夹内的 `kaitu/` |
| `.kaitu/config.json`（不含密钥） | 同步文件夹内，保留现有 `"state_dir"` |
| 版本库（git 目录） | **本机**状态目录 `history.git`（isomorphic-git 的 `gitdir` 与 `dir` 分开）。同步盘与 git 目录放一起会产生冲突副本、损坏版本库 |
| `secrets.json`、`index.sqlite`、`cache/`、上传暂存 | **本机**状态目录。这些程序状态不依赖云盘忽略规则 |

本地版本库为 `.kaitu/history.git/`，打开旧工作区时自动迁移 `.git`，失败明确报错并保留历史。
版本写入遇权限或磁盘空间问题时，数据保持已保存，提示稍后运行 `kaitu ui` 或 `kaitu snapshot` 补存版本。

本机状态目录：macOS `~/Library/Application Support/kaitu/<工作区 id>/`，Linux `$XDG_STATE_HOME/kaitu/<id>/`，Windows `%LOCALAPPDATA%\kaitu\<id>\`。本地模式下状态目录仍是 `<工作区>/.kaitu/`，行为不变。

## 云端 Agent 怎么读

- 只有 Drive 模式在根目录生成 `AGENT-README.md`（云端接力入口）与 `ORGANIZER.md`（夜间整理规则）。Drive 连接器不一定能逐个打开深层目录，所以入口要短、路径写全。
- 根目录生成 `OVERVIEW.md`：`kaitu status` 的 Markdown 版（今天的安排与待确认、各模块进度与下一步、最近 7 天关键数据）。每次 core 写入、晚间复盘保存版本及工作台检测到外部改动后刷新；内容不变不重写，派生文件事件不触发自动版本。云端 Agent 读这一个文件就能「一眼看到情况」。

## 云端 Agent 怎么写

按 [云端接力协议](cloud-relay.md)：白天只新建收件箱文件和交接记录，夜间整理员更新状态。本机处理成功后，收件箱原件移到 `inbox/processed/`，写错的部分转为 `inbox/notes/YYYY-MM-DD/`。

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
本机与 iCloud 模式同样生成 `OVERVIEW.md`，不生成云端接力入口。收件箱和交接目录继续保留。入口与现状开头标明用户时区与当天 UTC 偏移。

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

## iCloud 未下载文件与冲突副本

- 只有真实路径位于 iCloud 云盘目录下的工作区才启用未下载判断，不先读取 config。
  仅用 `lstat`：文件 `size > 0 && blocks === 0`，或同目录存在 `.文件名.icloud`，就视为未下载。
  同时在后台请求 `brctl download <路径>`，失败忽略，同一路径三十秒内不重复请求。
  其他文件直接 `readFileSync`，没有逐文件读取子进程或内容缓存；本机与 Drive 的读取路径保持原样。
- `doctor` 仅遍历元数据并列出未下载文件，对应 JSON 检查含 `files` 列表。扫描跳过它们，汇总携带已遇到文件的下载提示。
  构造函数不做全量下载检查；config 本身没下载时跳过维护。覆盖或追加未下载的原文件会报错。
  修改、删除、记忆索引更新与对话导入只检查各自前缀目录，不扫描整个工作区。
- 版本扫描过滤未下载文件、`.icloud` 占位文件和冲突副本，它们不算改动或删除，已有版本中的内容保留。
  其余文件照常生成版本，不因某个文件未下载而暂停全部版本历史。
  恢复只检查本次范围内实际会覆盖或移除的文件，列出其中未下载的路径并拒绝；无关文件不阻止局部恢复。
  搬回本机仍需共享文件全部下载完成。
- 识别 `NOW 2.md`、`xxx 2.jsonl`、`xxx (1).jsonl` 及带 `(Conflicted Copy)` / `[Conflict]` 显式标记的同步副本，包括冲突目录中的文件。
  仅当去掉数字后缀或显式冲突标记后原文件仍存在（或有占位文件）才判作副本，避免误判合法数字文件名。
  doctor 只列出供人工处理；校验、总览、记录/记忆/对话/收件箱扫描与版本暂存均跳过副本，不合并、不删除。

## 与 MCP 的关系

收件箱是默认路径（零暴露）。需要实时调用时再用 `kaitu mcp --http` + 隧道（见 `docs/remote-agents.md`）。两条路写入同一套 core 函数、同一套校验。MCP 的 `inbox_notes` 只读列出笔记，`inbox_note_done` 仅在 `--tools all` 中提供。

## 待核实

- Grok Bot / Dots 的 Google Drive 连接器能否读取、创建 `.md` / `.json` / `.jsonl` 纯文本文件（有的连接器只处理 Google 文档格式）。需要用户用真实账号试一次；不行的话，`OVERVIEW.md` 另存一份 Google 文档格式由 Drive 自动转换不在本地可控，届时再定。
- Google Drive 电脑版（File Provider）下文件监听是否可靠；不可靠时用已有的轮询回退。
- 真实 iCloud / Drive 的「仅在线」占位行为与文件监听时序。iCloud 已有元数据识别与逐文件版本过滤，仍需实际云盘验证。

## 本机端到端测试（开发机已具备：Google Drive 电脑版已登录、ChatGPT 与 Grok Bot 桌面应用已安装）

1. 用 `--sample` 建一个**测试工作区**（不要用真实数据），`kaitu drive enable` 移入 Drive 下的 `kaitu-test/`。
2. 本机检查：版本库、密钥、索引在本机状态目录；Drive 里没有 `.git`、`secrets.json`、`index.sqlite`；`kaitu doctor` 全部通过。
3. 在 Grok Bot / ChatGPT（Dots）里连 Google Drive，让它读 `kaitu-test/OVERVIEW.md` 并复述今天的待确认事项。
4. 让它在 `kaitu-test/inbox/agents/` 新建一份 `*.digest.md` 和一份 `*.records.jsonl`，确认本机开图处理后：数据写入、生成带来源的版本、原件移到 `processed/`。
5. 测完 `kaitu drive disable` 并删除 Drive 上的 `kaitu-test/`。
