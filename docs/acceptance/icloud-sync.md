# 同步文件夹后端交审

分支 `codex/icloud`，基于 `main` 的 `19d5c12`。不推送、不合并。

## 本轮范围

- 本机 / iCloud / Google Drive 三选一，复用原 Drive 迁移、搬回、状态隔离、指针、旧址说明和迁移后检查。
- 新增 sync CLI 与本地接口，保留 drive CLI / API；Kaitu.app 与 kaitu ui 共用服务端。
- 默认云盘模式按真实路径识别，自定义目录的选择只记在本机状态目录；config schema 与 PRD §6 不变。
- 只有 Drive 生成云端接力入口；iCloud 与本机继续生成 OVERVIEW。
- 桌面迁移前等待 AI 空闲并关闭旧 runtime，后续 SDK 和自动任务使用新路径。

## 验证

每个提交前执行 `pnpm build && pnpm typecheck && pnpm lint && pnpm test`。
新增行为测试使用临时 HOME / 云盘目录，下载命令由测试替代，不使用真实 iCloud、真实工作区或 ~/.kaitu-app。
第一批 build、typecheck、lint 全部通过；完整测试以单 worker 运行，47 个文件、132 个测试通过。
文件保护验证将在第二个提交补全。

## 真实 iCloud 手动验证

1. 先在系统设置启用 iCloud 云盘。用临时 HOME 以外的正常运行环境创建一份合成测试工作区，避免使用个人资料。
2. 设置 `KAITU_DIR` 指向这份测试工作区，运行 `kaitu sync enable icloud --name kaitu-sync-check`。
3. `kaitu sync status` 应显示 icloud、云盘内工作区与本机状态目录。确认云盘 `.kaitu/` 只有 config.json；
   history.git、secrets、index.sqlite、cache、上传暂存及 local-projects 均在本机。
4. 在 Finder 对该文件夹选择“始终保留下载”。等同步完成，在另一台 Mac 使用该工作区路径运行 status、doctor、validate。
   每台 Mac 保有自己的状态与密钥；新 Mac 没有原 Mac 的版本库，首次 snapshot 建立本机历史，AI 连接需要在本机配置。
5. 从一台 Mac 添加合成记录，等另一台 Mac 下载后读取，核对 ID 和内容；反向再做一次。
6. 运行 `kaitu sync disable --to <空的本机测试目录>`，确认数据、密钥与历史保留、旧址留下说明。

## 尚未验证

真实 iCloud 下载、两台 Mac 的云端传输、原生 Kaitu.app 打包运行和未来 iPhone 开图尚未实测。
本轮不改前端设置页，ui-v2 后续对接接口；Google Drive 仍是唯一云端 AI 接力路径。
