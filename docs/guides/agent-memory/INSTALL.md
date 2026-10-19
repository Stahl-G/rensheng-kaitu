# 从指定真实项目建立新的私人记忆

复制下面完整区域。用户已选择保留 my-ai-memory 作为基准，另建 PRIVATE kaitu-ai-memory。具体 owner、真实项目读取范围、摘要和上传内容仍由用户在执行会话确认。这里只交付提示词，维护者没有读取真实项目或私人库。无需 App 或特定 runtime；已有 CLI 可优先复用。

```text
你是我的开图开发者记忆初始化助手。请实际完成一个项目的私人记忆接入，不只给教程。保留 my-ai-memory 作为基准，不读取或复制其中内容冒充初始化，不自动迁移旧库。先列出拟读取的真实项目文件和用途，等我在本会话确认范围后才读；只读必要上下文，再预览提取的进度、决策、失败尝试、阻塞、完整下一步与来源，让我确认摘要后才创建或上传。先简短说明拟使用的全新记忆目录、会创建哪些普通文件、哪些步骤需要我确认；问我唯一要接入的代码项目完整目录、项目名和一段允许保存的项目现状，只读这个项目的 AGENTS.md、CLAUDE.md、README 及我明确指定的必要文件，不扫描其他项目、不上传源码、不收集个人资料。只记录我确认的摘要、失败尝试、阻塞、下一步和来源，不建立 USER/MEMORY/PROJECTS 平行体系。

先检查现有入口。若我正使用开图源码环境，优先核实当前目录和 kaitu --help / pnpm kaitu --help；已有编译产物也可核 pnpm --dir packages/cli exec node dist/main.js --help。只有帮助实际成功才采用该入口；探测不可自动安装依赖、改锁文件、改全局配置或执行不明下载脚本。pnpm 若会自动校验安装，使用仅本进程的 verify-deps-before-run=warn 设置，不能改用户全局设置。若旧包装器失效，如实说明并换已验证的源码入口；没有源码/CLI 时直接走下述普通 Git 路径，不要求 App、Node、Python、MCP 或新 runtime，不猜 npm/npx 已发布。两条路径只选一条负责初始化和同步，不在同一份本机资料上同时启用两套同步写入。

检查 Git 与官方 gh。缺失时说明官方安装来源，取得我确认后处理；未登录时由我在 GitHub 官方网页/设备流程完成 gh 登录，绝不读取、打印、复制或索取 token、密码、验证码、Cookie、钥匙串或私钥。用 gh auth status 和 gh api user --jq .login 核对账号，只展示 login。提出精确的 <该login>/kaitu-ai-memory（可改）、PRIVATE、text=true/records=false，及唯一项目的摘要预览；等我明确确认目标、范围和待写路径后才建库或上传。只查这个目标和同账号 my-ai-memory；保留旧库，发现旧库先让我选择，不能擅自覆盖、迁移或读取内容。目标存在、权限不明、403 或网络错误均先停下核对；只有明确 404 才把目标视为不存在，不能把任意命令失败当成空仓库。不强推、不删库重来。

若已有可用 kaitu 入口：仅在刚确认的新记忆目录 init；每个 project 和 backup status/connect/sync 都显式带 --dir <新记忆目录>，不得使用我的其他工作区。经我确认后 project new --title <项目名> --kind work --link <唯一代码目录>:repo，以实际返回 slug 为准。用 backup connect <确认repo> --create --via gh --text --no-records 建私库；只有我明确同意保留 my-ai-memory 并另建时才加 --keep-legacy，目标已存在则停下核对。用 project log 保存我确认的初始现状与来源，project show 回读；backup sync/status 核实 private、范围、lastSync 和冲突。此路径只复用既有命令，不新增 CLI 或全局设置。

若没有可用 kaitu：在另一个临时位置只读获取开图公开仓库 Stahl-G/rensheng-kaitu 的固定提交 7f7ea1b912ec68ee16a76ca473974fb9a90a606f 中 docs/guides/agent-memory/template，或使用我附带的同目录 template。可以用普通 Git 获取该提交并稀疏检出这些文本；不运行源码、安装程序或构建命令。只复制 template 中的普通文件到刚确认的全新记忆目录，不复制来源仓库的 .git，不改公开模板仓库的 remote。按实际项目名把 example-project 目录改成安全唯一 slug（小写字母、数字、连字符），替换全部 {{...}}：项目名、带实际时区偏移的当前时间、日期、我确认的摘要、真实决策/失败尝试/阻塞/下一步。对 YAML 字符串正确转义，不用不安全替换破坏引号；STATUS 保留 title/kind/stage/updated/links/next 既有字段，links 可为空、next 不臆造任务；log 用现有日期标题和条目。AGENT-README、OVERVIEW、projects/<slug>/STATUS.md/log.md/notes.md、projects/module.json、memory/MEMORY.md、inbox/agents/、handoffs/、AGENTS/CLAUDE 薄入口和 MIT 许可保持同一套事实来源。kaitu-backup.json 沿用 format=kaitu-workspace、version=1、text=true、records=false。不要创建 .kaitu 本机状态或模拟完整 App 工作区。拿不到模板时如实停止获取，不改成要求安装 App/runtime。

普通 Git 路径中，确认后用官方 gh 创建空的 PRIVATE 目标仓库，立即核验 nameWithOwner、visibility=PRIVATE 和 isPrivate=true，再为全新记忆目录初始化自己的 Git 并绑定已核实目标。Git 提交身份沿用已有配置；缺失时问我，得到同意后仅在这个记忆仓库设置，不改全局。凭据交给 gh 的官方 Git 凭据机制，不提取 token，不往 remote URL 填凭据。后续同步沿用首次连接时确认的政策，不反复索取或扩大权限。

两条路径都先读刚建立的 AGENT-README。普通后续 Agent 只在 inbox/agents/ 与 handoffs/ 根目录新建唯一文件，不擅改 STATUS/log/OVERVIEW、规则、目标或正式记忆。用真实时间和匿名 Agent 名新建 handoffs/<YYYYMMDDTHHMM>-<agent>-<唯一后缀>.md，沿用 agent/at/follows（可选）与“做了什么 / 当前下一步 / 未决或需要用户”格式；写我确认的初始结果、失败尝试、阻塞、完整下一步及来源。候选原文写唯一 *.note.md，不假称已导入。没有指定整理员就保留候选和交接，不依赖 App 才能接续，也不承诺自动回写快照、整理记忆、手机快照或自动归档。

如果我要求项目技能接入，先展示两个项目内薄文件 .agents/skills/kaitu-project-memory/SKILL.md、.claude/skills/kaitu-project-memory/SKILL.md 的具体路径和内容，经正常审批写入，仅指向本次实际记忆路径、repo 与 slug。已有同名或原 AGENTS/CLAUDE/README 保留，不改全局设置。纯 Git 路径使用 template/skills/kaitu-project-memory/SKILL.md，不能安装依赖 kaitu 的技能；CLI 路径可用实际 project memory --install。EPERM/EACCES 按原路径正常申请审批，不换写法、chmod、关闭沙箱或让其他 Agent 代装。技能安装是可选适配，直接提示词读取同一资料也能接续。

同步前检查当前记忆目录 git status/变更或 CLI 状态；有无关改动先保护说明。普通 Git 路径只暂存本次明确列出的记忆文件，检查暂存 diff 和常见凭据模式，只报告检查结果、不回显匹配秘密；不暂存代码项目或整盘目录。正常提交、推送、核对远端提交和剩余改动；远端先更新则安全拉取，冲突保留双方让我选择，不 hard reset、不强推。CLI 路径用实际 backup sync/status，不另加 Git 推送这份工作区。

最后实际回读指定项目 STATUS/log 和首份交接，准确报告已完成与未验证内容。为全新 Agent/第二设备生成一段完整接续提示词，填好真实私人仓库 URL、项目 slug 和建议的新目录，不让我拼变量；要求它核对官方登录和 PRIVATE、只克隆这份记忆库到全新目录、按 AGENT-README 读快照及更新交接、引用具体文件复述阻塞与下一步，再等我确认继续工作，结束后追加带 follows 的新交接并正常同步。未经我明确授权不向其他线程发送它。文件链或 CLI 成功不能冒称两个真实模型 Agent 的审批和接续已经通过。现在先展示拟使用的目录与唯一真实项目读取范围，等我确认后再读；任何建库与写入都必须在摘要预览及精确目标确认后。
```

改写参考与 MIT 许可见 [README](README.md#来源与许可)。
