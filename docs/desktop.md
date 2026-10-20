# Kaitu 桌面应用

Windows 10 / 11 x64 的 EXE 使用同一份开图功能包，安装、构建与隔离调试见 [windows.md](windows.md)。下文为 macOS arm64 的打包方式。

## 打包

在本仓库根目录运行：

```sh
pnpm build
node packages/desktop/package-kaitu.mjs '/Applications/DeepSeek Harness.app' --dmg
```

输入为已安装的 DSH **0.2.1-rc.2、arm64** 应用。后处理工具来自
`~/Developer/deepseek-harness-rc2` 已安装的依赖，另需 macOS 的 Xcode Command Line Tools。
输入应用和 DSH 源码保持只读，输出为 `dist/Kaitu.app`、`dist/Kaitu.dmg`。
省略 `--dmg` 只生成应用。未设置签名变量时使用 ad-hoc 签名。

可用 `--output /你的目录/Kaitu.app` 更换输出位置，DMG 总是在同一目录；已有输出不会被覆盖。
用 `--dsh-root /源码目录` 更换 DSH 工具来源。加 `--dry-run` 只列出操作步骤，
也可传入一个空的 `.app` 目录查看流程。

脚本替换名称、图标和菜单品牌，保留 DSH 内部协议版本，关于面板显示 `开图版本+dsh.0.2.1-rc.2`。
插件与初始化器随应用打包，运行时不依赖本仓库。自动更新源、强制更新查询与 `dsh://` 注册会移除。

## 开图功能包独立更新

DSH 固定为 `0.2.1-rc.2`，宿主接口版本为 `1`。功能更新不修改 `.app`，不更换 Electron、DSH、原生启动器或协议桥接。
界面、资料服务、开图工具与技能一起更新，保证前后端同版。启动后在后台检查一次，此后每 24 小时检查，不阻塞首屏。
发现新版会显示更新提示，用户点击下载，下载后自行选择立即或稍后重启；设置中可关闭自动检查，也可恢复上一版功能。
恢复功能版本不恢复用户资料；需要回退资料时使用资料的版本历史。

首次安装须使用带 `kaitu-loader.mjs` 的新宿主。旧 App 没有该加载器，不能只靠功能包取得更新能力。
更新包放在本机 App 状态目录的 `updates/dsh-0.2.1-rc.2-host-1/`，不放工作区或同步盘。
启动器仍从签名 App 读取。功能包的 `node_modules` 只链接宿主中的固定 DSH 桥接，包内不能分发内核依赖。

发布配置是只含公钥的 JSON：`{"feedUrl":"https://你的发布地址/latest.json","publicKey":"PEM 格式 Ed25519 公钥"}`。
Mac 和 Windows 打包宿主默认嵌入 `packages/desktop/update-public-key.pem` 中经批准的公开验签公钥，也支持 `--update-public-key <Ed25519公钥文件>` 指定公钥。使用已有 GitHub Releases 的正式版频道：
`https://github.com/Stahl-G/rensheng-kaitu/releases/download/desktop-stable-dsh-0.2.1-rc.2-host-1/latest.json`。
这是独立的兼容频道，不依赖 GitHub 的 latest Release，也不固定到 0.1.1。应用版本的 Release 保存不可覆盖的 `kaitu-features.zip`；频道 Release 只更新签名 `latest.json`，指向新的版本 ZIP。
频道 Release 标为预发布，避免成为官网或 GitHub 的最新应用版本；它只是分发入口，清单内容只指向已发布的正式功能版本，不向正式版用户推送 RC。
将来更换 DSH 或宿主接口时创建新的兼容频道，保留旧频道的最后一个兼容版本，不能用不兼容清单覆盖旧频道。
测试源可用 `--update-config <配置文件>`，配置在签名前写入 App。正式版宿主读取不到有效验签公钥或配置时拒绝打包。
私钥由发布者保管，通过 `--key <私钥文件>` 交给本机发布工具，不打包、不上传、不写入工作区。

日常发布不必构建完整 App：

```sh
pnpm build
node packages/desktop/package-kaitu.mjs '/Applications/DeepSeek Harness.app' \
  --payload-only dist/features-0.1.1 --payload-version 0.1.1
node packages/desktop/package-update.mjs \
  --payload dist/features-0.1.1 --output dist/release-0.1.1 \
  --key /安全位置/更新签名私钥.pem \
  --url https://github.com/Stahl-G/rensheng-kaitu/releases/download/v0.1.1/kaitu-features.zip --notes '本版更新说明'
```

