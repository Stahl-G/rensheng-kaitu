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
默认直接进入独立本地工作台，只有总览、开图、记录三个导航。查看资料、保存原文、打开地图和财务不要求模型或 API Key。
「AI 与连接」先提供已有 AI 的接手说明，主动选择「使用内置 AI」后才启动 DSH、配置模型。

工作区优先使用 `~/Library/Application Support/kaitu/current-workspace.json` 指向的有效目录，
否则使用 `~/kaitu`，空目录会自动初始化。默认资料服务只监听本机随机端口，退出应用时停止。
应用移动后会自动更新内置插件路径。已存在的健康目标和任务保留，新用户不预填私人健康数值。首次启动询问一次三个自动任务，默认开启：每日整理 03:00、早间计划 07:30、资讯搜索 08:00，按工作区时区执行。
「开图 → 设置」可分别开关，已有用户不重新询问，已有任务不覆盖时间、内容或手动删除决定。
自动任务由内置 AI 执行，应用运行时按需在后台启动该进程。

应用状态和 Electron 数据保存在 `~/.kaitu-app/`，开图文件保留在原工作区。
内置 AI 复用当前安装已经使用的状态目录：有旧 `ai/profiles/desktop` 时沿用 `~/.kaitu-app/ai/`，否则使用原 `~/.kaitu-app/`。
不迁移或删除登录凭据、会话和 DSH 的 `~/.dsh`。资料窗口使用单独的 `workbench-userData`，避免争用 AI 的 Electron 存储。
AI 子进程隐藏 Dock 图标；重复打开复用同一进程，主窗口退出会等待 AI 正常保存退出，超时清理其进程组。
API Key 自动引导只在 Kaitu.app 关闭；`kaitu dsh --install` 和 `kaitu dsh` 的 DSH 入口恢复引导。
插件市场和运行时配置只通过高级设置进入。

## 隔离验收

```sh
KAITU_APP_HOME=/tmp/kaitu-test/state \
KAITU_DIR=/tmp/kaitu-test/workspace \
KAITU_APP_PORT=0 \
/path/to/Kaitu.app/Contents/MacOS/Kaitu
```

显式指定隔离目录后不读取真实工作区指针。`KAITU_APP_HOME` 与 `KAITU_DIR` 必须是绝对路径。
`KAITU_APP_PORT` 只影响主动启动的内置 AI，普通资料界面始终使用系统分配的本机端口。
