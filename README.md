# 人生开图官网

https://kaitu.si/ ，由 GitHub Pages 直接发布本分支（`gh-pages`）根目录。纯 HTML / CSS / JS，不用构建，不引外部字体和 CDN。

## 文件

| 文件 | 内容 |
|---|---|
| `index.html`、`en/index.html` | 首页（中文、英文） |
| `docs/`、`en/docs/` | 文档 |
| `download/`、`en/download/` | 下载 |
| `privacy/`、`en/privacy/` | 资料去向，来自产品仓库 `docs/site/privacy.*.md` |
| `mock/persona.js` | 首页可点击示例的全部资料和界面文字（虚构人物「小林」，中英两份） |
| `mock/mock.js`、`mock/mock.css` | 示例界面的交互和样式 |
| `tokens.css` | 颜色、字体等，和开图应用一致，含深色 |
| `style.css`、`app.js` | 全站样式与脚本（动效、语言切换、下载信息） |
| `404.html`、`sitemap.xml`、`robots.txt`、`favicon.svg` | 其他 |
| `plugins/index.json` | DSH 插件市场索引（开图插件列表） |
| `CNAME` | 域名 `kaitu.si`，不要删 |

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
