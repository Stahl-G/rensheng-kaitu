# Windows RC4 安装包验收

后续现有 Drive 接入与共用 UI 基础规则修正见 [本轮补充验收](windows-ui-2026-10-18.md)；下文保留首个安装器的检查记录。

日期：2026-10-18。源代码起点为 `d876dd7966e5790ff14c06bfb59fca1895e2c460`，分支 `windows-exe-rc4`，通过 PR 交审。首个官网更新已发布到 gh-pages（`32a8d97d3bec41a358628c0293c9e428f5a8ea48`）。

## 产物与复用

- 下载：<https://kaitu.si/download/#windows>。
- Release：`v0.1.0-rc.4`，文件 `Kaitu-Setup-0.1.0-rc.4-x64.exe`，297425599 字节。
- SHA-256：`4f13f3727be536b999cbd2b3d2689a6635e03f65cd5d9ce741b5e3c060fc3792`。GitHub 上传后返回的 digest 与本机相同。
- Windows x64，DSH 0.2.1-rc.2，Electron 44.7.0。官方输入包 Authenticode 为 Valid，修改品牌后的 Windows 预览产物没有数字签名。
- Mac / Windows 共用 payload、ASAR 打包辅助和现有 core、CLI、React、DSH 插件；Windows 只增加启动适配、图标和当前用户 NSIS 安装器，没有新增后端 npm 包。

## 已完成的检查

| 检查 | 结果与范围 |
|---|---|
| 依赖与编译 | frozen lockfile 安装、build、typecheck、lint 均退出 0；lint 检查 423 个文件 |
| 打包 | 官方输入只读复制；ASAR 修改内容逐项比较，unpacked 标记逐项一致；NSIS 生成成功 |
| 安装 | 同一安装器配置的前一轮产物在中文、空格隔离路径静默安装，退出 0，生成应用、卸载入口与当前用户安装登记；Google Drive 修复后重打包的最终文件没有再次执行完整安装 |
| 桌面启动 | 已安装应用和修复后应用都在隔离资料与状态目录启动，原生可访问性树显示欢迎界面和四个入口 |
| 界面写入回读 | 通过 EXE 本机后端的浏览器界面保存合成原文，从资料收件箱读回；连接 AI 页面可选服务商、填写 Key、获取模型 |
| 真实 SDK | 在打包后的 Electron / DSH 中读取 46 个服务商、43 个运行时目录项；创建会话、关闭后由新进程恢复成功；没有填写 Key 或发起真实模型请求 |
| Google Drive | 真实 DSH 能力进程占用目录时改名复现 EBUSY，关闭进程后改名成功；修复后通过真实 HTTP 接口在合成中文同步目录与本机目录间迁移往返，原文两次读回一致，状态留在本机 |
| 自动回归 | Drive、Windows Drive 探测、Ask 三项通过；最终财务示例、旧工作区引导、外部更新版本三项定向回归通过 |
| 官网 | 中英文 EXE 卡片、文件名、大小、SHA、下载链接及 API Key 指引已添加，脚本语法检查与 diff 检查通过；GitHub Pages 报 built，线上下载页 HTTP 200 且含正确文件名和 SHA，EXE 下载 HEAD 为 200；已截取线上页面 |

## 问题与修复

1. Windows 下读取服务商目录会启动以工作区为 cwd 的能力进程，旧迁移准备只关闭对话进程，移动目录时报 EBUSY。现在迁移前也释放能力进程；外部占用时返回明确的占用提示。
2. Google Drive 原来只发现 Mac 的 CloudStorage 目录。现在 Windows 探测挂载盘中的 My Drive、我的云端硬盘和我的雲端硬碟，路径识别与状态目录判断一起适配。
3. 文件夹选择器原来总追加 kaitu，用户已选择 kaitu 时会变成两层；现在保留所选目录，并识别已发现的云盘提供方。
4. Windows CRLF 的 YAML frontmatter 截取遗留 CR 导致初始化解析失败；解析前去掉边界空白。仓库文本统一 LF，原有非 UTF-8 CSV / XLS 示例按原字节保留。

## 验证边界

第一次完整测试为 197 通过、16 失败、4 跳过，不能视为全绿。修复 CRLF、恢复财务示例字节、调整实际异步等待并定向回归后，6 个创建文件符号链接的权限测试仍因本机 EPERM 未验证；没有开启开发者模式或修改系统安全设置。后续定向测试未重新跑完整套件。

原生窗口截图与输入受桌面前台窗口不一致影响，因此没有把浏览器交互当成原生点击验收。没有执行真实 API Key / 模型、真实 Google Drive 上传同步或 Mac 构建回归；也没有完成合成大工作区性能实测。

用户选择的 Google Drive 位置已经存在工作区。没有迁移、覆盖或合并真实资料，也没有切换用户当前工作区；「沿用现有工作区」与「迁移当前新资料」需要明确区分。当前迁移接口继续拒绝覆盖现有目标。

过程日志位于本机忽略目录 `.kaitu/windows-release/`，包括 build-drive、typecheck-drive、lint-drive-final、test、retest、retest-final、drive-tests、move-lock、move-api、sdk-result 和 published-asset。
