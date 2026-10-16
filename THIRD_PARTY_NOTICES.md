# 第三方依赖

| 名称 | 许可证 | 仓库 |
|---|---|---|
| fflate | MIT | https://github.com/101arrowz/fflate |
| saxes | ISC | https://github.com/lddubeau/saxes |
| ical.js | MPL-2.0 | https://github.com/kewisch/ical.js |
| isomorphic-git | MIT | https://github.com/isomorphic-git/isomorphic-git |
| ajv | MIT | https://github.com/ajv-validator/ajv |
| yaml | ISC | https://github.com/eemeli/yaml |
| Preact | MIT | https://github.com/preactjs/preact |
| ECharts | Apache-2.0 | https://github.com/apache/echarts |
| markdown-it | MIT | https://github.com/markdown-it/markdown-it |
| Vite（仅构建） | MIT | https://github.com/vitejs/vite |
| @modelcontextprotocol/sdk | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| zod | MIT | https://github.com/colinhacks/zod |
| @slack/web-api | MIT | https://github.com/slackapi/node-slack-sdk |
| imapflow | MIT | https://github.com/postalsys/imapflow |
| mailauth | MIT | https://github.com/postalsys/mailauth |
| mailparser | MIT | https://github.com/nodemailer/mailparser |
| grammy | MIT | https://github.com/grammyjs/grammY |
| @larksuiteoapi/node-sdk | MIT | https://github.com/larksuite/node-sdk |
| @tencent-connect/qqbot-nodejs | MIT | https://github.com/tencent-connect/qqbot-nodejs |
| @tencent-weixin/openclaw-weixin 2.4.10（文本通道抽取） | MIT | [来源、改动与原始许可证](packages/channels/src/weixin/README.md) |
| GeoNames cities15000（城市表精简版） | CC BY 4.0 | https://download.geonames.org/export/dump/cities15000.zip （https://www.geonames.org/） |
| maplibre-gl 6.11.2（打进插件前端） | BSD-3-Clause | https://github.com/maplibre/maplibre-gl-js |

## OpenClaw IMAP / 飞书只读采集适配

来源：OpenClaw 2026.10.4 的 `extensions/imap/src/{config,sender-gate,state,watcher}.ts`。
飞书适配参考 `extensions/feishu/src/client.ts`（WSClient 建立与生命周期回调）与 `post.ts`（富文本结构与元素处理）。
移除了插件框架、提示词、Agent 会话派发与发送能力。

```text
MIT License

Copyright (c) 2026 OpenClaw Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```
