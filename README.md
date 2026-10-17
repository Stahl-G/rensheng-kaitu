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

改完提交并推送到 `gh-pages`，GitHub Pages 自动部署，一两分钟后生效。

## 发新版时

下载页会自动读取 GitHub Releases 里最新带 `.dmg` 的版本，一般不用改。
读取失败时显示页面里写死的版本：把 `download/index.html`、`en/download/index.html` 里的版本号、文件大小和 SHA-256 改成新的；首页和文档里的版本号也一起搜 `0.1.0-rc.3` 替换。

## 文字从哪来

产品说明以产品仓库为准：`docs/PRODUCT.md`、`docs/desktop.md`、`docs/site/`（从应用界面移出来、准备放官网的说明）。功能变了先改那边，再同步到这里。

## 回退

```sh
git revert <提交>   # 撤掉某次改动
git push origin gh-pages
```
