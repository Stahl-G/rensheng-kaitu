# Windows 隔夜打包与实际验收

状态：最终包已安装并完成合成接口验证，最终精确源码全量测试中；[草稿 PR #30](https://github.com/Stahl-G/rensheng-kaitu/pull/30)。仅本地测试包，不创建 Release，不更新官网，不合并 PR。

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
| 构建 / lint / 类型检查 / 全量测试 | 最终产品源码构建、lint、类型检查通过；最终全量进行中。当前 package.json 未提供 pnpm check，使用四条既有命令 |
| 官方脚本重新打包 | Windows 占位文件修复后的最终包 windows.1021 已生成。官方 DSH 输入签名 Valid，不复用旧开图产物 |
| 真正安装 / 首次启动 | 最终包静默安装 exit 0，已安装 EXE 启动并返回 HTTP 200；原生首次向导未验 |
| 创建、重开、中文和空格路径 | 合成目录自动初始化并成功重开；原生路径选择器未验 |
| 记录写入、退出重启后读回 | 已安装 EXE 接口保存并在进程重启后读回；正常 UI 退出未验 |
| 今天 / 健康 / 项目 / 资料页面 | overview、health、projects、library、doing 产品接口均成功；视觉及点击未验 |
| 原生窗口缩放、退出和重启 | 未验 |
| 旧版合成工作区升级 | 旧 RC4 CLI 初始化的合成资料由最终 EXE 成功打开，原文保留；原生迁移窗口未验 |
| 问问首次失败重试 | 最终已安装 EXE 的合成 ACP 接口测试通过；原生界面及真实 Agent 未验 |
| 新对话完整模式 / 旧受限对话不提权 | 复用原作者 K-1 单独提交，两个逻辑回归通过；原生界面未验 |
| 本机 Agent 切换、会话恢复 | 最终已安装 EXE 的两个合成 ACP 切换、进程重启后继续同一线程通过；真实 Agent 未验 |

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

最终安装包和合成接口证据见下文；截图无，原生自动化环境无法初始化。

目前不能交给用户试用：完整检查未全绿，且 Computer Use 环境阻塞原生验收。K-1 逻辑修复已有回归，但不能宣称原生权限操作通过。

与最新桌面版的差异：基于开始时已合入 main 的内容，只额外复用夜间分支已检查的 K-1 单独提交；未包含 PR #23、K-2～K-5 或其未验收夜间改动。Windows 沿用共用 React、core、CLI、DSH 引擎，不另建后端实现。

## 最终测试包与精确来源

| 项目 | 结果 |
|---|---|
| 应用 / 安装器修订 | `0.1.0-rc.5` / `1021`，Windows x64 |
| DSH / Electron | `0.2.1-rc.2` / `44.7.0` |
| 产品源码 SHA | `acaddb3ed671011bf1b206c909164f95a13ff555`；之后仅更新验收文档 |
| 安装包路径 | `D:\test\rensheng-kaitu-windows-night-1019\dist\windows-night-1019-final\Kaitu-Setup-0.1.0-rc.5-windows.1021-x64.exe` |
| 大小 | 297,764,655 bytes |
| SHA-256 | `9bfe430a44494151681276ee8bf18355729165a6fffe64e6f53e3f0c5e4ab1fa` |
| 签名 | 开图测试包未签名；作为输入的官方 DSH 安装器 Authenticode 为 Valid |
| 安装位置 | `.kaitu/night/安装 测试/Installed Kaitu`，独立合成配置 |

官方脚本重新注入共用代码并生成 NSIS，未给旧包改名。此前 windows.1019、windows.1020 是诊断中间产物，不作为交付包。安装后 `Kaitu.exe`、`resources/kaitu/dist/index.js`、`resources/kaitu/dist/client.js` 分别与最终 `win-unpacked` 对应文件 SHA-256 一致。版本与哈希清单见 [artifact.json](artifact.json)。安装文件保留本地，不提交 298 MB 二进制到 Git，不通过 Release 发布。

## 复现命令及检查明细

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm exec vitest run packages/dsh-plugin/test/ask-mode.test.ts
pnpm exec vitest run packages/cli/test/local-agents.test.ts
pnpm exec vitest run packages/core/test/workspace-backup.test.ts -t 'iCloud 占位不作为本地删除上传'
node packages/desktop/package-windows.mjs D:/test/rensheng-kaitu-rc4-release/.kaitu/windows-release/dsh --tools D:/test/rensheng-kaitu-rc4-release/.kaitu/windows-tools --output dist/windows-night-1019-final --revision 1021
```

- 最终产品源码 build、lint、typecheck 全通过；lint 检查 464 个文件。
- 定向回归 K-1 / Windows ACP / 占位分别 2 / 8 / 1 通过；占位命令按名称过滤其余 5 项，未新增 skip。
- 初始基线全量：233 通过 / 15 失败 / 4 原有跳过；另有 1 未处理错误；449.62 秒。
- K-1 + ACP 夹具全量（占位修复前启动）：241 通过 / 9 失败 / 4 原有跳过；501.60 秒。7 个 symlink EPERM、1 个 experience-imports 默认 15 秒超时、1 个已修复占位断言。保留默认检查参数，不放宽断言、权限或超时。
- 最终精确产品源码全量：运行中，完成后补充。
- 日志在 `.kaitu/night/logs/`：`install.log`、`repaired-build.log`、`repaired-lint.log`、`repaired-typecheck.log`、`test.log`、`final-test.log`、`exact-final-test.log`、`package-final.log`、`installer-final-exit.txt`、`installed-smoke-1021.log`。

## 已安装 EXE 的合成接口证据

[installed-smoke.json](installed-smoke.json) 记录最终包的 17 个检查事件，均通过，仅代表进程与接口范围：

- 全新配置无 AI 凭据，合成工作区名称包含中文和空格。
- overview / health / projects / library / doing 成功；capture 写入中文原文，projectCreate 后 projectDetail 可读。
- 缺失 Agent CLI 返回明确 400；自建合成 ACP 故意第一次连接失败，第二次可回复。
- 两个自建合成 ACP 切换后在同一问问线程继续回复；结束本轮 PID 的进程树后重新启动，原文从 library.inbox 读回，原线程继续回复。
- 旧 RC4 构建 CLI 初始化独立合成目录、写入合成记录，最终 EXE 打开后原文保留。

接口脚本显式设置 full，**不能证明新对话 UI 预选生效**。进程终止不是正常 UI 退出。自建 ACP 不是已登录真实 Agent。页面接口不是视觉验收。17 个事件含三次进程启动，不能解读为 17 项原生验收。

## 仍需补验

1. 原生首次向导、选路径、页面布局、缩放、模式控件、正常退出和截图；Computer Use 三次初始化失败后停止。浏览器补充入口也在相同 kernel assets 初始化阶段失败，未绕过原生自动化限制。
2. 7 个安全测试创建合成 symlink 即 EPERM，后续文件读取、MCP、财务、状态、模块记录、原文证据、DSH 文件边界断言在本设备上未验。保留系统安全设置。
3. 真实 Agent 的首次连接、切换恢复及回答；当前未发现已安装 ACP 适配器，没有读取凭据或新增登录。
4. `workspace-backup` 按开发流程属于“要验收”路径，需要另一家 Agent 的独立验收与用户决定合并；作者自测不替代此项。main 目前缺少计划中的 `scripts/needs-review.mjs` 和 `pnpm check`，未越界实现其他流程任务。

2026-10-19 00:53（Asia/Bangkok）重新 fetch 后 main 仍是 `6e5ca015d8344b5770ab0511630b08f3d0ac045c`；夜间分支推进到 `32f4e5ed8888e3be4ce82b08f08ad889ed7bf7a8`（K-3），K-2 为 `5bf457accc5ee0957656fd8e9a1b773dd5bb66da`。本包未自动纳入这些新增内容。早间由用户决定是否发布，本轮不自动发布、合并或部署。
