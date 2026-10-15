# Kaitu.app（作者自用，macOS arm64）

## 怎么打包

在本仓库根目录按顺序执行，前两项可离线运行；后处理使用 DSH 仓库里已经安装的 esbuild、sharp 与 ASAR 工具，无需安装新依赖：

```sh
pnpm build
pnpm lint
node packages/desktop/package-kaitu.mjs '/Applications/DeepSeek Harness.app' --dry-run
node packages/desktop/package-kaitu.mjs '/Applications/DeepSeek Harness.app'
```

输入是 DSH 打包好的 **0.2.0-rc.2、arm64** 应用目录，本机已安装的这一份符合版本要求。
也可传入其他位置的同版 `.app`；原应用只读，输出默认是本仓库 `dist/Kaitu.app`。
用 `--output /你的目录/Kaitu.app` 更换输出位置，脚本拒绝覆盖已存在的输出。
用 `--dsh-root /源码目录` 指定工具来源，默认 `~/Developer/deepseek-harness-rc2`。
复制输出应用到最终位置后再打开；内置插件不依赖此源码仓库或本机 pnpm 链接。

`apps/desktop/.env.macos` 已写入最少配置，副本见 `packages/desktop/.env.macos.example`：

```dotenv
DSH_DESKTOP_APP_ID=ai.kaitu.app
```

这一项给 Kaitu 独立的反向域名标识。证书、公证、上传凭据全部省略，因为本地后处理只做 ad-hoc 签名。
不能写 `DSH_DESKTOP_UNSIGNED=1` 或虚构的更新关闭变量：`desktop-package-environment.mjs` 会拒绝不在白名单中的 dotenv 项。
`DSH_DESKTOP_AUTO_UPDATE_ENV` 只有 `test` / `production`，不是开关，所以不填。
后处理删除 `Resources/app-update.yml`，使 `update-coordinator.ts` 的 enabled 判断为 false；
同时删除包清单的 `dshMandatoryUpdatePolicy`，`mandatory-update-policy.ts` 会停止策略查询。
不会配置远程更新源、上传或调用 Apple 公证服务。

这份源码的 `package:mac:arm64:dir` **不能生成未签名应用**：
`package-target.ts` 的参数解析只允许 Windows 使用 `--unsigned`，macOS 主入口始终经过证书 keychain，目录分支仍调用公证。
`desktop-package-environment.mjs` 强制检查证书与公证凭据；`electron-builder-config.mjs` 也拒绝 macOS unsigned，
并设置 `forceCodeSigning: true`。此外 `prepare-dsh.ts` 的 macOS 分支也要求对原生依赖做证书签名。
因此不建议执行一个已知会失败的打包命令，也不复制这套流程或填假证书绕过验证。
本次走现成同版 `.app` 的离线后处理路径；从零生成原始未签名 DSH 应用仍受上游接口限制。

若 Claude 后续需要下载 Electron、内置 Node、Python 运行时，可单独执行下面的**联网准备命令**。
`prepare:runtime` 已串起 Electron 下载与 `prepare-primary-runtime.ts`，不必重复执行 `prepare:primary-runtime`。
它只准备运行时，不会产出完整 `.app`；本次未执行，也不需要它来处理已安装的应用。

```sh
DSH_DESKTOP_TARGET_PLATFORM=darwin DSH_DESKTOP_TARGET_ARCH=arm64 \
  pnpm --dir /Users/yihongguo/Developer/deepseek-harness-rc2/apps/desktop run prepare:runtime
```

## 装好后怎么用

双击 `Kaitu.app`。启动包装器先用内置 Electron 的 Node 模式初始化，再进入桌面壳。
它在每次启动时读取 `~/Library/Application Support/kaitu/current-workspace.json` 的 `root`，
并沿用 core 的有效性判断：目标存在 `.kaitu/config.json`。无有效指针时使用 `~/kaitu`，为空则用现有初始化逻辑创建工作区。
若该目录已有其他文件而不是工作区，初始化会停止，避免覆盖。

DSH 的 `resolveDshHome()` 优先读取 `DSH_HOME`，桌面 profile 固定在该目录的 `profiles/desktop`；
`DSH_DESKTOP_USER_DATA_DIR` 只在开发启动器中生效，正式主进程不会读取它。
因此包装器固定导出 `DSH_HOME=~/.kaitu-app`，传 `--user-data-dir`，
包内 bootstrap 也在导入原主进程前设置 Electron `userData`、`sessionData`、日志和崩溃目录。
DSH profile、模型凭据、会话与 Electron 状态各自落在 `~/.kaitu-app/` 内；开图工作区仍在原位置。
原有 `~/.dsh` 和 DSH 的 Electron userData 不迁移、不共用，模型 API Key 需要在 Kaitu 中另行填写。

启动时仅更新 `profiles/desktop/cordis.patch.yml` 的开图受管段，直接复用 CLI 导出的 `renderDshPatch()`。
插件路径指向当前应用包的 `Contents/Resources/kaitu/dist/index.js`，移动应用后会重新计算。
插件服务端依赖离线打包，DSH 协议包通过包内相对链接复用同一份；schemas、模板和城市表也随包复制。
客户端在主面板注册完成后选择 `kaitu-overview`，进入工作区后默认显示「开图」。
首次启动仍经过 DSH 的欢迎页与模型配置流程。

原生菜单来自 `src/locale.ts` 与 `src/main.ts`，不是 `.lproj` 翻译文件。
后处理替换 ASAR 内桌面壳资源中的品牌文案，并替换关于面板的组合版本；不会修改内置 DSH 运行时文件。
图标从 `docs/design/kaitu-mark.svg` 取形状，使用设计稿的深底、白线、浅蓝点；已有 sharp 负责 SVG 栅格化，
系统 `sips` 生成各档 PNG、`iconutil` 生成 ICNS。归档保留 unpacked 标记、权限和链接，并更新 Electron ASAR 完整性值。
最后运行 `codesign --force --deep -s -` 与严格签名校验。

## 已知限制

- 无 Developer ID 签名、无公证，只有本机 ad-hoc 签名；复制给别人，尤其经网络传输后，可能被 macOS 拦截。
- Info.plist 与关于面板显示 `开图版本+dsh.DSH版本`，当前为 `0.0.0+dsh.0.2.0-rc.2`。
  包清单与内置 DSH 的版本保留 `0.2.0-rc.2`，保持 Host 协议和运行时校验一致。组合版本不用于商店发布。
- 更新源和强更查询已关闭，但壳仍有「检查更新」菜单，点击只会显示缺少更新源，不会联网下载或安装。
- 保留现有品牌 patch 的禁用范围，不额外改动模型登录、工具权限或遥测策略。
  桌面欢迎页仍使用 DSH 的模型配置流程；本任务不等同于完整的 Kaitu 桌面体验验收。
- 取消原始 `dsh://` 协议声明，避免接管已安装 DSH 的链接。两个桌面壳仍使用默认 Host 端口 `19387`，暂不同时打开。
- 只验证后处理 dry-run 与本仓库构建、lint；本次未生成、打开真实 Kaitu.app 或操作真实用户数据。
  ASAR 主入口、菜单结构或插件客户端构建结构变化时，脚本会停止，需重新核对上游。