产物为 `kaitu-features.zip` 和带 Ed25519 签名的 `latest.json`。先上传并核对版本 Release 中的 ZIP，再更新独立频道 Release 的清单；不能只创建新的应用 Release 而忘记更新频道。
这些命令只生成本地产物，不执行上传。版本目录不可覆盖。正式版和 RC 使用不同的 feed URL。
下载入口检查签名、包哈希、允许的目录与确切的 DSH/宿主接口版本，再切换版本指针；不在每次读资料时重查。
HTTP 只允许回环地址以便本机验收，对外发布使用 HTTPS。支持 GitHub Release 附件的有限次 HTTPS 重定向，拒绝降级至 HTTP；清单仍须验签、功能包仍须核对哈希。
需要原生能力、原生依赖或新的 DSH 适配时升级宿主；不要伪造相同的适配版本号来强行安装。

正式频道地址与公钥已接线；私钥由发布者在 Git 与云同步之外的本机受限目录保管，不随源码或应用分发。更换信任公钥必须另行确认并重新分发宿主，不能直接让旧公钥信任未经授权的新签名者。正式频道清单及新宿主尚须完成验收并按发布流程确认后上线。
旧 `0.1.0-rc.6` 未配置正式更新源，不能靠发布一个新功能包补上：须退出 App，覆盖安装一次带公钥的新宿主；不需卸载，也不删除资料。
新版 Mac 仍下载 DMG 拖入应用程序替换，Windows 仍运行同 App ID 的安装器覆盖安装，作为手动更新兜底。

界面语言默认跟随系统首选语言：`zh`（含地区变体）使用中文，英语及其他语言使用英语。
桌面从 Electron 的系统语言接口读取，Web 使用浏览器语言。设置中可手动选择或恢复跟随系统。
早期版本曾自动保存语言且未标记来源，不能区分它和用户手动选择；保留旧值，用户可在设置中恢复跟随系统。

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
默认直接进入独立本地工作台，有今天、开图、资料、问问四个同级导航。查看资料、保存原文、打开地图和财务不要求模型或 API Key。
「问问」首次打开提供已有 AI 的接手说明或内置 DeepSeek API Key 连接；凭据使用 DSH 的本机存储。

工作区优先使用 `~/Library/Application Support/kaitu/current-workspace.json` 指向的有效目录，
否则使用 `~/kaitu`，空目录会自动初始化。默认资料服务只监听本机随机端口，退出应用时停止。
应用移动后会自动更新内置插件路径。已存在的健康目标和任务保留，新用户不预填私人健康数值。第一次在问问连接内置 AI 后，以第二步对话框询问一次自动任务：每日整理 03:00、早间计划 07:30 默认开启，资讯搜索 08:00 默认关闭，按工作区时区执行。
「开图 → 设置」可分别开关，已有用户不重新询问，已有任务不覆盖时间、内容或手动删除决定。
自动任务由内置 AI 执行，应用运行时按需在后台启动该进程。

应用状态和 Electron 数据保存在 `~/.kaitu-app/`，开图文件保留在原工作区。
内置 AI 复用当前安装已经使用的状态目录：有旧 `ai/profiles/desktop` 时沿用 `~/.kaitu-app/ai/`，否则使用原 `~/.kaitu-app/`。
不迁移或删除登录凭据、会话和 DSH 的 `~/.dsh`。资料窗口使用单独的 `workbench-userData`，避免争用 AI 的 Electron 存储。
问问使用无界面的 SDK profile，通过 initialize / session/prompt 与原生事件通知工作，不打开 DSH 窗口。
会话索引与展示事件在本机 `~/.kaitu-app/ask/`，原生日志在 AI home 的 sdk profile，均不写入工作区。
默认「只读写开图资料」模式的文件读写与搜索仅放行当前工作区，解析符号链接后再检查；禁用命令、作业、网页抓取/搜索、子代理、工作流及插件管理。
不挂载 shell / Seatbelt 执行器；保留 workspace-write 文件能力与 approval/never，禁用硬依赖 shell 的权限预设服务。
默认模式中，导入和照片原件须先放入工作区，问问不执行项目外部链接访问/同步或工作区迁移。
切换「完整 Agent」须二次确认，只对当前对话生效。此模式以 DSH 标准完整权限重启 SDK 并续接同一会话，可使用命令、文件和联网。新对话回到默认模式。
已有会话通过 DSH SDK `session/resume` 恢复；原生注入的指令和运行时上下文不作为用户消息展示。
定时任务保留隐藏的 Electron 进程，因为 0.2.1-rc.2 SDK profile 不含 schedule 需要的 sessionController。
重复启动复用原后台进程；退出会关闭 SDK 与后台任务进程。
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

## 确认日程时加入系统日历

今天页、日程页确认有起止时间的建议，或为下一步确认时间段后，独立 macOS App 会创建或复用「开图」日历。
排下一步复用当前 NOW.md 计划的日期，空计划使用今天；可在日程详情调整当天起止时间或取消。
事件备注只带关联下一步、记录 ID 和「做完后回开图记一句结果」，默认提前 10 分钟提醒。
待确认建议、无时间待办和导入的其他日历不会被推送。

