# 提交前检查

## Gmail OAuth 采集：211b8c3

- `pnpm build`：通过，五个 workspace 包完成构建。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test --maxWorkers=1`：58 个测试文件、158 项全部通过，299.07 秒。
- 默认四 worker 的前一轮：156 项通过，既有 onboarding 两项各触及 15 秒超时；串行重跑全量后通过，未修改超时或断言。
- 新增行为测试仅两个，均为 Gmail 本机假服务器测试，没有文案匹配或快照。

## 邮件与聊天界面、原型

- `pnpm build`：通过。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test --maxWorkers=2`：58 个测试文件、158 项全部通过，140.82 秒。
- 原型脚本 `node --check`：通过；浏览器打开四个渠道对话框，pageerror 为 0。
- 本地工作台浏览器结果：`browser-results.json`、`source-and-state-results.json`；已逐张检查截图。

构建保留已有 web bundle 体积提示，无新增依赖。没有把构建或假服务器结果当作真实 Google/Slack/飞书登录与实收证明。
