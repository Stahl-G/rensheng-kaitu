# Windows 安装包

Windows 与 Mac 使用同一份 React 界面、core、资料服务、DSH 插件和问问 SDK。内核沿用 RC4 适配的 DSH 0.2.1-rc.2；只分别构建桌面启动入口、图标和安装器。

## 使用

Windows 用户从 [官网下载页](https://kaitu.si/download/#windows) 查看 DSH 插件安装指引；仓库内的操作步骤见 [dsh.md](dsh.md)。未签名的独立 EXE 暂不作为推荐下载入口。

0.1.1 的 Windows 独立安装包尚未完成验收，只用于本机测试。Mac 的签名、公证和验收结果不能代表 Windows 已通过验收。

独立测试包第一次打开选择资料位置。需要内置 AI 时，打开「问问 → 连接 AI → 用开图里的 AI」，填写服务商 API Key，获取并选择模型，再继续。默认推荐 DeepSeek；查看资料和保存原文不要求 Key。

当前 Windows 预览包没有数字签名，系统可能显示发布者验证提示。Mac 的签名与公证不代表 Windows 包已签名。

卸载只移除应用，保留资料与本机状态。日历确认使用 ICS 文件导出。

## 构建

在 Windows x64 上安装 Node 24 和 pnpm，运行：

```powershell
pnpm install --frozen-lockfile
pnpm build
npm install --prefix .kaitu/windows-tools --no-audit --no-fund electron-builder@26.17.0 sharp@0.35.5 @electron/asar@3.4.1 rcedit@4.0.1 7zip-bin@5.2.0
curl.exe -L --fail https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.2-win-x64.exe -o .kaitu/dsh-windows.exe
Get-AuthenticodeSignature .kaitu/dsh-windows.exe
```

先确认官方输入包的签名为 Valid，再解压，不运行官方安装器：

```powershell
& .kaitu/windows-tools/node_modules/7zip-bin/win/x64/7za.exe x -y .kaitu/dsh-windows.exe '-o.kaitu/dsh-windows'
node packages/desktop/package-windows.mjs .kaitu/dsh-windows --output dist/windows
```

输出：`dist/windows/Kaitu-Setup-<version>-x64.exe` 和 `dist/windows/win-unpacked/Kaitu.exe`，版本取自 `packages/cli/package.json`。输出目录不得已存在。加 `--dir` 只生成应用目录；`--tools` 可指定构建工具目录。

同一功能版本重发安装器时，可加 `--revision 2`，文件名变为 `Kaitu-Setup-0.1.0-rc.4-windows.2-x64.exe`，功能包与 npm 版本不变。官网从同一 Release 中选择最新上传的 Windows 安装包。

`package-payload.mjs` 和 `package-archive.mjs` 由 Mac、Windows 打包器共用。原始 DSH 输入只读，输出保留原生依赖的 unpacked 标记，校验内核版本和重打包内容。Windows 不注册 `dsh://`，不使用 DSH 的更新地址。

这次没有改变 npm 发布方式，也没有单独的 Windows 后端包。普通功能改动继续在同一仓库维护；宿主升级才需要分别适配桌面壳。

从 0.1.1 起，正式版打包默认嵌入仓库中的公开验签公钥，可加 `--update-public-key <Ed25519公钥文件>` 指定公钥，使用与 Mac 相同的签名功能包更新频道；测试源可用 `--update-config <配置文件>`。检查、下载、重启与完整安装包兜底见 [desktop.md](desktop.md#开图功能包独立更新)。旧 RC 安装包需先覆盖安装一次新版，无须先卸载。

## Actions 候选构建

`.github/workflows/windows-candidate.yml` 仅由 `workflow_dispatch` 手动触发。GitHub 要求该 workflow 先存在于默认分支；只开草稿 PR 不会运行它，也不会生成安装器。

它复用本仓库已有 Actions 输入 artifact，不下载上游安装器。输入 artifact 必须来自已获授权、已合法取得的原始 DSH 包，根目录包含 `deepseek-harness-0.2.1-rc.2-win-x64.exe`。执行者提供：

- `source_commit`：经批准的源码完整提交 SHA。
- `dsh_run_id`、`dsh_artifact_id`：本仓库保存该输入的 run ID 与 artifact ID。
- `dsh_sha256`：从可信原始输入独立核对的 EXE SHA-256，不是 artifact ZIP 的哈希。

workflow 先检查哈希和原始 EXE 的 Authenticode `Valid` 状态，再解压、调用现有打包器；缺文件、哈希不符、签名无效或构建失败即停止。它不运行上游安装器，不创建凭据，不签名 Kaitu，不发布 Release。

`GITHUB_TOKEN` 仅有 `contents: read` 与读取已有 artifacts 所需的 `actions: read`；checkout 不保留凭据。产物通过 Actions 自带 artifact 机制上传，保留 7 天，名称含源码 SHA、run ID 与 attempt；包含 NSIS EXE、现有 `build.json`、输入与源码来源记录 `build-info.txt` 和 `SHA256SUMS`。没有输入 artifact 时，应交由已授权 Windows 使用上面的本机构建命令，不能改下载路径或放宽校验继续。

构建成功只表示候选生成；首次启动、记录回读、插件嵌入/重复打开/宿主重启、退出后进程结束与安装升级仍需原生验收。

## 隔离调试

```powershell
$env:HOME = 'D:\test\开图 验收\home'
$env:USERPROFILE = $env:HOME
$env:LOCALAPPDATA = "$env:HOME\AppData\Local"
$env:DSH_HOME = "$env:HOME\dsh"
$env:KAITU_APP_HOME = 'D:\test\开图 验收\state'
$env:KAITU_DIR = 'D:\test\开图 验收\资料'
$env:KAITU_LOCAL_STATE_DIR = "$env:HOME\local-state"
$env:KAITU_APP_PORT = '0'
& .\dist\windows\win-unpacked\Kaitu.exe
```

使用全新的目录。退出后确认本次启动的 Kaitu 和 SDK 进程已结束。不要使用真实资料、已有 DSH profile 或云盘验收。
