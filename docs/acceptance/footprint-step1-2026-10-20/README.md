# 足迹第 1 步：合成验收

状态：草稿交审，未合并、未发布。三种标记仍待用户选择，应用保留中性圆点；A 仅为推荐。

## 分支与范围

- 从 `origin/main e2d9cd83a176bf2fc6b35bc1dabe7f92f32bc9d6` 创建 `codex/footprint-paper-step1`。
- PR #46 已在 `2026-10-19T08:56:15Z` 合并。没有合入旧工作分支，只复制任务文件。
- 任务原文固定 `c0d0cfc6ecd3dca9d4eeb7ad7f9e07e74666dd2b`，文件 SHA-256 `91ae390d141ef232c99d88854cb40c46e6db8feed6d9a191032081af3ee87ef3`。
- 未修改经历 schema、手机快照、iOS MapKit、官网部署。iOS 现有 MapKit 已只读核对。

## 可核对的实现

同一个 MapLibre 实例承担此刻、来路、可能。此刻优先明确档案现居城市，再回退最近有时间依据且不冲突的真实 lived；城市选择沿用既有选择器，现居文字与家乡独立保存。不使用实时位置。

来路仅用 observed/user_reported lived，有开始时间才连接；重叠区间和同年/月无法确认先后时不连。inferred 不进入地图。计划虚线、建议点线。球面插值选择跨日界线短弧，对跖点不猜方向。大圆弧也纳入镜头范围。

原有导入、来源、修正、隐藏恢复、城市列表、年份/区间筛选和人生进度图保留；二级地图工具可叠加全部城市，包含旅行。三态默认保持各自简洁内容。

浅深 Natural Earth II 50m 先转 Web Mercator，再生成 0–5 级各 1,365 个 JPEG 瓦片。两套合计 2,730 张，打包 JSON **12,078,058 字节**，低于 15 MB。内置协议按可见瓦片解码；单文件客户端仍包含整个编码字典，尚未做字节级分包。

OpenFreeMap 水面、水系、地表与边界，以及 AWS Terrarium 地形，仅在 zoom ≥ 6 时请求。道路和地名标注关闭。断网仍保留本地全球底图。来源署名、地形各提供方与联网资料去向已补入地图和文档。官方许可核对见 [open-source](../../open-source.md#足迹纸本地图2026-10-20)。

## 真实浏览器证据

使用 Mac 上独立临时 profile 的 **headless Chrome / WebGL2**，1440 × 1000，设备像素比 1。没有访问现有用户 tab、个人工作区或账号；没有使用模拟器或占用 iOS 归档的前台对话框。

浏览器运行真实 `PaperMap` React 组件、真实 MapLibre、应用同一份主题样式和 worker。仅合成数据与测试插桩不同。**这是地图组件验收，不冒充完整 App 冷启动、完整本机工作区 I/O 或原生桌面回归。**

- [浅色此刻](light-now.png)、[来路](light-history.png)、[可能](light-possible.png)
- [深色此刻](dark-now.png)、[来路](dark-history.png)、[可能](dark-possible.png)
- [离线城市提示](offline-city.png)、[离线全球](offline-global.png)
- [300城市/2000经历](large-now.png)、[无数据动作](empty-possible.png)

离线通过专用浏览器阻断所有 HTTPS 请求模拟；localhost 代表仍能运行的本机应用，不切换系统网络。城市显示“需要联网才能看城市细节”，全球本地 source.loaded() 为 true。减弱动态效果时切换后 isMoving() 为 false。没有 JavaScript exception。

## 性能原始数字

首次独立浏览器运行的本地瓦片首帧：**761.8 ms**。最终复跑：小样本 **258.8 ms**，300城/2000经历 **160.4 ms**。首帧计时从 navigationStart 到真实 render 事件且本地 source 已加载，不等待外部城市服务器。后两项受浏览器/字体/系统缓存预热影响，不能与首次运行视作相同冷态。

| 数据 | 最慢启动镜头 | 最慢下一帧反馈 | 帧间隔 P95 | 最长帧间隔 |
|---|---:|---:|---:|---:|
| 6居住 / 20旅行 / 3计划 / 2建议 | 1.5 ms | 8.0 ms | 16.8 ms | 16.8 ms |
| 300城市 / 2000经历 | 2.8 ms | 16.0 ms | 16.8 ms | 33.4 ms |

原始结果见 [browser-results.json](browser-results.json)，首次独立运行见 [initial.json](initial.json)。切换动画约 1.2 秒；点已选标签不会启动新的镜头，未将其计为“启动镜头”。

**未达及限制**：一次较早的冷路径来路切换观察到 133.3 ms 长帧（该次 P95 为 16.7 ms）；原因未单独隔离，可能涉及首次瓦片/GL 路径，不能以复跑平滑证明所有冷态都无卡顿。尚未测完整 App 初开地图与原生窗口交互，不宣称这两项通过。官网隐私文字仅修改源文件，未部署。

## 检查与复现

- core 与 CLI 类型检查、桌面插件完整构建通过。
- 22 个改动代码/样式/脚本文件的 Biome 检查通过；生成的瓦片字典与既有城市字典一样排除格式化。
- 针对真实日期、重叠居住、跨日界线、现居/家乡独立及已有足迹来源的 4 个测试文件、7 项用例通过。
- `node scripts/footprint-fixture.mjs` 生成 `dist/footprint-acceptance`；用 localhost 静态服务打开。
- `scripts/footprint-browser-check.mjs` 只连接专用临时 profile 的 9337 端口；截图和性能来自真实 WebGL 页面。运行前须先启动隔离的 headless Chrome 和 8873 静态服务，不连接日常浏览器 profile。
- 原始 Natural Earth TIFF 不入仓库。可用 `scripts/prepare-paper-map.py` 与官方输入重建瓦片；Pillow 依赖仅用于资产处理，不是应用运行时依赖。
