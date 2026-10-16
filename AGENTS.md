# 开发约定（给进入本仓库的 Agent）

1. 先读 [`docs/GOAL.md`](docs/GOAL.md) 和 [`docs/PRODUCT.md`](docs/PRODUCT.md)（唯一当前产品定义），再读 [`docs/HANDOFF.md`](docs/HANDOFF.md)。
   旧 PRD 保留能力和数据规范，不再决定导航。独立 Kaitu.app 默认有总览、开图、记录、问问四个入口；DSH 插件保持三个入口。
2. PRD §6 的数据规范是项目核心；改动它之前先和用户确认，并同步更新 `schemas/` 与 `AGENTS.md` 生成模板。
3. 需要核对访谈原话时，查 [`docs/reference/interview-transcript.md`](docs/reference/interview-transcript.md)（先读文件开头的注意事项）。
4. 开发约定见 HANDOFF §8；未核实的外部事实见 HANDOFF §6，依赖前先确认。
