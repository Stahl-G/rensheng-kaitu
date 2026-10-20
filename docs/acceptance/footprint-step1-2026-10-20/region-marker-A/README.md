# 第二轮区域此刻与已选 A 标记

用户最终选择 A 路线尾迹；不再等待候选选择，也不把 B/C 接入生产。旧候选图保留为历史，本轮不扩展分享卡或启动画面。

## 地图调整

- 此刻 zoom 从10改为8，正常上海画面能看到长江口、海岸和邻岛。
- 本地 Natural Earth raster-opacity 在 zoom5→7 从1→0；zoom7以上不放大低分辨率全球栅格。区域底色、OpenFreeMap水面和主要河流、Terrarium山影接替。山影在水面下方，海面不叠加地形明暗。
- 城市不添加道路、行政边界或地名符号层；河流只取 waterway/class=river，和水面同色，0.5–1.2px细线，没有描边。
- 中文名来自既有城市表缓存的ID索引，只返回本次经历与现居涉及的ID。没有新增网络地名查询或返回全城字典；原始档案和记录里的名字不被改写，未知ID保留原名。正常界面的两处 Shanghai 均显示上海。
- 左下说明随状态变化，浅深都有主题纸色底；此刻明确“现居记录，不是实时定位”。
- 署名默认收起为ⓘ。真实点击可展开 Natural Earth、OpenFreeMap/OpenStreetMap、Terrain完整署名和来源链接；没有删除署名内容。
- 来路fitBounds考虑左上卡片和底部状态条：正常窗口左/底额外80px，小窗口按可用宽高收缩。780×620的实际画面见 [small-history.png](small-history.png)。

离线此刻在zoom8不拿模糊全球栅格冒充城市细节：保留城市位置、主题底色和联网提示。缩小到全球范围仍可看内置底图；本轮没有声称离线城市矢量可用。

## 官方资产与最终标记

已实际获取 https://kaitu.si/ 官网SVG：末段是 `M30.67 29.5C34 28 36.5 22 39.5 16`，hm-ring为 `(39.5,16)` 上的圆，与路线共用终点。[原始hero SVG](../../../design/footprint-marker-options/official-hero-source.svg)保留原类名/曲线；抓取片段SHA256 `ebe19f6cc1107d4d04adc731b385ad704b0fa5ebe5719ecd3863cac104d4233c`。

生产复用末段曲线并围绕终点归一化，唯一HTML Marker中放一个SVG，文字不在旋转节点内。MapLibre独占外层定位transform；内部路径转向、状态缩放与柔光动画分别在子节点处理。静态复用资产为 docs/design/footprint-marker-options/marker-A.svg，运行时实现在 footprint-me-marker.ts；柔光由CSS独立添加。

真实浏览器测量（marker-browser.json）：

| 项目 | 此刻 | 来路/可能 |
|---|---:|---:|
| 实心头直径 | 8px | 6.800px |
| 外环含线宽直径 | 14px | 11.900px |
| 曲线长度 | 18.005px | 15.304px |
| 曲线线宽 | 2.000px | 1.700px |

放大两级，头/环/尾尺寸不变。浅色为rgb(43,76,126)，深色为纸白rgb(244,237,223)。尾迹渐变从尾端0到近头0.9，头尾同色。柔光底为24px/15%，仅此刻2.4秒呼吸，实际动画起止宽24→27.600px；reduced motion下动画为none。来路/可能图形整体0.85倍，文字仍保持清楚。

尾巴取完整事实资料的上一段已建立居住路线，不受展示筛选改变，也不读取下一计划目的地；日期冲突或没有上一站时固定左下。方向用当前城市向上一城市的回向方位角映射SVG原轴，再减地图bearing。实测地图bearing=-144°时路径补偿+144°，标签transform仍none。东西/南北相反方向、90°地图bearing和无上一站有针对性检查。

两套正常应用、各2条合成居住的实际方向检查见 direction-browser.json：上一站北京，尾端相对头部向量(-7.195,-16.220)；上一站新加坡，向量(-9.534,+14.965)。[北向图](direction-north.png)、[南向图](direction-south.png)。夹具复制此前已初始化的空合成工作区，排除生成的Git历史和Agent工具，使用Core正常记录写入并校验为[]；应用目录/本机状态都在独立/tmp内。

多次切态/浅深切换始终1个我标记、1个SVG、同一个gradient ID，没有重新创建标记。其他小空心点按含描边直径住过8px/去过6px绘制。

## 八张正常应用截图

使用同一合成6居住/20旅行/3计划/2建议工作区，从“今天→开图→足迹”正常进入，1440×1100，最终截图使用reduced motion固定终态。浏览器异常0；两主题都取得城市/地形联网200响应；断网时navigator.onLine=false且正确提示。

| 主题 | 此刻联网 | 此刻断网 | 来路 | 可能 |
|---|---|---|---|---|
| 浅色 | [图](light-now-online.png) | [图](light-now-offline.png) | [图](light-history.png) | [图](light-possible.png) |
| 深色 | [图](dark-now-online.png) | [图](dark-now-offline.png) | [图](dark-history.png) | [图](dark-possible.png) |

300城/2000经历复测：重复打开地图观测上界306.5ms，lifeMap HTTP72.1/25.8ms，三态反馈最慢23.8ms，CSP违规/异常0。此数字包括截图采样上界，不是整App冷启动；此前整体CLI约1.73秒未达项继续保留。原始数据在 ../product/region-A-large-startup.json。

本轮不改iOS、手机schema或真实资料，不使用实时定位，不部署。Electron原生窗口仍未验。目标相关检查通过，仓库必需检查及最终固定SHA的Windows CI结果另在PR记录；Windows未通过不得合并。PR54的Windows/写入路径修复不复制到本分支，组合验证使用隔离副本并明确其边界。
