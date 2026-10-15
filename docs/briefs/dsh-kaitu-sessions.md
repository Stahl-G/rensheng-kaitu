# 任务：开图专属会话

用户反馈：在 dsh 里点「新会话」或「问问开图」时，会话开在上一次选中的工作区（例如 briefloop），工作目录不是开图文件夹，所以开图的技能和文件对这个会话不可见，对话也混在别的项目里。

dsh 0.2.0-rc.2 源码在 `/Users/yihongguo/Developer/deepseek-harness-rc2`（只读）。必读：`packages/api/session-controller`（新建会话的 Remote：怎么指定 cwd / 工作区）、`packages/api/workspace-controller` 与 `packages/client/ui-workspace`（工作区列表、新建会话入口、`ctx.workspaces`）、`packages/client/ui-layout`（切换主面板与会话）。开图插件在 `packages/dsh-plugin`，「问问开图」按钮目前只调用 `ctx.layout.selectPanel(null)`。不联网、不提交。

## 要做
1. **「问问开图」**：点击后在开图工作区（插件 config.workspace，即用户的 kaitu 文件夹）里新建会话并切过去；工作区还不在 dsh 列表里时先加进去。新会话的第一条可以预填一句提示，但不要自动发送。
2. **开图页面里的入口**：总览页「需要你处理」、空状态的「随口说一句」等需要去对话的地方，都走同一个函数，打开开图工作区的会话。
3. **品牌 patch**：如果 dsh 支持设置默认工作区或新会话默认 cwd，就在 `kaitu dsh --install` 的段落里设为开图工作区（只在 Kaitu.app 的 profile 里这么做；DSH 插件形态下保留用户原来的默认值），写清依据。
4. `docs/dsh.md` 补一句「开图会话」的说明。

## 测试
不写 UI 测试，最多 1 个测试。

## 完成标准
`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 全部通过。中文汇报三行以内。不写免责声明。
