# 开图 CLI / Web

需要 Node.js 22.19+（22 系列）或 24+。CLI、网页、开图工具和 DSH Node 引擎一起安装，不需要 Kaitu.app 或 Electron。

本地安装候选包（尚未发布 npm）：

```sh
npm install -g ./rensheng-kaitu-0.1.0.tgz --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty
kaitu init ~/kaitu-web
kaitu --dir ~/kaitu-web ui
```

也可用 `pnpm add -g ./rensheng-kaitu-0.1.0.tgz` 安装，若提示原生依赖待批准，按 pnpm 提示批准上述三个包的构建脚本。
打开命令输出的本机地址，在“问问 → 连接 AI”配置模型。凭据由用户亲自填写。
安装时自动装好锁定版本的 DSH 引擎，运行问问时无需另装 DSH，也不会下载临时引擎或查找桌面 App。
AI 会在需要时启动，工作台只监听 127.0.0.1。

模型列表从所选服务的 API 获取，DeepSeek 也使用自己的 `/models` 接口。
填入 Key 后获取模型，或直接填写模型 ID；不预填固定型号，不限制只能使用旧名单中的模型。
列表接口不提供图片能力时，只补充 DSH 已知的同名模型能力，不把 SDK 内置目录当成可用模型列表。
接口依据：[DeepSeek](https://api-docs.deepseek.com/api/list-models/)、[Gemini](https://ai.google.dev/api/models)。
服务商目录读取 DSH 的已安装适配器；支持账号登录的服务可直接走其授权流程。
没有公开模型列表接口的账号通道使用 DSH 支持的型号，并明确标注来源，仍可手填模型 ID。
问问支持引用资料与其他对话、多个文件/图片附件以及粘贴和拖放；附件由 DSH 存在本机状态目录。

资料由 `--dir` 或 `KAITU_DIR` 指定。模型配置、凭据和会话在本机状态目录的 `web-ai/` 中，
macOS 默认为 `~/Library/Application Support/kaitu/web-ai/`，不写入资料工作区。
可用 `KAITU_LOCAL_STATE_DIR` 指定独立的本机状态目录。
默认对话只读写开图资料，可以搜索网页，执行命令须切换完整 Agent 并确认。

## 从源码打包

```sh
pnpm install
pnpm build
node scripts/package-web.mjs
cd dist/web-release
npm pack
```

产物包含网页、CLI、schema、模板、城市数据及开图和 DSH 的适配代码。
DSH 以固定版本的运行时依赖随安装包声明，安装时由包管理器一起安装，以匹配当前系统的原生组件。
打包与本地安装不等于已发布，公开发布仍需单独确认。
