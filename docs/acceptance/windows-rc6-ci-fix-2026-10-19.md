# RC6 Windows CI 修复与安装包补验

草稿 [PR #54](https://github.com/Stahl-G/rensheng-kaitu/pull/54)，分支 `codex/windows-rc6`。用户指出 #55 的实际 CI 是 269 通过、2 失败、7 原有跳过，已核对原始日志并纠正之前把本机十二项失败当作最新 CI 的说法。本机旧结果保留在诊断文档中，不混作 hosted runner 结果。

## 来源与改动

- 打包基线：#55 合入 main 的 `60ba38d052148d50039bced016dfb742f7585d67`。
- 最终功能及打包源码：`c4d069db40c8fa01fa5f4ec92147b4df591bcdb9`。
- `dcdca65`：Windows 短名（如 RUNNER~1）与 SDK 长名误判。原 SDK 测试改用真实短路径后，修复前复现同一拒绝错误，修复后通过。物理身份与相对路径统一使用 native realpath；保留词法目录、物理链接、越界和程序状态保护。
- 飞书此前 `c9d680d`：复用安全 npm shim 解析，替换 Windows 不可执行的 Unix 夹具，保留原文导入、去重、更新断言。
- 首轮 PR CI 原两项通过，但 Windows 工作台快速写入漏存一个版本。`4f08f1c` 让写入仅标记该路径的 Git 状态缓存失效，存版本时读取新内容；不恢复逐文件摘要重算。保留原版本数与正文断言。
- 实际安装补验发现 sdk-host bundle 缺少其他打包模块已有的 Node 兼容头，加载时报 Dynamic require of process。`c4d069d` 复用 nodeBanner，仅一行，不改 SDK 本体。修复后正式新包的原生 SDK 写入通过。
- 打包期间 main 又合入 #56，观察到 `e2d9cd83a176bf2fc6b35bc1dabe7f92f32bc9d6`。本包不含 #56 备份清单改动，未将新主仓库改动自动混入既定包；这是与随后桌面 main 的明确差异。

## 检查结果

| 范围 | 结果 |
|---|---|
| 最终源码 build / typecheck / lint | 通过 |
| 真实短路径 SDK 与飞书业务定向 | 2 通过；名称筛选未运行 symlink 用例，不是新增 skip |
| 工作台与历史定向 | 12 通过 |
| status 定向复核 | 3 通过，23.35 秒；保留此前两次超时日志 |
| 首轮 PR CI，dcdca65 | macOS 通过；Windows 268 通过 / 1 工作台失败 / 7 原有跳过，问问与飞书通过 |
| 最终 PR CI，c4d069d | [双平台工作流](https://github.com/Stahl-G/rensheng-kaitu/actions/runs/39272281108) 最后观察为运行中；随后诊断服务三次无法连接 GitHub，最终结果未确认 |
| 本机首轮全量，dcdca65 | 261 通过 / 8 失败 / 7 原有跳过，475.83 秒。7 项 symlink EPERM，1 项 status CLI 超时；不是 CI 的失败数 |
| 最终代码合成备份往返 | 通过；普通写入 7ms，恢复 1284ms；原文、双向合并和去重断言通过，无诊断抑制开关 |

## 新测试包与实际安装

- 文件：`D:\test\rensheng-kaitu-windows-night-1019\dist\windows-rc6-verified\Kaitu-Setup-0.1.0-rc.6-windows.4-x64.exe`。
- SHA-256：`1ce4b629a03d2bca79b127938c62614ee781fbe0e23e44fb8bbf243461ffd82a`。
- 大小：300,077,578 bytes；功能版本 `0.1.0-rc.6`，安装器修订 `windows.4`；DSH `0.2.1-rc.2`，Windows x64，未签名。与 Mac 复用同一后端，未发第二个 npm 后端。
- 官方脚本重新生成：`node packages/desktop/package-windows.mjs D:/test/rensheng-kaitu-rc4-release/.kaitu/windows-release/dsh --tools D:/test/rensheng-kaitu-rc4-release/.kaitu/windows-tools --output dist/windows-rc6-verified --revision 4`。
- 安装到已有隔离测试位置，exit 0；十项关键文件（含 sdk-host）与新包逐项 SHA-256 相同。
- 实际安装 EXE 的 20 个合成进程/接口事件通过：独立无凭据配置、中文及空格工作区、已有页面接口、记录/项目保存、进程重启读取、RC4 新建合成工作区升级、RC5 来源合成原文保留、模拟 ACP 首次失败重试/切换/重启恢复。
- 实际安装 EXE 的打包 SDK host：使用真实 8.3 短路径写 STATUS，用户决定保留、Agent 修改为建议、过期写入拒绝；越界、.kaitu、.git 拒绝。不是只验证源码或临时修正版 bundle。
- 实际安装 EXE 的打包 CLI：通过合成 npm .cmd 导入飞书正文，首次新增 1，重复新增 0/未变 1，正文可读。
- 中间 windows.3 与旧 windows.2 留作历史，均不交付为最终修复包。

## 未验与交付结论

Computer Use 内核仍不能初始化，原生 GUI、布局缩放、正常 UI 退出和截图未验。上述进程退出为受控结束测试进程；模拟 ACP 不代表真实模型、已登录 Agent 或真实飞书服务验证。没有读取真实开图资料或凭据，没有调整系统权限，没有正式 Release、npm 发布、官网部署或 PR 合并。

仅作为本地测试候选：最终 CI 尚待确认，核心资料/安全入口需非作者独立验收，原生 UI 与真实连接尚未实测，不能宣布可正式交给用户。完整安装哈希与原始合成结果见 [机器可读证据](windows-rc6-ci-fix-2026-10-19.json)。
