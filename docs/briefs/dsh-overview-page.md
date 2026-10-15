# 任务：dsh 侧栏「开图总览」页面（第一版只做这一页）

先读 `docs/HANDOFF.md` §0、`docs/dsh.md`、`packages/dsh-plugin/src`、`packages/core/src/status.ts`、`overview.ts`、`history.ts`、`projects.ts`。
DeepSeek Harness 0.2.0-rc.2 源码在 `/Users/yihongguo/Developer/deepseek-harness-rc2`（只读），必读：
`docs/subsystems/web-client.zh.md`、`client-modules.zh.md`、`slots.zh.md`、`docs/api-gateway.zh.md`、`docs/web-styling.zh.md`，
以及注册全局页面和侧栏入口的内置插件 `packages/client/ui-schedule`（看它的 `package.json` 中 `dsh.client` 声明、`src/client`，以及它的 Host 侧 Remote 如何提供数据）。
视觉与交互参考 `/Users/yihongguo/Developer/open-claude-ui`（`docs/README.md` 设计手册），只借鉴视觉风格和交互手感，不引入它的依赖。
不联网、不提交。

## 分两段做

**第 1 段：确认可行性，然后停下。** 写清楚以下几点，附源码路径作依据：
- 第三方插件如何提供 client bundle：需要的 `package.json` 字段、构建产物格式，React 等共享模块如何引用，能否用 dsh 发布到 npm 的包构建。
- 页面和侧栏入口要注入哪些服务，以及使用哪个 Slot。
- 页面数据怎么从 Host 传到页面（Remote method 的写法）。
- **需要哪些新 npm 依赖（包名 + 精确版本）。** 只要需要新依赖，就把清单写进 `/tmp/kaitu-dsh-deps.txt` 并结束本次任务，由 Claude 安装后再开第 2 段。
- 若 rc.2 不允许第三方插件注册页面，写清证据后结束。这是阶段 2 的否决项。

**第 2 段：实现**（依赖齐全时才做）
1. 新包 `packages/dsh-ui`，或在 `packages/dsh-plugin` 里加 client 入口，选更简单的那种。在 dsh 侧栏出现「开图」入口，点开是总览页。
2. Host 侧加一个 Remote method，返回总览数据，全部复用 core 现有函数，不另写读写逻辑：
   - **近期变化**：最近 10 个版本（时间、说明、来源：用户 / Agent / 云端），外加最新每日整理的日期和「未决事项」条数。
   - **今天与下一步**：`NOW.md` 的块（标出待确认建议），以及各模块 `next` 里未完成的前 5 条。
   - **进行中的项目**：`stage: active` 的项目，带近 7 天字数变化和提交数。
   - **指标**：近 7 天训练次数、日均睡眠、日均蛋白质、最新体重。每项标出统计区间和截止时间；估算值标「约」；没有数据时显示「暂无记录」，不显示 0。
   - **需要处理**：待整理笔记条数、待确认建议条数。
3. 视觉：冷白、墨黑、中性灰打底，少量蓝色只用于选中和主操作（参考色：背景 `#FAFAFC`、表面 `#FFFFFF`、次级区域 `#F2F3F5`、主文字 `#202124`、强调色 `#5260E8`）。优先用 dsh 的 `ui-primitives` 和样式约定，保证与 dsh 浑然一体；不用灰绿色，不用渐变，少用卡片边框。每个板块可以点开，查看对应来源（记录或文件路径）。
4. `kaitu dsh --install` 一并装上页面；`docs/dsh.md` 加一小节「总览页」。

## 测试
不写 UI 测试；只给总览数据的 Remote method 写一个测试（临时工作区，没有数据时不返回 0）。不断言文案。

## 完成标准
`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 全部通过。用中文汇报，三到五行：依据、做了什么、用户怎么看到、哪些只能真机验证。不写免责声明。只改当前 worktree，不碰 `~/.dsh`、`~/kaitu` 和 Google Drive。

## 第 2 段补充（2026-10-15，依赖已由 Claude 安装）

- 依赖已按 `/tmp/kaitu-dsh-deps.txt` 装进 `packages/dsh-plugin`。直接做第 2 段，可行性结论见 `docs/dsh-overview-feasibility.md`。
- **视觉以设计稿为准**：`docs/design/overview.dc.html`（有数据）和 `docs/design/overview-empty.dc.html`（新用户空状态）。按它们的布局、字号、间距、圆角和文案来做；稿里的数据只是示例，页面要读真实数据。
- **颜色用开图自己的一套，覆盖上文第 3 点里的参考色**：画布 `#FCFCFB`、浅底 `#F5F5F3`、控件底 `#F0EFEC`、卡片 `#FFFFFF` 加轻阴影、主文字 `#1F1E1D`、次要文字 `#4D4C48` / `#6B6A66`、主按钮墨黑 `#1F1E1D`、链接 `#2F5FC4`、强调点 `#3D6FE0`。不用描边分组，靠留白和底色区分。
- 在页面自己的 CSS Module 里用 `--kt-*` 变量定义这套颜色，并提供深色值：跟随 dsh 当前的明暗主题（找出 dsh 标记深色模式的属性，只在页面根节点下切换），不改 dsh 全局样式。
- 交互手感参考 `/Users/yihongguo/Developer/open-claude-ui`：行悬停时出现浅色圆角底，动效克制，尊重「减少动态效果」设置。只借风格，不引入它的依赖，也不用它的品牌色和字体。
