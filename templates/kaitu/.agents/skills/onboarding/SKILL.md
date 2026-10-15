---
name: onboarding
description: 首次使用开图或用户说开始使用时，引导建立档案、导入资料并连接本地 Agent。
---

# 开始使用开图

## 步骤

1. 先运行 `kaitu status --json-out`，确认当前工作区是否已有资料。
2. 读取 `me/profile.md`、`me/rules.md` 和 `me/goals.json`，避免重问已知信息。
3. 用一次简短交流补充称呼、时区、当前重点与已有数据文件。
4. 把尚不明确的内容列为待补，不填想象的数据。
5. 用户有 ChatGPT 记忆时，转到 import-chatgpt-memory 技能。
6. 先给出档案草稿，按用户提供的事实写 `me/profile.md`。
7. 逐项提出规则与目标的修改建议，用户确认后再改对应文件。
8. 询问已有 Apple Health、Nut AI 或日历导出，转 health-import。
9. 没有导出文件也能开始，不要求部署服务。
10. 用 morning-plan 生成第一份今天计划，等用户确认建议。
11. 运行 `kaitu validate` 检查已写文件。
12. 运行 `kaitu snapshot -m "建立了个人档案与首份计划"`。
13. 运行 `kaitu ui`，让用户在工作台查看今天、健康和动态。
14. Claude Code 读取工作区 `.mcp.json`，其中已配置 `kaitu mcp`。
15. Codex 在工作区运行 `codex mcp add kaitu -- kaitu mcp` 注册本机 MCP。
16. 若工作区不在默认目录，运行前设置 `KAITU_DIR` 为工作区绝对路径。
17. 不要把 HTTP token 写入档案、技能或对话记录。

## 确认点

规则与目标变更先确认；资料批量导入先展示一屏候选。

## 交付

交代已建立的档案、待确认计划与尚未提供的数据源。
