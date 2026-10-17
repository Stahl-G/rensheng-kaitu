# 人生开图

**AI 是可以换的，人生进度不能丢。**

开图，把你分散的个人记录变成持续有用的行动。AI 了解你正在做什么，帮你看清选项、安排下一步，再根据实际结果调整。你保留资料、决定方向，也可以随时更换助手。

记录放在你自己的文件夹里（本机，或 Google Drive）。ChatGPT、Claude、Codex、Grok 等 Agent 读了就能接着做；电脑关机时，云端 Agent 也能通过 Drive 接力（见 [docs/cloud-relay.md](docs/cloud-relay.md)）。

> 灵感来自邵艾伦 × 孙宇晨的访谈。本项目为独立开源项目，与二人及其公司无关联。

## 状态

阶段 1（本地工作区、工作台、健康同步、手机通道、DeepSeek Harness 插件）基本完成；云端接力已实测通过，DeepSeek Harness 验证（阶段 2）暂停；当前目标与里程碑见 [docs/GOAL.md](docs/GOAL.md)。

## 开发

`kaitu ui [--port 4870] [--no-open] [--dir ~/kaitu]` 启动本地工作台；`kaitu init <目录> --sample` 创建演示数据。

合成导入样例：[Apple Health](examples/apple-health/export.xml)、[日历](examples/calendar.ics)、
[ChatGPT 记忆](examples/chatgpt-memory.md)、[Nut AI](examples/nut-ai-backup.json)。

健康收件箱支持 HRV(SDNN)，并支持 KaituSync samples 中的 11 类症状、七级心理状态和三类心率通知。
旧工作区先执行 `kaitu upgrade`；格式与范围见 [健康扩展规范](docs/proposals/kaitu-health-v2.md)。
通用 MCP `record_list` 可查询新记录；[四个健康专用工具](docs/proposals/mcp-health-tools.md)仍为提案。

需要 Node 22.19+ 与 pnpm。

```bash
pnpm install
pnpm build
pnpm test
node packages/cli/dist/main.js init /tmp/kaitu-demo
```

- 产品需求：[`docs/PRD.md`](docs/PRD.md)
- 开发交接：[`docs/HANDOFF.md`](docs/HANDOFF.md)

## 开源致谢

人生开图基于 DeepSeek Harness、Electron、React、MapLibre、FullCalendar 等开源项目构建。
完整的 [项目、用途与许可证清单](docs/open-source.md)，以及 [第三方许可和代码移植说明](THIRD_PARTY_NOTICES.md)，在仓库中持续保留。

## 许可证

[MIT](LICENSE)。npm 包名规划为 `rensheng-kaitu`（命令行仍为 `kaitu`）。
