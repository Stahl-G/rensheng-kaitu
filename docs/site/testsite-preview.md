# 浏览器合成示例预览

体验站从 `testsite/store.ts` 的小林资料投影到正式 TodayPage、MapPage / PaperMap、HealthPage、NewsPage、DirectionsPage、LibraryPage / InboxPage 与 HandoverPanel。默认打开有资料状态，也保留首次打开和建议待看场景。

```sh
pnpm --filter @kaitu/core build
pnpm --filter @kaitu/dsh-plugin build:testsite
python3 -m http.server 4894 --bind 127.0.0.1 --directory dist/site-preview
```

打开 `/testsite/?lang=zh-CN` 或 `?lang=en`。构建生成可复制的静态目录；本任务不部署、不修改 gh-pages。

- 小林的个人经历全部虚构。9 个城市包含居住、工作、求学、旅行与计划，四次旅行、一条短住计划；地名和坐标取自产品包内城市表。地图打包 Natural Earth GeoJSON 轮廓与同源 Worker，默认框住全部城市，放大不请求外部地图。
- 近三个月的合成训练、睡眠、体重与饮食共用原始记录；首页近七天、健康页自然周/月与近30天按各自窗口计算，均排除未来记录。步数与健康下一步来自同一合成资料；照片保持缺失。
- 八条2026年10月16日至23日资讯保留核验过的发布方原始链接与日期，附短摘要、与小林的关联和原创点评。未找到可核实的10月24/25日原始发布，未改日期填充“今天”；不伪装实时采集。X 原帖读取返回403，未完成核验，未收录帖文、作者或热度；缺口也可在资料页的来源文档回看。
- 两个在试方向各有尝试、既有记录和认识变化，另有一个待采纳建议。采纳、调整、资讯反馈和新增原文只保存在本标签页。资讯加入建议后可到今天页采纳。
- 资料包仅在此合成体验站默认选中非财务内容并直接预览；正式产品仍先询问财务范围，原有默认勾选规则保持。可删改、复制，贴回后确认保存原文；不解析为真实规划、不自动发送。

仅使用独立的 `sessionStorage` 键 `kaitu:testsite:v1`，不读取正式工作区、照片或密钥。旧标签页状态可继续读取；新会话默认载入小林示例。重置需确认，仅清除此键。存储失败不显示已保存。

CSP 保持 `connect-src 'none'`，仅允许本地地图所需的同源 Worker 和 blob 图片；没有 AI、后端、运行时资讯抓取、外部字体或埋点。静态 HTML / JS / CSS / Worker 的同源加载与运行时网络连接分开记录。用户主动打开新闻原文会进入外部网站，该页面不属于体验站运行期请求。