首次写入会请求自动化授权。拒绝或执行失败时，确认结果旁显示原因、「下载日历文件」和重试。
可到「系统设置 → 隐私与安全性 → 自动化」允许开图控制日历，再点「重试日历操作」。
浏览器的 `kaitu ui`、DSH 插件和非 macOS 环境只生成文件，由用户下载并导入日历。
文件使用固定 UID `kaitu-block-<计划日期>/<块 ID>` 和递增修订号；同一天改期沿用 UID，取消文件带取消状态。
普通同步只更新或删除当前 NOW.md 日期的事件，其他日期保留；跨天复用块 ID 会创建独立事件，一键移除仍覆盖全部日期。
页面的「已生成日历文件」表示文件已可下载，导入结果需在日历 App 核对。

「设置 → 自动整理」附近的「确认日程时加入系统日历」默认开启。关闭后停止自动写入、更新和删除，已有事件保持不动。
关闭后可点「移除开图已写入的日历事件」；只移除本机映射中的事件，失败可重试，文件导入的事件会提供取消文件。
同一时间段重复确认不会创建第二个事件；调整时间更新原事件，取消、拒绝、删除后移除。
用户在日历 App 删除事件后，下次同步标记「已从日历删除」，不自动复活。
同步在确认操作、资料变化和 App 运行期间每分钟执行；关闭 App 时不运行，也不回读日历里的改期。

映射、开关与结果保存在可信本机状态根的 `system-calendar/<工作区身份>.json`，不进资料目录、同步盘或版本历史。
macOS 默认是 `~/Library/Application Support/kaitu/system-calendar/`。执行器仅在独立 App 主进程注入，参数经 JSON argv 传给固定 JXA 脚本。
使用 iCloud 提醒前，在日历 App 确认「开图」位于 iCloud 账户，并在 Mac、iPhone 与手表开启日历同步及通知。
Calendar 的脚本接口不提供账户选择；新建日历所属账户随本机配置，需要在首次使用时核对。

### 本机手动验收

1. 用隔离的测试工作区启动 Kaitu.app，准备一条带起止时间的待确认建议和一条无时间待办。
   在今天页点确认，允许自动化授权。核对独立「开图」日历中的标题、起止时间、备注、提前 10 分钟提醒和页面成功结果。
2. 对同一建议重复确认，核对只有一个事件。在日程详情调整时间，核对原事件 UID 保持不变、时间已更新。
   取消日程，核对事件消失；另确认一个下一步的时间段，验证待确认建议和无时间待办仍未推送。
3. 确认一条新建议后，在日历 App 手动删除事件。等待一分钟或刷新资料，页面应标记「已从日历删除」，再确认也不会复活。
4. 关闭设置开关后确认或调整其他时间段，核对系统日历不变；点一键移除，核对仅映射中的开图事件被移除。
   其他日历及「开图」里手工创建的无关事件均保留。
5. 使用测试 App 的自动化设置拒绝授权，确认另一条建议，核对失败原因、文件下载、固定 UID 与重试。
   重新允许授权后重试，核对成功回执。下载同一事件的文件两次导入，并导入改期、取消文件，在 Calendar 核对重复导入和取消行为。
6. 确认「开图」日历位于 iCloud 账户，在 iPhone 和手表核对事件与提醒。
   本次自动检查与浏览器验收没有操作真实 Calendar.app，也未验证设备同步、系统授权弹窗或正式签名产物的授权归属。

## DSH 0.2.1-rc.2 适配

内核及 npm 引擎固定为 0.2.1-rc.2，Cordis 对齐宿主的 4.0.5。HOST_API 保持 1：开图功能包桥接协议未变。
删除 rc.2 的手动 Agent 恢复、followup 与句柄销毁分支，恢复统一走 SDK `session/resume`，并转发 `session/wait`。
恢复入口仍核对所属工作区，应用当前对话模式；完整 Agent 与资料模式共用这条接入。

新版 `agent-instructions` 不接受配置行的 `dshHome`，改用进程 `DSH_HOME`，共享指令根目录由 `DSH_AGENTS_HOME` 决定。
项目指令按 `projectRootMarkers: ["AGENTS.md"]` 从会话 cwd 向项目根读取，工作区 AGENTS.md 继续生效。
凭据服务 `LocalCredentialProvider` 仍接受 `dshHome`，继续指向隔离的 AI 状态目录。

核对 npm 包 README、协议类型与发布源码：SDK 新增 resume、wait 和 working-directory 接口，未提供生成取消接口。
因此本轮不增加 AskService.cancel、askCancel 或停止按钮。DSH 插件管理器支持显式更新 bundle 并管理启用状态，
适用于 DSH profile 中安装的插件；开图独立 App 的签名功能包更新仍走原通道。

本轮无模型探针：临时 HOME 与合成工作区中读取到 43 个服务商；资料模式和完整 Agent 模式均完成
创建会话、关闭进程、原生恢复与 `session/wait`，未发送 prompt 或设置凭据。
桥接按新版要求注入 workingDirectory；收件箱监听的异步错误会关闭失效 watcher，保留已有定时处理。
