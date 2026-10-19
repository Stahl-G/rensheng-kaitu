# 人生开图

**AI 是可以换的，人生进度不能丢。**

你的目标、在做的项目、健康和训练、去过的城市、正在考虑的方向，散落在各个 AI 的对话里，换一个 AI 就要重讲一遍。开图把它们收进你自己的一个文件夹，排成一张看得见的进度图：每个目标落到一个下一步，做完记一句结果，下次不管用哪个 AI，它读完这个文件夹就能接着聊。

资料是普通的 Markdown 和 JSON，放在你自己的电脑、云盘或私有 GitHub 仓库里。开图不上传你的内容，你随时能看、能改、能带走。

> 灵感来自邵艾伦 × 孙宇晨的访谈。本项目为独立开源项目，与二人及其公司无关联。

## 一键开始

把这句话交给你的 Agent（Claude Code、Codex、Cursor 等能操作文件和终端的都行）：

```text
帮我按 https://github.com/Stahl-G/rensheng-kaitu/blob/main/docs/guides/agent-memory/INSTALL.md 建立我的开图记忆，直接做完。
```

它会在你的 GitHub 下建私有仓库 `kaitu-ai-memory`，本机对应的文件夹就是你的开图文件夹（已有开图资料就用原来那份，没有就新建 `~/kaitu-ai-memory`）。接着它会问你最近在推进什么，自己读项目写出进度和下一步，上传前给你看一次。做完给你一段话，贴给另一台电脑或另一个 Agent 就能接上。详见 [开图私人共享记忆](docs/guides/agent-memory/README.md)。

不用 GitHub 也行：装下面的 App，第一次打开时选好存放位置（默认 `~/kaitu`）；以后想同步，在「设置 → GitHub 同步」连接或新建。命令行用户：`kaitu init ~/kaitu`。

## 下载

