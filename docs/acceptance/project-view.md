# Agent 自定义项目视图

- `projects/<slug>/view.json` 支持七种积木或隔离 HTML；项目详情保留无文件和整份解析失败时的默认视图。
- MCP 与内置对话均提供 `project_view_write`；入口用 schema 校验，文件读取跳过错误积木，渲染不重复校验。
- 打开详情时读一次 view.json，不缓存；视图写入不触发现状重建。
- 合成工作区包含 502 个项目：首次详情读取 22.3 ms，后续 20 次平均 5.2 ms，视图写入 2.8 ms。
- 示例初始化与读写已运行，新增一个测试验证错误积木被跳过、其余积木保留。
- 浏览器连接超时，尚未完成原生 App、明暗主题和 375 px 的视觉验收；未修改真实工作区或安装目录。

## 最终检查

执行 `pnpm build && pnpm typecheck && pnpm lint && pnpm test`：前三项退出码 0，test 退出码 1。
全量 180 项中 179 项通过；新增视图测试通过。
失败位于 `packages/desktop/test/providers.test.ts:129`：凭据 helper 输出传入 `JSON.parse(logs)` 后出现语法错误。
未修改桌面凭据实现或该测试，未提交 git。

## 文件

- 格式与读取：`schemas/project-view.schema.json`、`packages/core/src/project-view.ts`、`project-page.ts`、`index.ts`。
- 写入与 Agent：`packages/cli/src/mcp/server.ts`、`packages/dsh-plugin/src/workflow-tools.ts`、`skills.ts`、`packages/core/src/agents-md.ts`、`templates/kaitu/.agents/skills/project/SKILL.md`。
- 页面：`packages/dsh-plugin/src/client/ProjectsPage.tsx`、`DoingPage.module.css`、`packages/dsh-plugin/src/types.ts`。
- 示例与检查：`packages/core/src/sample.ts`、`workspace.ts`、`packages/core/test/project-view.test.ts`、本说明。
