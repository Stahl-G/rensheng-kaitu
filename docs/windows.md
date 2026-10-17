# Windows 安装包

Windows 与 Mac 使用同一份 React 界面、core、资料服务、DSH 插件和问问 SDK。内核沿用 RC4 适配的 DSH 0.2.1-rc.2；只分别构建桌面启动入口、图标和安装器。

## 使用

从 [官网下载页](https://kaitu.si/download/#windows) 下载 Windows 安装包，双击安装，完成后打开「人生开图」。当前为 `Kaitu-Setup-0.1.0-rc.4-windows.2-x64.exe`。支持 Windows 10 / 11 x64，安装包内置 Node 和 DSH，不需要终端或另装运行时。

第一次打开选择资料位置。需要内置 AI 时，打开「问问 → 连接 AI → 用开图里的 AI」，填写服务商 API Key，获取并选择模型，再继续。默认推荐 DeepSeek；查看资料和保存原文不要求 Key。

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

输出：`dist/windows/Kaitu-Setup-0.1.0-rc.4-x64.exe` 和 `dist/windows/win-unpacked/Kaitu.exe`。输出目录不得已存在。加 `--dir` 只生成应用目录；`--tools` 可指定构建工具目录。

同一功能版本重发安装器时，可加 `--revision 2`，文件名变为 `Kaitu-Setup-0.1.0-rc.4-windows.2-x64.exe`，功能包与 npm 版本不变。官网从同一 Release 中选择最新上传的 Windows 安装包。

`package-payload.mjs` 和 `package-archive.mjs` 由 Mac、Windows 打包器共用。原始 DSH 输入只读，输出保留原生依赖的 unpacked 标记，校验内核版本和重打包内容。Windows 不注册 `dsh://`，不使用 DSH 的更新地址。

这次没有改变 npm 发布方式，也没有单独的 Windows 后端包。普通功能改动继续在同一仓库维护；宿主升级才需要分别适配桌面壳。

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
