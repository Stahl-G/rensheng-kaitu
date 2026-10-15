# 任务：打包一个不签名的 Kaitu.app（macOS arm64，给作者自己用）

dsh 0.2.0-rc.2 源码在 `/Users/yihongguo/Developer/deepseek-harness-rc2`，依赖已装好，`pnpm build` 也已跑过。桌面端源码在 `apps/desktop`，必读：`README.zh.md`、`electron-builder.config.mjs`、`scripts/package-target.ts`、`scripts/desktop-package-environment.mjs`、`scripts/macos-package-settings.mjs`、`scripts/desktop-release-environment.mjs`、`scripts/desktop-auto-update-environment.mjs`、`.env.macos.example`，以及桌面端读取 profile 和 `DSH_HOME` 的位置（grep `DSH_HOME`、`profiles`、`userData`）。
开图的 dsh 插件在本仓库 `packages/dsh-plugin`，`kaitu dsh --install` 生成的 profile patch 段在 `packages/cli/src/dsh.ts`。品牌规范：`BRAND_GUIDELINES.zh.md`（衍生项目不能用「DeepSeek Harness」全名，用「DSH」）。不联网、不提交。

## 原则
- **不改 dsh 源码。** 所有定制都放在本仓库新目录 `packages/desktop/`，以构建参数、环境变量或打包后处理的方式实现。只有 `apps/desktop/.env.macos` 这一个文件允许写进 dsh 仓库（不签名、不公证、不上传、不开自动更新）。
- 能用 dsh 现有的 `package:mac:arm64:dir`（不签名的应用目录）就用它，不重写打包流程。

## 要做
1. **配置**：照 `.env.macos.example` 写出最少的 `.env.macos`：不签名、不公证，App ID 用 `ai.kaitu.app`，关掉自动更新。说明每一项为什么这样填。需要联网下载的步骤（内置 Python、Node 运行时、Electron）列成命令清单交给 Claude 运行，**你自己不要运行需要网络的命令**。
2. **后处理脚本** `packages/desktop/package-kaitu.mjs`：输入是 dsh 打出来的 `.app`，输出 `Kaitu.app`。要做的事：
   - 改 Info.plist：CFBundleName / CFBundleDisplayName 改为 Kaitu，CFBundleIdentifier 改为 `ai.kaitu.app`，版本号写成 `开图版本 + dsh 版本`；
   - 换应用图标：用 `docs/design/kaitu-mark.svg`，生成 `.icns`（深色圆角底配白色线条和浅蓝点，参照 `docs/design/logo.dc.html` 里的「应用图标（深色底）」），只用 macOS 自带的 `sips` / `iconutil` 和仓库里已有的工具；
   - 改原生菜单里的「DeepSeek Harness」字样（关于、隐藏、退出等）：先查菜单文案从哪里来（本地化资源还是代码），能在打包后的资源里替换就替换，做不到的写清楚依据；
   - 最后用 `codesign --force --deep -s -` 做 ad-hoc 签名，让应用能在本机打开。
3. **独立数据目录**：Kaitu.app 不能和用户已装的 DeepSeek Harness 共用 `~/.dsh` 和 Electron userData。查清 dsh 桌面端怎么决定这两个位置（环境变量、命令行参数还是 app 名字），选一种不改 dsh 源码的办法让 Kaitu.app 用 `~/.kaitu-app/`。如果必须靠环境变量，就在 `.app` 里加一个启动包装器。
4. **预装开图**：首次启动时，profile 里就要有开图插件（路径指向 `.app` 内置的一份 `packages/dsh-plugin` 构建产物，复制到 `Contents/Resources/kaitu/`）和品牌 patch 段（复用 `packages/cli/src/dsh.ts` 生成 patch 的逻辑，必要时导出一个函数供脚本调用），并且默认打开「开图」页面。工作区位置按用户现有的 `kaitu` 默认工作区来定（`current-workspace.json`），没有的话就用 `~/kaitu`。
5. 文档：`docs/desktop.md`，三段：怎么打包（Claude 跑哪些命令）、装好后怎么用、已知限制（不签名，别人的电脑打开会被系统拦截等）。

## 测试
不写测试。用 `--dry-run` 模式对一个假的 `.app` 目录跑一遍后处理，确认会改动哪些文件即可，在汇报里贴结果。

## 完成标准
本仓库 `pnpm build`、`pnpm lint` 通过。中文汇报五行以内：需要 Claude 运行的命令清单（按顺序）、每项做到没有、做不到的依据。不写免责声明。
