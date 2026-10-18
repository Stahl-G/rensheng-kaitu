# Windows 隔夜打包与实际验收

状态：进行中；草稿 PR #30。仅本地测试包，不创建 Release，不更新官网，不合并 PR。

## 基线与隔离

- 分支：`codex/windows-night-1019`。
- 初始打包基线：`6e5ca015d8344b5770ab0511630b08f3d0ac045c`（开始时最新 main）。
- 夜间计划分支：`claude/product-analysis-north-star-z6g5gu`，开始时 `c3ccbe013f562ab669301a361327bf6e524bc727`。
- 开始时远端 `codex/night-1019` 不存在。
- PR #23 实际为开放、未合并，head 为上述计划分支；没有在线检查记录。计划文字称已合并，与远端实际状态不同，未将该 PR 混入包。
- 工作树：`D:\test\rensheng-kaitu-windows-night-1019`。
- 旧 RC4 工作树干净；旧 `rensheng-kaitu-windows` 工作树存在未提交改动，完整保留。不修改其他 Agent 分支。
- 开始时未发现 Kaitu / DSH 运行进程。验收 HOME、资料、应用状态和本机索引全部放在本工作树忽略目录 `.kaitu/night/` 内。
- 不读取真实工作区或凭据；本地 Agent 仅使用现有登录机制，不读取凭据文件。不改系统安全设置或数据格式。

## 任务清单

| 项目 | 当前结果 |
|---|---|
| frozen-lockfile 依赖安装 | 通过；Node 24.16.0，pnpm 11.25.0 |
| 构建 / lint / 类型检查 / 全量测试 | 构建、lint、类型检查通过；基线全量测试 233 通过 / 15 失败 / 4 跳过，另有 1 个未处理错误；修正后完整复跑中。当前 package.json 未提供 pnpm check，使用四条既有命令 |
| 官方脚本重新打包 | 已生成 RC5 基线诊断包和 K-1 候选包；Windows 占位文件修复后的最终包正在生成。官方 DSH 输入签名 Valid，不复用旧开图产物 |
| 真正安装 / 首次启动 | 未验 |
| 创建、重开、中文和空格路径 | 未验 |
| 记录写入、退出重启后读回 | 未验 |
| 今天 / 健康 / 项目 / 资料页面 | 未验 |
| 原生窗口缩放、退出和重启 | 未验 |
| 旧版合成工作区升级 | 未验 |
| 问问首次失败重试 | 已安装候选 EXE 的合成 ACP 接口测试通过；原生界面及真实 Agent 未验 |
| 新对话完整模式 / 旧受限对话不提权 | 复用原作者 K-1 单独提交，两个逻辑回归通过；原生界面未验 |
| 本机 Agent 切换、会话恢复 | 候选 EXE 的合成 ACP 切换通过，完整恢复继续测试；真实 Agent 未验 |

## 本轮改动与检查

1. 复用 `3589442893979f7af52e8086b518a995a2ee2b3d`（Mac Agent 的 PR #31 已记录 core build、typecheck、lint 和 dsh-plugin 测试通过）。只 cherry-pick K-1，未包含其父分支 PR #23；本分支对应提交 `51eb7a9`。`vitest run packages/dsh-plugin/test/ask-mode.test.ts`：2 项通过。未另写权限实现。
2. Windows ACP 测试夹具：Unix shebang 文件在 Windows 无法直接启动；改为标准 npm shim，走产品已有 `cliCommand`，不改或跳过断言。提交 `3e7e492`；`vitest run packages/cli/test/local-agents.test.ts`：8 项通过，包括取消、失败重试、切换和恢复。
3. Windows 占位文件备份保护：`placeholderOriginal` 返回原生反斜杠，备份选择器使用 `/`，导致漏检占位并误上传删除。在备份入口统一分隔符，不改数据格式。提交 `acaddb3`。既有合成回归 `iCloud 占位不作为本地删除上传，下载后可继续，真实删除仍可同步` 修复前失败、修复后通过；没有访问真实云盘或 GitHub 数据。

## 已知阻碍与边界

- Computer Use 的 `node_repl` 连续两次返回 `failed to write kernel assets: 系统找不到指定的路径。 (os error 3)`；按技能执行 reset 后重新初始化仍失败。三次后停止，未用其他原生 UI 自动化绕过。**全部原生点击、缩放、正常退出以及截图仍为未验。**
- 本机有原生 Claude / Codex，但未发现其 ACP 适配器，没有新装适配器或读取登录凭据；真实本地 Agent 不算通过。
- 本机文件符号链接创建返回 EPERM，多个隐私边界测试在准备夹具时失败。没有新增 skip、删除断言、放宽权限或改系统安全设置。
- 基线还有默认 15 秒超时；正在使用原有参数复跑，不能把定向通过当作完整测试通过。
- 静默安装属于安装进程级证据；HTTP 页面与合成 ACP 属于接口证据，不替代原生验收。验收脚本先纠正了两处测试假设：桌面使用随机端口；原文从 library.inbox 回读而非笔记文档接口。失败日志保留。

## 交付与试用判断

安装包路径、SHA-256、源代码最终 SHA、截图和每项操作结果随验收补充。

目前不能交给用户试用：完整检查未全绿，且 Computer Use 环境阻塞原生验收。K-1 逻辑修复已有独立回归，但不能宣称原生权限操作通过。

与最新桌面版的差异：基于开始时已合入 main 的内容，只额外复用夜间分支已检查的 K-1 单独提交；未包含 PR #23、K-2～K-5 或其未验收夜间改动。Windows 沿用共用 React、core、CLI、DSH 引擎，不另建后端实现。
