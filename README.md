# 人生开图官网

https://kaitu.si/ ，由 GitHub Pages 直接发布本分支（`gh-pages`）根目录。纯 HTML / CSS / JS，不用构建，不引外部字体和 CDN。

## 文件

| 文件 | 内容 |
|---|---|
| `index.html`、`en/index.html` | 首页（中文、英文） |
| `docs/`、`en/docs/` | 文档 |
| `download/`、`en/download/` | 下载 |
| `privacy/`、`en/privacy/` | 资料去向，来自产品仓库 `docs/site/privacy.*.md` |
| `vision/`、`en/vision/` | 愿景与灵感来源（首页 `#inspiration` 链到这里） |
| `shots/` | 首页截图：`<页面>-<zh\|en>-<light\|dark>.webp` 为桌面图（2400 宽），`-m` 结尾为手机裁切；深色模式和手机宽度由 `<picture>` 自动选择 |
| `og-zh.png`、`og-en.png` | 分享卡片（1200×630） |
| `tokens.css` | 颜色、字体，和开图应用 `Prototype.module.css` 一致，含深色 |
| `style.css`、`app.js` | 全站样式与脚本（语言切换、首页标签、复制、文档目录、下载信息） |
| `404.html`、`sitemap.xml`、`robots.txt`、`favicon.svg` | 其他 |
| `plugins/index.json` | DSH 插件市场索引（开图插件列表） |
| `testsite/` | 浏览器体验站（由产品仓库构建后发布） |
| `CNAME` | 域名 `kaitu.si`，不要删 |

## 截图

首页截图来自真实的开图界面（`kaitu ui`），用虚构人物「小林」的合成资料，在 1440×900 窗口、2 倍像素下截取，中英文、浅色深色各一份。界面改版后重截同一组：今天、足迹、健康、方向、资料。不要放真实用户资料。

## 本地预览

```sh
python3 -m http.server 4894 --bind 127.0.0.1
```

打开 http://127.0.0.1:4894/ 。

## 发布

改完先在根目录运行 `python3 tools/stamp.py`（给 CSS / JS 链接加版本号，避免浏览器拿旧缓存），再提交并推送到 `gh-pages`，GitHub Pages 自动部署，一两分钟后生效。

## 发新版时

每个页面打开时读取 GitHub Releases 里最新带 `.dmg` 的版本，自动更新 Mac 版本号、下载链接、大小和 SHA-256；同一版本的 `rensheng-kaitu-*.tgz` 用于命令行。读不到时保留页面里的静态版本。Windows 使用 DSH 插件，官网不展示或自动填充 EXE 下载链接。

系统：Windows 访客看到「Windows 插件安装指引」，进入下载页的 DSH 安装步骤；Linux 访客同样进入插件指引；Mac 和没开 JS 的访客保留 macOS 下载入口。`#windows` 与 `#plugin` 均保留，旧链接可继续访问指引。中英文首页、下载页和 FAQ 保持一致。

语言：浏览器语言里没有中文的访客，第一次打开中文页会自动跳到对应的英文页；点过顶栏的语言切换后，就按选择的来。

## 文字从哪来

产品说明以产品仓库为准：`docs/PRODUCT.md`、`docs/desktop.md`、`docs/site/`（从应用界面移出来、准备放官网的说明）。功能变了先改那边，再同步到这里。

## 回退

```sh
git revert <提交>   # 撤掉某次改动
git push origin gh-pages
```
