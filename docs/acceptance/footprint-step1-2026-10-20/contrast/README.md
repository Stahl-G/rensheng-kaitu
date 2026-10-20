# 浅色纸本轨迹对比修正

只给浅色主题的白色路线和空心城市点增加深蓝灰底线（#344b56、75% 强度）；白色路线仍为 1.5px，底线为 3px，即两侧各增加 0.75px。空心点同样保留白色圆环与透明中心。深色主题底线透明，不更换中性“我”标记。

虚线/点线的底线按线宽反比缩放 dash 单位，间隔与原白线对齐；没有连续底线把计划/建议画成实线。联网的城市细节仍插在全部足迹层下方，不遮住底线。路线数据、过滤和镜头逻辑未改。

正常 CLI 应用使用同一个合成工作区（6 居住、20 旅行、3 计划、2 建议，共 31 条），从“今天 → 开图 → 足迹”进入，1440×1100 视口，reduced motion 打开以固定终态。`scripts/footprint-contrast-check.mjs before/after` 可复现。`before.json`、`after.json` 的经历数组完全相同，四个视角的中性标记像素坐标完全相同，浏览器异常均为 0。两张深色截图逐像素完全一致。

| 画面 | 修前 | 修后 |
|---|---|---|
| 浅色来路 | [before](before-light-history.png) | [after](after-light-history.png) |
| 浅色可能 | [before](before-light-possible.png) | [after](after-light-possible.png) |
| 深色来路 | [before](before-dark-history.png) | [after](after-dark-history.png) |
| 深色可能 | [before](before-dark-possible.png) | [after](after-dark-possible.png) |

已查看浅色修后实际像素：陆地上的白线/空心点可辨，海面白线和虚实线语义保留。完整插件构建、客户端类型检查、完整 lint 和足迹状态/现居/证据相关测试通过。测试继续只使用合成资料、独立临时浏览器；Electron 原生窗口仍未验。此前 CLI 整体冷启动约 1.73 秒的差距不因本次绘制修正而消除。
