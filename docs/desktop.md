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
已有会话通过 DSH 公开 agents.resume 恢复；原生注入的指令和运行时上下文不作为用户消息展示。
定时任务保留隐藏的 Electron 进程，因为 rc.2 SDK profile 不含 schedule 需要的 sessionController。
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
文件使用固定 UID `kaitu-block-<id>` 和递增修订号；改期文件沿用 UID，取消文件带取消状态。
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
