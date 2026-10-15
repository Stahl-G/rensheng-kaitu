# Kaitu.app（macOS arm64）

## 打包

在本仓库根目录运行：

```sh
pnpm build
node packages/desktop/package-kaitu.mjs '/Applications/DeepSeek Harness.app' --dmg
```

输入为已安装的 DSH **0.2.0-rc.2、arm64** 应用。后处理工具来自
`~/Developer/deepseek-harness-rc2` 已安装的依赖，另需 macOS 的 Xcode Command Line Tools。
输入应用和 DSH 源码保持只读，输出为 `dist/Kaitu.app`、`dist/Kaitu.dmg`。
省略 `--dmg` 只生成应用。未设置签名变量时使用 ad-hoc 签名。

可用 `--output /你的目录/Kaitu.app` 更换输出位置，DMG 总是在同一目录；已有输出不会被覆盖。
用 `--dsh-root /源码目录` 更换 DSH 工具来源。加 `--dry-run` 只列出操作步骤，
也可传入一个空的 `.app` 目录查看流程。

脚本替换名称、图标和菜单品牌，保留 DSH 内部协议版本，关于面板显示 `开图版本+dsh.0.2.0-rc.2`。
插件与初始化器随应用打包，运行时不依赖本仓库。自动更新源、强制更新查询与 `dsh://` 注册会移除。

## 作者自己签名与公证

准备 Apple Developer Program 账号，以及已导入本机钥匙串、带私钥的
**Developer ID Application** 证书。`security find-identity -v -p codesigning` 可查看完整证书名。
公证另需 Apple ID、团队 ID 和 App 专用密码，先用系统命令交互保存凭据：

```sh
xcrun notarytool store-credentials kaitu-notary
```

选择一个尚不存在的输出目录，在本仓库运行：

```sh
KAITU_SIGN_IDENTITY='Developer ID Application: 你的名称 (TEAMID)' \
KAITU_NOTARY_PROFILE='kaitu-notary' \
node packages/desktop/package-kaitu.mjs '/Applications/DeepSeek Harness.app' \
  --output dist/release/Kaitu.app --dmg
```

`KAITU_SIGN_IDENTITY` 使用完整证书名；脚本逐层签名 Electron、辅助应用与内置原生运行时，
开启 hardened runtime 和安全时间戳，并沿用 DSH 的 Electron / JIT entitlements。
只设此变量时签名后结束；`KAITU_NOTARY_PROFILE` 必须与签名变量一起设置。
正式签名需要访问 Apple 时间戳服务，公证也需要联网。

设置公证变量后，脚本压缩应用、提交 `notarytool --wait`，确认 `Accepted`，再 staple 并校验应用。
带 `--dmg` 时，镜像内含应用和 Applications 链接，随后也会签名、公证并 staple 镜像。

## 装好后怎么用

打开 `Kaitu.dmg`，将 `Kaitu.app` 拖入 Applications 后双击；只有应用目录时直接复制后打开。
首次启动按欢迎页完成模型配置，填写自己的 API Key，然后进入「开图」。

工作区优先使用 `~/Library/Application Support/kaitu/current-workspace.json` 指向的有效目录，
否则使用 `~/kaitu`，空目录会自动初始化。首次注册的 DSH 默认工作区就是这个开图目录，
从侧栏或快捷键新建会话会沿用当前工作区，也可从开图页面进入开图会话。

应用状态、模型凭据、DSH 会话和 Electron 数据保存在 `~/.kaitu-app/`，开图文件保留在原工作区。
模型配置在 Kaitu 中单独填写。DSH 插件市场及插件设置入口保留，可继续安装和管理插件。
每次启动共用 `kaitu dsh --install` 的生成函数更新开图受管段，包含定时任务包去重，保留段外配置。
应用移动后会自动更新内置插件路径。Kaitu 与原 DSH 使用同一默认 Host 端口，按需打开其中一个。
