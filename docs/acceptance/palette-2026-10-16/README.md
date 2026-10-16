# 品牌配色验收 · 2026-10-16

基于 `origin/main 8508845`，完成三折地图标志、品牌深青与各板块自然色配色。
新增引导组件使用共享颜色变量，未发现写死的旧紫色或亮蓝色。
地图连线与标记使用板块色，切换主题时重建地图样式，避免沿用浅色标记。

验证使用本分支构建后的 `kaitu ui` 与 Playwright 无头 Chromium，没有操控桌面。
工作区位于 `/tmp/kaitu-palette-final-ztkW6n/`：`sample` 为合成示例，`new` 为空工作区。
HOME、应用目录与状态目录均指向该临时目录，服务端口分别为 4898、4899。
地图使用北京、东京、胡志明市三条合成经历，来源为临时工作区内的 `handoffs/palette-demo.md`。

| 截图 | 内容与尺寸 |
|---|---|
| `light-welcome.png`、`dark-welcome.png` | 欢迎页，1120 × 800 |
| `light-onboarding.png`、`dark-onboarding.png` | 新引导页，1120 × 800 |
| `light-onboarding-320.png`、`dark-onboarding-320.png` | 新引导最窄视口，320 × 800 |
| `light-320.png`、`dark-320.png` | 今天页最窄视口，320 × 800 |
| `light-library.png`、`dark-library.png` | 新资料网格与板块色，1120 × 800 |
| `light-map.png`、`dark-map.png` | 底图、标记与经历连线加载完成，1120 × 860 |
| `palette.png` | 83 个颜色变量的对照与示例卡片，1800 × 1000 |

色板页运行时计算文字与图形对比度，当前配对均达到文字 4.5:1、图形 3:1 的阈值。
将链接新色改为白色后，色板即时显示 1.00:1 并标红；切换深色示例后卡片颜色同步改变。
今天页、资料页与新引导的 DOM 文字及占位文字也经浏览器计算检查：浅色最低 4.56:1，深色最低 4.91:1。
地图切换后的变量回读为浅色 `#0F4C5C` / 深色 `#6FB3B4`，对应截图已目视核对。
浏览器未发生页面 JavaScript 异常。

320px 下，引导页的长示例按钮仍沿用主线单行样式，存在横向溢出；本次保留布局。
四项检查通过：`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test --pool=threads --maxWorkers=1`，156 项测试通过。
未新增测试；参考目录 `.palette-ref/` 已删除。
