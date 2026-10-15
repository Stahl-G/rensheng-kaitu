# 人生开图

照孙宇晨 × 邵艾伦访谈里的方法，把你的生活全部 AI 化。

孙宇晨说，他把吃饭、训练、睡眠、学习全部交给 AI 管：拍照记饮食、Oura 戒指读睡眠、AI 每天出日报。**开图**把这套做法做成了一个开源工具：所有数据放在你自己电脑上的一个文件夹里，任何 Agent 读了就知道你在做什么、下一步该做什么。

> 灵感来自邵艾伦 × 孙宇晨的访谈。本项目为独立开源项目，与二人及其公司无关联。

## 状态

阶段 1（本地工作区、工作台、健康同步、手机通道、DeepSeek Harness 插件）基本完成，正在做阶段 2 验证；当前目标与里程碑见 [docs/GOAL.md](docs/GOAL.md)。

## 开发

`kaitu ui [--port 4870] [--no-open] [--dir ~/kaitu]` 启动本地工作台；`kaitu init <目录> --sample` 创建演示数据。

合成导入样例：[Apple Health](examples/apple-health/export.xml)、[日历](examples/calendar.ics)、
[ChatGPT 记忆](examples/chatgpt-memory.md)、[Nut AI](examples/nut-ai-backup.json)。

需要 Node 22.19+ 与 pnpm。

```bash
pnpm install
pnpm build
pnpm test
node packages/cli/dist/main.js init /tmp/kaitu-demo
```

- 产品需求：[`docs/PRD.md`](docs/PRD.md)
- 开发交接：[`docs/HANDOFF.md`](docs/HANDOFF.md)
