# 开源项目与致谢

人生开图基于以下开源项目构建。感谢这些项目的作者和维护者。

核对日期：2026-10-17，代码基准：`fd20179`。

范围包括本仓库直接声明的依赖、移植代码、桌面运行环境、打包工具和地图数据来源。
相同仓库的多个 npm 包合并列出；版本以 [pnpm-lock.yaml](../pnpm-lock.yaml) 为准。
DSH 内核更深层的传递依赖见其上游和随包许可证。原始许可证、移植文件和修改说明见 [第三方声明](../THIRD_PARTY_NOTICES.md)。

## 内核与运行环境

| 项目 | 开图用于哪里 | 许可证 |
|---|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | AI 引擎、SDK、会话、工具、附件、模型目录及 DSH 插件宿主 | MIT |
| [Electron](https://github.com/electron/electron) | macOS App 的窗口、桌面运行环境 | MIT |
| [Node.js](https://github.com/nodejs/node) | CLI、Web 后端和桌面后台的 JavaScript 运行时 | MIT，自带组件另附许可 |
| [SQLite](https://github.com/sqlite/sqlite) | 通过 Node 内置 node:sqlite 保存对话全文检索索引 | Public Domain |

## 界面、日历与地图

| 项目 | 开图用于哪里 | 许可证 |
|---|---|---|
| [React / React DOM](https://github.com/react/react) | 当前开图 App、DSH 插件和独立 React 界面 | MIT |
| [FullCalendar](https://github.com/fullcalendar/fullcalendar) | 日、周、月、列表日历视图，使用 standard 模块 | MIT |
| [FullCalendar React](https://github.com/fullcalendar/fullcalendar-react) | 将日历嵌入 React 页面 | MIT |
| [react-easy-crop](https://github.com/ValentinH/react-easy-crop) | 选择头像后的图片裁剪 | MIT |
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) | 人生足迹地图的浏览器渲染和交互 | BSD-3-Clause |
| [OpenFreeMap](https://github.com/hyperknot/openfreemap) | 在线地图瓦片、Positron / dark 样式；详细许可见下文 | MIT；底图与样式分别署名 |
| [Preact](https://github.com/preactjs/preact) | packages/web 中的轻量工作台界面 | MIT |
| [Apache ECharts](https://github.com/apache/echarts) | 轻量工作台中的趋势与统计图表 | Apache-2.0 |
| [markdown-it](https://github.com/markdown-it/markdown-it) | 轻量工作台显示 Markdown 内容 | MIT |
| [clsx](https://github.com/lukeed/clsx) | 前端开发依赖声明中的类名组合工具 | MIT |

## 资料、导入、存储与 Agent 接口

| 项目 | 开图用于哪里 | 许可证 |
|---|---|---|
| [fflate](https://github.com/101arrowz/fflate) | ZIP 数据解压、导入与功能更新包解压 | MIT |
| [saxes](https://github.com/lddubeau/saxes) | Apple Health XML 解析 | ISC |
| [ical.js](https://github.com/kewisch/ical.js) | ICS 日历解析与订阅数据处理 | MPL-2.0 |
| [isomorphic-git](https://github.com/isomorphic-git/isomorphic-git) | 资料版本历史与撤销 | MIT |
| [Ajv](https://github.com/ajv-validator/ajv) | JSON Schema 数据校验 | MIT |
| [ajv-formats](https://github.com/ajv-validator/ajv-formats) | Ajv 的日期等格式校验 | MIT |
| [yaml](https://github.com/eemeli/yaml) | YAML 配置与文档 frontmatter 解析 | ISC |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | 让外部 Agent 通过 MCP 调用开图 | MIT |
| [Zod](https://github.com/colinhacks/zod) | 接口和工具参数的数据结构定义 | MIT |
| [vscode-ripgrep](https://github.com/microsoft/vscode-ripgrep) | 在安装包中提供 ripgrep 可执行程序 | MIT |
| [ripgrep](https://github.com/BurntSushi/ripgrep) | Agent 在开图资料里搜索文本 | MIT OR Unlicense |
| [read-excel-file](https://github.com/catamphetamine/read-excel-file) | 读取财务导入的 XLSX 表格；发布包主仓库指向 GitLab，链接为同作者 GitHub 仓库 | MIT |
| [xls-reader](https://github.com/zanlucathiago/xls-reader) | 读取旧格式 BIFF8 XLS 表格 | MIT |
| [yahoo-finance2](https://github.com/gadicc/yahoo-finance2) | 持仓参考价与汇率查询 | MIT |
| [node-semver](https://github.com/npm/node-semver) | 功能更新包的版本识别与比较 | ISC |

## 邮件、聊天与移植代码

| 项目 | 开图用于哪里 | 许可证 |
|---|---|---|
| [Slack Node SDK](https://github.com/slackapi/node-slack-sdk) | Slack 连接与消息读取 | MIT |
| [飞书 Node SDK](https://github.com/larksuite/node-sdk) | 飞书连接、事件与消息处理 | MIT |
| [QQ Bot Node SDK](https://github.com/tencent-connect/qqbot-nodejs) | QQ 机器人通道 | MIT |
| [grammY](https://github.com/grammyjs/grammY) | Telegram 机器人通道 | MIT |
| [ImapFlow](https://github.com/postalsys/imapflow) | 通过 IMAP 读取邮箱 | MIT |
| [mailparser](https://github.com/nodemailer/mailparser) | 解析邮件内容与附件结构 | MIT |
| [mailauth](https://github.com/postalsys/mailauth) | 邮件认证信息处理 | MIT |
| [OpenClaw](https://github.com/openclaw/openclaw) | IMAP / 飞书只读采集的部分代码适配；具体文件与改动见第三方声明 | MIT |
| [double-entry-generator](https://github.com/deb-sig/double-entry-generator) | 移植账单文件识别与解析规则，改为 TypeScript 和开图预览、确认流程 | Apache-2.0 |

## 开发、构建与桌面打包

| 项目 | 开图用于哪里 | 许可证 |
|---|---|---|
| [TypeScript](https://github.com/microsoft/TypeScript) | 项目开发语言与编译器 | Apache-2.0 |
| [Biome](https://github.com/biomejs/biome) | 代码格式与规范检查 | MIT OR Apache-2.0 |
| [Vitest](https://github.com/vitest-dev/vitest) | 行为测试 | MIT |
| [Vite](https://github.com/vitejs/vite) | 轻量工作台的前端构建 | MIT |
| [Preact Vite preset](https://github.com/preactjs/preset-vite) | Vite 中的 Preact 构建适配 | MIT |
| [esbuild](https://github.com/evanw/esbuild) | DSH 插件、CLI 引擎和桌面功能包打包 | MIT |
| [Lightning CSS](https://github.com/parcel-bundler/lightningcss) | CSS Modules 与样式编译 | MPL-2.0 |
| [sharp](https://github.com/lovell/sharp) | 从 SVG 生成 PNG、macOS App 图标 | Apache-2.0 |
| [Electron ASAR](https://github.com/electron/asar) | 读取和重写桌面 App 的 ASAR 资源包 | MIT |
| [Electron macOS Sign](https://github.com/electron/osx-sign) | macOS App 代码签名 | BSD-2-Clause |
| [electron-builder / app-builder-lib](https://github.com/electron-userland/electron-builder) | 桌面打包脚本使用其 ASAR、签名工具依赖 | MIT |
| [pnpm](https://github.com/pnpm/pnpm) | 工作区依赖安装、锁文件与构建命令 | MIT |
| [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) | Node、React、React DOM、mailparser、markdown-it 的 TypeScript 类型 | MIT（本项目使用的类型包） |

## 数据与额外来源

| 来源 | 开图用于哪里 | 许可证与署名 |
|---|---|---|
| [GeoNames](https://www.geonames.org/) | 内置 cities15000 精简城市表、城市搜索与坐标 | CC BY 4.0，来源字段保存在 `packages/core/data/cities.json` |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | OpenFreeMap 底图的数据来源 | ODbL-1.0；地图保留 © OpenStreetMap 署名 |
| [OpenFreeMap 样式、字体及底图许可](https://github.com/hyperknot/openfreemap/blob/main/LICENSE.md) | 地图服务提供的派生样式、字体、图标与地图数据 | 依来源分别使用 MIT、BSD-3-Clause、CC BY、OFL、CC0 或 Public Domain，详见上游许可 |
| [腾讯微信 openclaw-weixin](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin) | 从 2.4.10 抽取微信文本通道 | MIT；保留 [原始许可证](../packages/channels/src/weixin/LICENSE) 和 [移植说明](../packages/channels/src/weixin/README.md) |

微信 npm 包未提供 repository 字段，因此保留发布来源链接。GeoNames、OpenStreetMap 按数据来源署名。

## 在源码里查找

- 直接依赖：根目录和 `packages/*/package.json`。
- UI：`packages/dsh-plugin/src/client/`、`packages/web/src/`。
- 资料与导入：`packages/core/src/`；外部 Agent 接口：`packages/cli/src/`。
- 邮件与聊天：`packages/channels/src/`；微信移植代码：`packages/channels/src/weixin/`。
- 桌面打包：`packages/desktop/package-kaitu.mjs`；插件构建：`packages/dsh-plugin/scripts/`。


## 足迹纸本地图（2026-10-20）

- [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) explicitly place the raster and vector datasets in the public domain, including commercial use and modification. We use the official [Natural Earth II 50m shaded relief](https://naciscdn.org/naturalearth/50m/raster/NE2_50M_SR_W.zip), recoloured and reprojected from geographic coordinates to Web Mercator with Pillow. The uncompressed input TIFF SHA-256 is `02ae944d9ee8a64ccacbd4f535220aac10b5c95e874118b6db8d6f07cea48e71`. The two local JPEG tile pyramids (zoom 0–5, 2,730 tiles) occupy 12,078,058 bytes as their bundled JSON (under 15 MB). Natural Earth credit remains visible on the map.
- [OpenFreeMap](https://openfreemap.org/) permits commercial use. Its MIT software licence is separate from the ODbL map data and the licences of its styles. We preserve the vector source attribution (OpenMapTiles and OpenStreetMap) supplied by its TileJSON. Only water, waterways, landcover and borders are used at zoom 6–12; roads and labels remain off. The style is requested only on reaching city zoom, without keys or account information. No bulk tile download or satellite imagery is added.
- [AWS Terrain Tiles registry](https://registry.opendata.aws/terrain-tiles/) points to [Tilezen/Joerd attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md), which contains multiple provider licences, not one public-domain licence. The map links to the complete provider credits. Terrain data providers include ArcticDEM (NSF awards 1043681, 1559691, 1542736), Commonwealth of Australia / Geoscience Australia (2017), offene Daten Österreichs, Canada (Open Government Licence), Copernicus / European Union EU-DEM, NOAA ETOPO1, INEGI (Continental relief 2016), LINZ and the New Zealand Government (Crown copyright 2011), Kartverket, Environment Agency (copyright/database right 2015), and USGS (3DEP, GMTED2010, SRTM). Provider-specific conditions remain in the linked upstream attribution. The Terrarium source is fetched only for visible terrain at zoom 6–12.
- Great-circle geometry is implemented with spherical interpolation in the repository; no new runtime geometry dependency is introduced. Antipodal and coincident positions do not get an arbitrary arc. The marker options are original repository SVGs derived from the existing Kaitu folded-map logo.
- Local tiles use the `kaitu-paper` protocol, so they work in both desktop hosts without a hosted file path. JPEG decoding is limited to visible tiles. The current single-file client build includes the encoded tile dictionary in its bundle; byte-level chunking and first-render performance still require browser measurement.

The application and website source privacy notices describe the local global view and the requested city areas sent to OpenFreeMap / AWS. Website publication is outside this task; these source changes do not deploy kaitu.si.
