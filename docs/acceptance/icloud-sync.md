# 同步文件夹后端交审

分支 `codex/icloud`，基于 `main` 的 `19d5c12`。不推送、不合并。

## 本轮范围

- 本机 / iCloud / Google Drive 三选一，复用原 Drive 迁移、搬回、状态隔离、指针、旧址说明和迁移后检查。
- 新增 sync CLI 与本地接口，保留 drive CLI / API；Kaitu.app 与 kaitu ui 共用服务端。
- 默认云盘模式按真实路径识别，自定义目录的选择只记在本机状态目录；config schema 与 PRD §6 不变。
- 只有 Drive 生成云端接力入口；iCloud 与本机继续生成 OVERVIEW。
- 桌面有进行中的 AI 回复时拒绝切换；空闲时在迁移前关闭旧 runtime 与后台 AI，后续 SDK 和自动任务使用新路径。

## 验证

每个提交前执行 `pnpm build && pnpm typecheck && pnpm lint && pnpm test --maxWorkers=1`。
仅降低测试并发，原有测试与超时阈值不变。
新增行为测试使用临时 HOME / 云盘目录，下载命令由测试替代，不使用真实 iCloud、真实工作区或 ~/.kaitu-app。
第一批 build、typecheck、lint 全部通过；完整测试以单 worker 运行，47 个文件、132 个测试通过。
第二批增加一个行为测试，合计新增两个：iCloud 往返；冲突副本与未下载文件的报告、扫描和防误删。
后者用 `.icloud` 占位模拟未下载文件，验证原件不被覆盖、已下载文件能存新版本、未下载文件保留旧版本内容。
同时验证无关路径可局部恢复、触及未下载文件的恢复及搬回被拒绝、下载后原记录仍可读回。
第二批 build、typecheck、lint 全部通过；完整测试 47 个文件、133 个测试通过，退出码 0。
早期回归曾出现旧测试超时；最终整套通过时未改原测试或超时阈值。

构建后的 CLI / 本地接口另在临时 HOME 冒烟通过：新 CLI iCloud 开启与状态、新 API 查询与搬回、Drive 开启、旧 Drive CLI / API 往返。
HTTP 请求只访问本机回环地址，brctl 由临时命令替代。桌面 local.mjs / sdk-runtime.mjs 的 Node 语法检查通过；不代表原生 App 验收。

## 真实 iCloud 手动验证

以下命令使用本分支构建后的 CLI（`node packages/cli/dist/main.js` 可替代 `kaitu`）。

1. 先在系统设置启用 iCloud 云盘。用临时 HOME 以外的正常运行环境创建一份合成测试工作区，避免使用个人资料。
2. 设置 `KAITU_DIR` 指向这份测试工作区，运行 `kaitu sync enable icloud --name kaitu-sync-check`。
3. 开启后取消 `KAITU_DIR`（或更新为返回的云盘 root），再运行 `kaitu sync status`，应显示 icloud、云盘内工作区与本机状态目录。确认云盘 `.kaitu/` 只有 config.json；
   history.git、secrets、index.sqlite、cache、上传暂存及 local-projects 均在本机。
4. 在 Finder 对该文件夹选择“始终保留下载”。等同步完成，在另一台 Mac 使用该工作区路径运行 status、doctor、validate。
   每台 Mac 保有自己的状态与密钥；新 Mac 没有原 Mac 的版本库，首次 snapshot 建立本机历史，AI 连接需要在本机配置。
5. 从一台 Mac 添加合成记录，等另一台 Mac 下载后读取，核对 ID 和内容；反向再做一次。
6. 另建合成 `handoffs/test.md` 与 `handoffs/test 2.md` / `test (1).md`，副本写不同的 agent。
   doctor 应列出副本，validate 不读它们，刷新 OVERVIEW 后不出现副本 agent；文件保持原样。验证后人工把副本移出测试工作区。
7. 在测试文件上用 Finder“移除下载”，断网后运行 doctor、status 和 snapshot。
   doctor 应列出未下载文件，原文件不得变空。另改一个已下载的合成文件并 snapshot，history 应新增版本，未下载文件保留旧版本内容。
   局部恢复已下载文件应成功；恢复范围涉及未下载文件或执行 disable 时应拒绝。
   重新联网并“始终保留下载”，等下载结束后再运行 snapshot，核对原记录 ID 与内容。
8. 运行 `kaitu sync disable --to <空的本机测试目录>`，确认数据、密钥与历史保留、旧址留下说明。

## 第三轮：按审查简化检测

- 删除 `/bin/cat`、有限时内容读取、读取缓存及整次版本延后逻辑。
- 只有真实路径在 iCloud 云盘目录内时，才用 `lstat` 的 `size > 0 && blocks === 0` 或同目录 `.文件名.icloud` 判断未下载。
- 后台请求 brctl 下载，不等待结果；同一路径三十秒内去重，失败忽略。
- unavailableFiles 只遍历元数据；assertDownloaded 只遍历传入前缀，构造函数不预扫整个工作区。
  本机及 Drive 文件（包括 macOS 的 config.json）直接 readFileSync。
- statusMatrix 逐文件过滤未下载文件和冲突副本，其他文件正常保存版本；恢复仅对本次会覆盖或移除的路径做检查。
- 保留原两个行为测试，不新增测试。占位验证包含新版本保留原始 blob、正常文件版本保存、局部恢复与后台下载去重。
- 第三批最终 build、typecheck、lint 全部通过；完整测试以单 worker 运行，47 个文件、133 个测试通过，退出码 0。

## 尚未验证

真实 iCloud 下载、两台 Mac 的云端传输、原生 Kaitu.app 打包运行和未来 iPhone 开图尚未实测。
本轮不改前端设置页，ui-v2 后续对接接口；Google Drive 仍是唯一云端 AI 接力路径。
