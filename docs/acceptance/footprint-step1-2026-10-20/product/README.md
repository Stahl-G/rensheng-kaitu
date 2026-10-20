# 正常应用与实际 DSH 插件集成验收

本轮不使用独立 Map harness：以实际 CLI `ui` 入口启动服务，浏览器从「今天 → 开图 → 足迹」导航；另以实际 DSH 0.2.1-rc.2 Web 宿主加载已构建插件，经过 DSH 侧栏及插件自身导航进入足迹。未操作用户已有 tab、账号或个人资料，也未打开原生应用窗口或模拟器。

## 四项独立审查修复

| 问题 | 最小修复 | 真实链路证据 |
|---|---|---|
| 筛选让当前城市漂移 | 从未筛选已核实经历/档案先算锚点；显式未知锚点不允许从筛选子集补猜；保留档案/经历来源区别 | 去掉合成档案现居后选 2010 年，仍显示最新居住上海；仅计划层保留出发点及弧线。`sample-startup.json` 的 `year2010`、`plannedOnlyNow` 为 true，另有日期冲突回归单测 |
| 生产 CSP 拦地形 | connect-src 只添加 `https://s3.amazonaws.com`，没有新增通配 | 实际响应 CSP 与 HTTP 200 地形瓦片收据均在 `sample-startup.json`；CSP violation 为 0。故障提示区分 navigator 离线与在线但服务不可用 |
| 每 5 秒刷新拉回镜头 | 镜头依赖模式及定位目标的语义键；普通等价数据刷新只更新内容，不调用 camera；主题重载也不重置镜头 | DSH 可见页面产生连续 `/api/kaitu/lifeMap` 真实请求，间隔约 5 秒；拖动后位置在 3 个周期不变。Web 文件变化 → SSE → lifeMap 的真实请求数也增加，视野不变 |
| 城市列表盖住开关且无关闭入口 | 面板顶端增加可见的粘性关闭按钮，Escape 同样关闭面板并清除选择 | 在正常应用用真实鼠标事件打开与关闭；`listOpen`、`listClosed` 均为 true |

订阅证据：[dsh-subscription.json](dsh-subscription.json)、[DSH 实际拖动后画面](dsh-panned-after-polls.png)。DSH 请求来自真正的 `index.tsx` subscribe 定时器，不是测试自己重复调用 PaperMap。

## 真实界面与数据 I/O

- [浅色此刻](light-now.png) / [来路](light-history.png) / [可能](light-possible.png)
- [深色此刻](dark-now.png) / [来路](dark-history.png) / [可能](dark-possible.png)
- [仅计划层仍保留锚点](planned-only-with-anchor.png)、[列表已关闭](list-closed.png)
- [大样本来路](large-history.png)、[大样本可能](large-possible.png)

合成工作区由 core 正常初始化及校验，经历通过正常 records 写入 API 存成 JSONL，来源文件真实存在。小样本 31 条（6 居住 / 20 旅行 / 3 计划 / 2 建议），大样本 300 个不同城市 / 2000 条经历。页面通过正常 `/api/product/lifeMap` 读取，而非注入 props。实际 API 的记录数、城市数、当前城市与来源均在各 JSON 内。

## 首开与反馈数字

新浏览器 profile 无站点缓存，CLI 使用新进程；未清除操作系统文件缓存。`appReadyUpperMs` 从导航开始到正常首页就绪；地图数字从鼠标点「足迹」到截图采样观察到真实地理纹理，因此是含 DevTools 截图/检查开销的上界，不能与独立 harness 的 render 事件计时混用。

| 场景 | 首页观测上界 | 地图出现观测上界 | 首次 lifeMap HTTP | 再读 lifeMap HTTP |
|---|---:|---:|---:|---:|
| 小样本，新浏览器进程 + 新 CLI 进程 | 239.9 ms | 283.4 ms | 73.9 ms | 13.0 ms |
| 300 城 / 2000 条，新浏览器进程 + 新 CLI 进程 | 374.0 ms | 417.1 ms | 94.0 ms | 26.2 ms |

大样本响应解码正文 1,423,208 字节。正常 UI 的三态按钮反馈观测上界见 `large-startup.json`，最慢约 14.1 ms。此处按实际 API 和正常导航测量，不把静态组件数字当作集成数字。

CLI 进程从 spawn 到打印服务可用：小样本 **1769.2 ms**、大样本 **1732.7 ms**、空工作区 **1083.2 ms**，原始记录为 `server-*.json`。**这一冷服务启动超过 1 秒，未达一次性重活的一秒目标**；计时包括 CLI 模块导入、工作区初始化和监听，尚未独立归因，不虚称全是地图 I/O，也未用浏览器首帧代替它。大样本初次记录在补齐问问引擎构建前取得，随后按正常 CLI build 补齐引擎，并用小样本与空工作区完成完整问问动作；地图 API/组件未被替换。

## 无数据动作与离线

- 来路动作进入正常问问，并保留 build-life-map 草稿：[草稿画面](empty-history-action.png)。不发送给模型、不连接账号。
- 可能缺少出发点时先选择现居城市；此刻同样可直接搜城市。
- 真实输入「上海」并保存后，实际接口读回 geonameid 1796236；经历仍为 **0**，家乡仍为 missing，没有伪造时间或居住记录。见 `empty-startup.json`。
- 实际流程发现隐藏问问的异步 AI 配置 dialog 可能把足迹页面变成 inert；给问问传入活动状态，隐藏时关闭其模态层。`hidden-ask-modal.json` 用真实 askSettings 响应延迟复现，回到足迹后无隐藏 modal，列表鼠标仍可操作；没有 mock 响应体。
- 真正产品服务下阻断外部 HTTPS，并用浏览器网络状态覆盖模拟离线；localhost 保持可用，等同本机 app 在外网断开时的边界。重新从正常导航进入足迹，[城市提示](offline-city.png)与[全球画面](offline-global.png)均有效。
- 另外保持 navigator 在线但令提供方请求失败，显示[城市细节暂不可用](city-service-unavailable.png)，不误报离线。见 `offline-product.json`。

## 验证边界

本轮验证了真实 Web 应用、真实 DSH 插件宿主、数据接口/文件、订阅与鼠标交互；仍没有声称验证 Electron 原生窗口、系统菜单或安装包生命周期。原生前台没有被占用，个人浏览器 tab 未打开或修改。标记仍未选择，A 没有被视为批准。旧提交 CI 的两项 JSON 格式错误已修正；最新提交 CI 结果另以 GitHub exact-head checks 为准。