| 平台 | 状态 |
|---|---|
| [macOS（Apple 芯片）](https://kaitu.si/download/) | 候选版，可日常使用 |
| [Windows 10 / 11 x64](https://kaitu.si/download/#windows) | 候选版，已内置运行环境，见 [docs/windows.md](docs/windows.md) |
| iPhone | 内部 TestFlight 测试中，尚未公开 |
| [DeepSeek Harness 插件](docs/dsh.md) | `kaitu dsh --install`，在 DSH 里用今天、开图、资料三页 |

全部版本见 [GitHub Releases](https://github.com/Stahl-G/rensheng-kaitu/releases)。

## 打开 App 看到什么

| 页面 | 内容 |
|---|---|
| **今天** | 最重要的一件事，你带来的目标和它们的下一步（最多三条），要你确认的日程，最近的变化，随手记一句 |
| **开图** | 健康（本周训练、饮食、睡眠）、足迹地图（去过和住过的城市）、资讯、在探索的方向；地图下面是人生进度图 |
| **资料** | 项目、健康、财务、知识与决策、记忆和原文记录，各自的详情、导入和历史 |
| **问问** | 内置 AI 对话，读写你的开图资料；可以用自己的 API Key，也可以复用本机已登录的 Agent |

第一次打开约三分钟：说出想改变的一件事，或者把 ChatGPT 等 AI 的记忆搬进来，核对一个目标和一个下一步就能开始。看资料、记原文不需要 AI 和 Key。

## 怎么和你的 AI 接上

开图不绑定哪一个 AI。按你习惯的方式选：

- **任何 Agent 直接读文件夹**：根目录的 `AGENTS.md` 写着用户是谁、读哪些文件、怎么写回。Claude Code、Codex、Cursor 打开文件夹就能用。
- **MCP**：`kaitu mcp`，Claude Code 读工作区里的 `.mcp.json`，Codex 用 `codex mcp add kaitu -- kaitu mcp`。
- **问问复用本机 Agent**：已登录的 Claude Code、Codex、OpenCode、Kimi Code、CodeBuddy 通过 ACP 接进问问，不用另填 Key。
- **问问用 API Key**：DeepSeek（默认）、OpenAI、Claude、Gemini、Kimi、智谱等，模型列表从服务商实时获取。
- **在原来的 AI 里继续**：「AI 与连接」生成一份资料包（目标、最近结果、下一步、项目），复制给任何 chatbot，回答贴回来再核对。
- **电脑不在时**：云端 Agent 通过 GitHub 仓库或 Google Drive 往收件箱交东西，电脑回来后整理（见 [docs/cloud-relay.md](docs/cloud-relay.md)）。
- **手机消息**：Telegram、微信、飞书、QQ 私聊记一句，电脑上实时出现（见 [docs/phone-channels.md](docs/phone-channels.md)）。

谁写的都记来源。AI 提的下一步、目标和日程先标为待确认，由你采纳后才算数。

## 资料放在哪

```text
~/kaitu/
├── AGENTS.md          给 Agent 的入口说明
├── NOW.md             今天的计划
├── me/                档案、目标、作息规则
├── projects/<项目>/   STATUS.md（做到哪、下一步）、log.md、notes.md
├── health/            训练、饮食、睡眠、指标
├── explore/           足迹与方向
├── memory/            偏好、事实、决定，每条一个文件
├── reviews/           日报、周报、月报
└── inbox/             手机、云端 Agent 和导入文件的收件箱
```

- 推荐放在这台电脑，再连一个私有 GitHub 仓库双向同步。也可以选 iCloud、Google Drive、坚果云或任意同步文件夹，但磁盘紧张时系统会把云盘文件清成「仅在线」，网络不好时可能读不到。
- 云盘只放资料；版本历史、密钥和索引留在这台电脑。每次写入都存一个版本，可以查看和恢复。
- 可以导入 Apple 健康、日历（ICS）、ChatGPT 记忆、Nut AI、飞书云文档、支付宝账单和券商持仓 CSV。

## 现在的状态

开图还在首批试用前的打磨期，版本号是 `0.1.0-rc`。

- 本地文件夹、App 四个页面、问问、GitHub 同步、云端接力、手机消息通道已经可用，并在合成数据上验收过。
- iPhone App 在内部测试；坚果云、飞书和 QQ 通道还缺真机实测。
- 当前目标与里程碑见 [docs/GOAL.md](docs/GOAL.md)，产品定义见 [docs/PRODUCT.md](docs/PRODUCT.md)。

## 开发

需要 Node 22.19+ 与 pnpm。

```bash
pnpm install
pnpm build
pnpm test
node packages/cli/dist/main.js init /tmp/kaitu-demo --sample   # 带示例数据的工作区
node packages/cli/dist/main.js ui --dir /tmp/kaitu-demo         # 在浏览器里打开工作台
```

| 包 | 作用 |
|---|---|
| `packages/core` | 数据格式、校验、记录、版本、同步，所有入口共用 |
| `packages/cli` | `kaitu` 命令、本地工作台、MCP |
| `packages/dsh-plugin` | App 和 DSH 插件的界面与工具 |
| `packages/desktop` | macOS / Windows 桌面打包 |
| `packages/channels` | 手机消息通道 |
| `packages/web` | 浏览器版工作台 |

- 给进入仓库的 Agent：先读 [AGENTS.md](AGENTS.md)
- 产品定义：[docs/PRODUCT.md](docs/PRODUCT.md) · 数据规范：[docs/PRD.md](docs/PRD.md) §6 · 开发交接：[docs/HANDOFF.md](docs/HANDOFF.md)
- 合成导入样例：[Apple Health](examples/apple-health/export.xml)、[日历](examples/calendar.ics)、[ChatGPT 记忆](examples/chatgpt-memory.md)、[Nut AI](examples/nut-ai-backup.json)

## 开源致谢

人生开图基于 DeepSeek Harness、Electron、React、MapLibre、FullCalendar 等开源项目构建。
完整的 [项目、用途与许可证清单](docs/open-source.md)，以及 [第三方许可和代码移植说明](THIRD_PARTY_NOTICES.md)，在仓库中持续保留。

## 许可证

[MIT](LICENSE)。npm 包名规划为 `rensheng-kaitu`（命令行仍为 `kaitu`）。
