# 开图 iPhone 设计稿（含 v0.7 的 Mac 设置）

更新：2026-10-18。产品规范见 [product.md](../../mobile/product.md)，v0.7 见 [agent-runner.md](../../mobile/agent-runner.md)。
在线画布（可点、可切换状态）：https://claude.ai/artifact/QsZ4Rvn6jU16QfjRcoBvEX （只有仓库主人能打开）。本目录是同一份源文件。

每个 `.dc.html` 是一块画板：普通 HTML 加内联样式，直接读源码就能拿到布局、尺寸、颜色和文案。
`{{名字}}` 和 `<sc-if>` 是画布的交互占位，取值写在文件末尾 `renderVals()` 里；`support.js` 是画布自带的运行时，不在仓库里，用浏览器直接打开会同时看到所有分支。
`canvas.json` 是画布上的摆放位置和标题。

## 画板

| 文件 | 尺寸 | 内容 | 对应规范 |
|---|---|---|---|
| `Main.dc.html` | 390×1240 | 今天：状态行、最重要的一件事、接下来、今天的安排（含待确认日程）、你带来的规划、这一周、记一下、标签栏。可切换 `sync`（正常 / 离线 / 需要核对）和 `source`（电脑 / Dot） | product §4.1 |
| `Map.dc.html` | 390×1520 | 窄屏开图：地图、城市、接下来往哪走、这一周 | product §4.1 |
| `Capture.dc.html` | 390×844 | 记一下：文字、标到、拍照、按住说话 | product §4.3 |
| `Status.dc.html` | 390×844 | 同步状态：需要核对、在路上、今天已更新 | product §4.6、§5 |
| `Empty.dc.html` | 390×844 | 还没有电脑内容（v0.6） | product §4.6 |
| `WideMap.dc.html` | 1180×820 | 展开后的首屏：沉浸式开图 | product §4.2 |
| `Wide.dc.html` | 1180×820 | 展开后的次级页：全部信息 | product §4.2 |
| `Library.dc.html` | 390×844 | 资料（v0.7，只读）：搜索、分类、最近、项目 | product §4.4a |
| `Ask.dc.html` | 390×844 | 问问（v0.6.1）：回答附读过的资料，建议卡「放进待确认」 | product §4.5 |
| `Unfold.dc.html` | 1260×980 | 展开 / 合上过渡（可点，可切慢速）：地图卡片铺满、面板移到右侧、城市一排移到左下、记一下变成右上按钮、标签栏换成顶部胶囊 | review「外屏和内屏切换不连续」 |
| `EmptyAgent.dc.html` | 390×844 | v0.7 空状态：在电脑上打开开图 / 让我的 Agent 来更新 | I13 |
| `Source.dc.html` | 390×844 | v0.7 设置 › 更新来源：谁在更新、交给 Agent 的说明（拷贝） | I12 |
| `StatusAgent.dc.html` | 390×844 | v0.7 同步状态：今天、这一周、开图各自由谁何时更新；「等 Dot 处理」与「等电脑处理」 | I10、I11、I14 |
| `Photos.dc.html` | 390×844 | v0.7 从照片找城市：开图页入口 → 正在看照片 → 找到的城市（点卡片切换） | tasks/PHOTOS.md |
| `Mac.dc.html` | 1180×820 | v0.7 Mac：我的 › AI 与连接 › 云端整理员（整理员、交给 Agent 的说明、手机由谁更新、电脑不在时） | agent-runner §8 M1–M4 |

## 验收记录

- [2026-10-18：0.7.0 (6) 今天页、开图页；第二轮含展开和内外屏切换](review-2026-10-18.md)

## 颜色与字号

与桌面一致（`packages/dsh-plugin/src/client/Prototype.module.css`）：

- 背景 `#F5F5F3`，卡片 `#FFFFFF`，描边 `#E6E4DD`，控件底 `#F0EFEC`。
- 文字 `#1F1E1D`，次要 `#4D4C48`，弱 `#6B6A66`；主按钮 `#1F1E1D`。
- 强调（藏青）`#1B3254`，链接 `#2B4C7E`，浅底 `#EEF2F7`、描边 `#D3DEEC`；健康绿 `#3E8A5A`。
- 地图：陆地 `#EEF1EC`，网格 `#DDE2DA`，海 `#F4F6F7`；走过的路线实线 `#1B3254`，计划虚线 `#2B4C7E`。
- 字号沿用 iOS：大标题 34，标题 22，正文 17，次要 15，说明 13；圆角卡片 18–24，控件高度不低于 44。
- 标志见 `../kaitu-mark.svg`。

SwiftUI 实现时用系统字体和动态字体，颜色做成资源目录里的命名颜色并配深色模式；画板只给浅色。
